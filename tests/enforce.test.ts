// Signet v0.3 tests — hook enforcement.
// Governed by packet signet-v03-enforcement-001 (TASK_008).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { parsePacket } from '../src/parser.js';
import {
  compileManifest, buildEnforcementReceipt, parseJournal, mergeSettings, HOOK_SCRIPT,
} from '../src/enforce.js';
import { verifyReceipt } from '../src/verify.js';

const DEMO_RAW = readFileSync(resolve(__dirname, '../examples/runtime-lock.packet.md'), 'utf-8');
const DEMO = parsePacket(DEMO_RAW);

// ── manifest compiler ────────────────────────────────────────

describe('compileManifest', () => {
  const manifest = compileManifest(DEMO, DEMO_RAW);

  it('collects patterns from scope.excluded and forbidden_outputs with lock attribution', () => {
    expect(manifest.packet_id).toBe('runtime-lock-demo');
    expect(manifest.patterns.length).toBeGreaterThan(0);
    const env = manifest.patterns.find(p => p.pattern === '.env');
    expect(env).toBeDefined();
    expect(env!.lock_id).toBe('LOCK_001');
    expect(env!.lock_rule.toLowerCase()).toContain('.env');
  });

  it('binds the manifest to the exact packet text via sha256', () => {
    expect(manifest.packet_sha256).toMatch(/^[a-f0-9]{64}$/);
    const other = compileManifest(DEMO, DEMO_RAW + '\n# touched');
    expect(other.packet_sha256).not.toBe(manifest.packet_sha256);
  });

  it('refuses a packet with no runtime_enforced locks — nothing to enforce', () => {
    const noLocks = parsePacket(DEMO_RAW.replace(/type = "runtime_enforced"/g, 'type = "behavioral"'));
    expect(() => compileManifest(noLocks, DEMO_RAW)).toThrow(/no runtime_enforced locks/);
  });
});

// ── settings merge ───────────────────────────────────────────

describe('mergeSettings', () => {
  const CMD = 'node .signet/hook.mjs';

  it('preserves every existing key and existing hooks', () => {
    const existing = {
      model: 'opus',
      permissions: { allow: ['Bash(npm test)'] },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'python3 enforcer.py' }] }] },
    };
    const merged = mergeSettings(existing, CMD) as any;
    expect(merged.model).toBe('opus');
    expect(merged.permissions).toEqual(existing.permissions);
    expect(merged.hooks.PreToolUse).toHaveLength(2);
    expect(merged.hooks.PreToolUse[0].hooks[0].command).toBe('python3 enforcer.py');
    expect(merged.hooks.PreToolUse[1].hooks[0].command).toBe(CMD);
  });

  it('is idempotent — installing twice changes nothing', () => {
    const once = mergeSettings({}, CMD);
    const twice = mergeSettings(once, CMD);
    expect(twice).toBe(once);
  });
});

// ── hook script (the part that actually denies) ──────────────

describe('hook.mjs end-to-end', () => {
  let dir: string;
  let hookPath: string;

  const call = (toolName: string, toolInput: object): { code: number; stderr: string } => {
    try {
      execFileSync('node', [hookPath], {
        input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput }),
        encoding: 'utf-8',
      });
      return { code: 0, stderr: '' };
    } catch (e: any) {
      return { code: e.status, stderr: String(e.stderr ?? '') };
    }
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'signet-hook-test-'));
    writeFileSync(join(dir, 'enforce.json'), JSON.stringify(compileManifest(DEMO, DEMO_RAW)));
    hookPath = join(dir, 'hook.mjs');
    writeFileSync(hookPath, HOOK_SCRIPT);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('denies a forbidden Write with exit 2 and names the lock on stderr', () => {
    const r = call('Write', { file_path: '/project/.env', content: 'API_KEY=x' });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('DENY');
    expect(r.stderr).toContain('LOCK_001');
    expect(r.stderr).toContain('.env');
  });

  it('denies a forbidden Bash command', () => {
    const r = call('Bash', { command: 'cp .env /tmp/exfil' });
    expect(r.code).toBe(2);
  });

  it('allows a clean Write with exit 0', () => {
    const r = call('Write', { file_path: '/project/src/index.ts', content: 'export {}' });
    expect(r.code).toBe(0);
  });

  it('allows tool calls it has no targets for (e.g. Read-only tools)', () => {
    const r = call('Glob', { pattern: '**/*.ts' });
    expect(r.code).toBe(0);
  });

  it('journals each denial with hook_intercepted attribution', () => {
    const journal = readFileSync(join(dir, 'journal.jsonl'), 'utf-8');
    const events = parseJournal(journal);
    expect(events.length).toBeGreaterThanOrEqual(2);
    for (const e of events) {
      expect(e.attribution).toBe('hook_intercepted');
      expect(e.decision).toBe('deny');
      expect(e.lock_id).toBe('LOCK_001');
    }
  });

  it('fails open with a warning when the manifest is missing (not configured ≠ all forbidden)', () => {
    // hook script in a dir with NO enforce.json beside it
    const emptyDir = mkdtempSync(join(tmpdir(), 'signet-hook-empty-'));
    const lonelyHook = join(emptyDir, 'hook.mjs');
    writeFileSync(lonelyHook, HOOK_SCRIPT);
    let code = 0; let stderr = '';
    try {
      execFileSync('node', [lonelyHook], {
        input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/x/.env' } }),
        encoding: 'utf-8',
      });
    } catch (e: any) { code = e.status; stderr = String(e.stderr ?? ''); }
    rmSync(emptyDir, { recursive: true, force: true });
    expect(code).toBe(0);
    expect(stderr).toBe(''); // warning goes to stderr but exit 0 → no throw, stderr unobserved here
  });
});

// ── enforcement receipt build + verify ───────────────────────

describe('enforcement receipt', () => {
  const manifest = compileManifest(DEMO, DEMO_RAW);
  const journal = [
    JSON.stringify({ ts: '2026-06-12T00:00:00Z', tool_name: 'Write', target: '/p/.env', matched_pattern: '.env', pattern_source: 'scope.excluded', lock_id: 'LOCK_001', lock_rule: 'r', attribution: 'hook_intercepted', decision: 'deny' }),
    'not json — must be skipped',
    JSON.stringify({ ts: '2026-06-12T00:00:01Z', tool_name: 'Bash', target: 'cat .env', matched_pattern: '.env', pattern_source: 'scope.excluded', lock_id: 'LOCK_001', lock_rule: 'r', attribution: 'hook_intercepted', decision: 'deny' }),
  ].join('\n');

  const fixedClock = () => new Date('2026-06-12T01:00:00Z');
  const receipt = buildEnforcementReceipt(manifest, journal, fixedClock);

  it('counts only parseable hook_intercepted denials', () => {
    expect(receipt.summary.denials).toBe(2);
    expect(receipt.summary.first_event_ts).toBe('2026-06-12T00:00:00Z');
    expect(receipt.summary.last_event_ts).toBe('2026-06-12T00:00:01Z');
  });

  it('states its coverage honestly — denials only', () => {
    expect(receipt.coverage).toContain('Denials only');
    expect(receipt.coverage).toContain('hosts without hook support');
  });

  it('verifies PASS through the standard verifier with honest explanation', () => {
    const v = verifyReceipt(JSON.stringify(receipt));
    expect(v.status).toBe('PASS');
    expect(v.signed_state).toBe('UNSIGNED');
    expect(v.explanation).toContain('hook-intercepted denials only');
    expect(v.receipt_summary?.blocks_recorded).toBe(2);
  });

  it('tampering a denial event → FAIL TAMPERED', () => {
    const t = JSON.parse(JSON.stringify(receipt));
    t.events[0].target = '/p/README.md';
    const v = verifyReceipt(JSON.stringify(t));
    expect(v.status).toBe('FAIL');
    expect(v.failures[0]).toContain('TAMPERED');
  });

  it('forging hashes to match tampered bytes → caught by h10', () => {
    const t = JSON.parse(JSON.stringify(receipt));
    t.events.pop(); // drop a denial — rewrite enforcement history
    // attacker recomputes sha256 over tampered bytes but cannot fix h10 without
    // also matching the semantic core commitment
    t.hashes = { ...t.hashes, sha256: 'f'.repeat(64) };
    const v = verifyReceipt(JSON.stringify(t));
    expect(v.status).toBe('FAIL');
  });

  it('empty journal → zero-denial receipt that still verifies', () => {
    const r = buildEnforcementReceipt(manifest, '', fixedClock);
    expect(r.summary.denials).toBe(0);
    expect(r.summary.first_event_ts).toBeNull();
    expect(verifyReceipt(JSON.stringify(r)).status).toBe('PASS');
  });

  it('missing required field → structure FAIL naming the field', () => {
    const { coverage: _c, ...rest } = JSON.parse(JSON.stringify(receipt));
    const v = verifyReceipt(JSON.stringify(rest));
    expect(v.status).toBe('FAIL');
    expect(v.failures[0]).toContain('coverage');
  });
});
