#!/usr/bin/env node
// ============================================================
// Signet CLI — validate | run | verify
// Thin layer: argument dispatch, file IO, table printing. No logic.
// ============================================================

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parsePacket } from '../src/parser.js';
import { validate } from '../src/validator.js';
import { govern, GovernanceError } from '../src/runtime.js';
import { verifyReceipt, checkAlignment } from '../src/verify.js';
import { recordRun, priorRuns, recentRuns, usageEntry } from '../src/xas-memory.js';
import { compileManifest, buildEnforcementReceipt, settingsSnippet, mergeSettings, HOOK_SCRIPT } from '../src/enforce.js';
import type { TaskResult, GateResult, AcceptanceTestResult } from '../src/types.js';

const HR = '━'.repeat(50);

function die(msg: string, code = 2): never {
  console.error(`signet: ${msg}`);
  process.exit(code);
}

function readFile(path: string): string {
  const abs = resolve(path);
  if (!existsSync(abs)) die(`file not found: ${path}`);
  return readFileSync(abs, 'utf-8');
}

// ── validate ─────────────────────────────────────────────────

function cmdValidate(path: string): never {
  const packet = parsePacket(readFile(path));
  const result = validate(packet);

  console.log(`\nSignet Validate — ${path}\n`);
  if (result.valid) {
    console.log(`✓ VALID — ${result.packet_id} (Tier ${result.packet_tier}, ${result.packet_type})`);
    if (result.summary.warnings > 0) {
      console.log(`  ${result.summary.warnings} warning(s):`);
      for (const i of result.issues.filter(i => i.severity === 'warning')) {
        console.log(`  ⚠ [${i.code}] ${i.message}`);
      }
    }
    process.exit(0);
  }
  console.log(`✗ INVALID — ${result.summary.errors} error(s), ${result.summary.warnings} warning(s)\n`);
  for (const i of result.issues) {
    const mark = i.severity === 'error' ? '✗' : '⚠';
    console.log(`  ${mark} [${i.code}] ${i.message}`);
  }
  process.exit(1);
}

// ── run ──────────────────────────────────────────────────────

function statusMark(s: string): string {
  return s === 'COMPLETE' || s === 'PASS' ? '✓' :
         s === 'UNEVALUATED' ? '?' : '✗';
}

function printTask(t: TaskResult): void {
  console.log(`${t.task_id}  ${statusMark(t.status)} ${t.status.padEnd(10)} ${t.evidence_type.padEnd(13)} ${t.note}`);
}

function printGate(g: GateResult): void {
  console.log(`${g.gate_id}  ${statusMark(g.result)} ${g.result.padEnd(10)} ${g.method.padEnd(13)} ${g.condition.slice(0, 60)}`);
}

function printAt(a: AcceptanceTestResult): void {
  console.log(`${a.at_id}    ${statusMark(a.result)} ${a.result.padEnd(10)} ${a.method.padEnd(13)} ${a.detail.slice(0, 60)}`);
}

function cmdRun(path: string, receiptOut: string): never {
  const raw = readFile(path);
  const packet = parsePacket(raw);

  const vResult = validate(packet);
  if (!vResult.valid) {
    console.error(`✗ Packet invalid — fix validation errors before running:`);
    for (const i of vResult.issues.filter(i => i.severity === 'error')) {
      console.error(`  ✗ [${i.code}] ${i.message}`);
    }
    process.exit(1);
  }

  // XAS-MEM: surface prior runs of this packet before executing
  if (packet.meta?.id) {
    try {
      const prior = priorRuns(packet.meta.id, 1);
      if (prior.length > 0) {
        const p = prior[0];
        console.log(`\nPrior run: ${p.created_at.slice(0, 10)}  verdict=${p.verdict}  score=${p.alignment_score}/10  (${p.handle})`);
        console.log(`  Lessons: ${p.lessons}`);
      }
    } catch { /* memory is best-effort — never block a run */ }
  }

  let result;
  try {
    result = govern(packet);
  } catch (e) {
    if (e instanceof GovernanceError) die(`governance error [${e.code}]: ${e.message}`, 1);
    throw e;
  }

  const r = result.receipt;
  console.log(`\nSignet v0.1 — Governed Execution (simulation mode)\n`);
  console.log(`Packet:  ${r.packet.id} (Tier ${r.packet.tier}, ${r.packet.type})`);
  console.log(`Locks:   ${r.ledger_crosscheck.observed.lock_count}  Gates: ${r.ledger_crosscheck.observed.gate_count}  Tasks: ${r.summary.tasks_total}  ATs: ${r.ledger_crosscheck.observed.acceptance_test_count}\n`);
  console.log(HR + '\n');

  for (const t of r.task_results) {
    printTask(t);
    const blocksForTask = r.block_events.filter(b => b.task_id === t.task_id);
    if (blocksForTask.length > 0) {
      const b = blocksForTask[0]; // dedup: show once per (task, lock, target) tuple
      const sources = new Set(blocksForTask.map(x => x.pattern_source));
      console.log(`          └─ Rule:     ${b.lock_rule}`);
      console.log(`          └─ Action:   ${b.action_kind} → ${b.matched_target}`);
      console.log(`          └─ Verdict:  BLOCKED (${b.lock_type}, matched "${b.matched_pattern}" from ${[...sources].join(' + ')})`);
    }
  }
  console.log('');
  for (const g of r.gate_results) printGate(g);
  for (const a of r.acceptance_results) printAt(a);

  console.log('\n' + HR + '\n');
  console.log(`Result:   ${result.verdict} (${r.summary.blocks_recorded} block(s) recorded, ${r.summary.tasks_blocked} task(s) blocked)`);

  if (result.warnings.length > 0) {
    console.log(`Warnings: ${result.warnings.length}`);
    for (const w of result.warnings) console.log(`  ⚠ ${w}`);
  }

  writeFileSync(receiptOut, JSON.stringify(r, null, 2) + '\n', 'utf-8');
  console.log(`Receipt:  ${receiptOut}`);
  console.log(`Hashes:   sha256=${r.hashes.sha256.slice(0, 12)}…  h10=${r.hashes.h10.slice(0, 12)}…`);
  console.log(`Signed:   [UNSIGNED — hash verified, no authority signature]`);

  // XAS-MEM: auto-log this run (SQLite row + SIGNET-USAGE.md entry)
  try {
    const row = recordRun(r, receiptOut);
    const usagePath = join(process.cwd(), 'SIGNET-USAGE.md');
    appendFileSync(usagePath, '\n' + usageEntry(row), 'utf-8');
    console.log(`Logged:   xas_mem ${row.handle}  +  SIGNET-USAGE.md (score ${row.alignment_score}/10)\n`);
  } catch (e) {
    console.log(`Logged:   ⚠ usage logging failed (${e instanceof Error ? e.message : e}) — run not recorded\n`);
  }

  process.exit(result.verdict === 'PASS' ? 0 : 1);
}

// ── history ──────────────────────────────────────────────────

function cmdHistory(limitArg?: string): never {
  const limit = limitArg ? Math.max(1, parseInt(limitArg, 10) || 10) : 10;
  const rows = recentRuns(limit);

  console.log(`\nSignet History — last ${rows.length} run(s) from xas_mem\n`);
  if (rows.length === 0) {
    console.log('  (no runs recorded yet — `signet run` logs automatically)\n');
    process.exit(0);
  }

  console.log(`  ${'DATE'.padEnd(11)}${'PACKET'.padEnd(32)}${'VERDICT'.padEnd(9)}${'SCORE'.padEnd(7)}HANDLE`);
  for (const row of rows) {
    console.log(`  ${row.created_at.slice(0, 10).padEnd(11)}${row.packet_id.slice(0, 30).padEnd(32)}${row.verdict.padEnd(9)}${String(row.alignment_score).padEnd(7)}${row.handle}`);
  }
  console.log('');
  process.exit(0);
}

// ── verify ───────────────────────────────────────────────────

function cmdVerify(path: string, packetPath?: string): never {
  const receiptJson = readFile(path);
  const result = verifyReceipt(receiptJson);

  console.log(`\nSignet Verify — ${path}\n`);
  const row = (name: string, ok: boolean, note = '') =>
    console.log(`  ${name.padEnd(12)} ${ok ? '✓' : '✗'}  ${note}`);

  row('parse', result.checks.parse_ok);
  let versionLabel = '';
  if (result.checks.version_ok) {
    try { versionLabel = String(JSON.parse(receiptJson).receipt_version); } catch { /* shown blank */ }
  }
  row('version', result.checks.version_ok, versionLabel);
  row('structure', result.checks.structure_ok);
  row('sha256', result.checks.sha256_ok,
    result.checks.sha256_ok && result.receipt_summary
      ? `${result.receipt_summary.sha256.slice(0, 12)}…  (recomputed, matches)` : '');
  row('h10', result.checks.h10_ok,
    result.checks.h10_ok && result.receipt_summary
      ? `${result.receipt_summary.h10.slice(0, 12)}…  (semantic core, matches)` : '');
  console.log(`  ${'signature'.padEnd(12)} —  ${result.checks.h10_ok
    ? '[UNSIGNED — hash verified, no authority signature]'
    : '[UNSIGNED — not checked]'}`);

  for (const f of result.failures) console.log(`\n  ✗ ${f}`);

  // v0.2: optional packet-to-receipt structural alignment (--packet <packet.md>)
  let alignmentFailed = false;
  if (packetPath) {
    const packet = parsePacket(readFile(packetPath));
    const declared = {
      packet_id: packet.meta?.id ?? '(missing META id)',
      task_count: packet.executionPlan?.tasks.length ?? 0,
      lock_count: packet.locks.length,
      gate_count: packet.gates.length,
      acceptance_test_count: packet.acceptanceTests?.tests.length ?? 0,
    };
    const al = checkAlignment(receiptJson, declared);
    console.log(`\n  Alignment (packet ↔ receipt, structural only):`);
    const aRow = (name: string, ok: boolean | null) =>
      console.log(`    ${name.padEnd(22)} ${ok === null ? '—' : ok ? '✓' : '✗'}`);
    aRow('packet_id', al.checks.packet_id_ok);
    aRow('task_count', al.checks.task_count_ok);
    aRow('lock_count', al.checks.lock_count_ok);
    aRow('gate_count', al.checks.gate_count_ok);
    aRow('acceptance_test_count', al.checks.acceptance_test_count_ok);
    for (const m of al.mismatches) console.log(`    ✗ ${m}`);
    console.log(`    Note: ${al.note}`);
    alignmentFailed = !al.aligned;
  }

  console.log(`\nResult: ${result.status}${alignmentFailed ? ' (alignment MISMATCH)' : ''}`);
  console.log(`\n${result.explanation}`);
  if (result.receipt_summary) {
    const s = result.receipt_summary;
    console.log(`\nPacket: ${s.packet_id}  Verdict: ${s.verdict}  Outcome: ${s.outcome}  Blocks: ${s.blocks_recorded}\n`);
  }

  process.exit(result.status === 'PASS' ? (alignmentFailed ? 1 : 0) : result.status === 'FAIL' ? 1 : 2);
}

// ── hook init / enforce report (v0.3) ───────────────────────

function cmdHookInit(packetPath: string, install: boolean): never {
  const raw = readFile(packetPath);
  const packet = parsePacket(raw);

  const vResult = validate(packet);
  if (!vResult.valid) {
    console.error(`✗ Packet invalid — fix validation errors before compiling a hook:`);
    for (const i of vResult.issues.filter(i => i.severity === 'error')) {
      console.error(`  ✗ [${i.code}] ${i.message}`);
    }
    process.exit(1);
  }

  let manifest;
  try {
    manifest = compileManifest(packet, raw);
  } catch (e) {
    die(e instanceof Error ? e.message : String(e), 1);
  }

  const signetDir = join(process.cwd(), '.signet');
  if (!existsSync(signetDir)) mkdirSync(signetDir, { recursive: true });
  writeFileSync(join(signetDir, 'enforce.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  writeFileSync(join(signetDir, 'hook.mjs'), HOOK_SCRIPT, 'utf-8');

  const hookCommand = 'node .signet/hook.mjs';

  console.log(`\nSignet Hook Init — ${manifest.packet_id}\n`);
  console.log(`  Manifest: .signet/enforce.json  (${manifest.patterns.length} pattern(s) from runtime_enforced locks)`);
  for (const p of manifest.patterns) {
    console.log(`    "${p.pattern}"  →  ${p.lock_id}  (${p.source})`);
  }
  console.log(`  Hook:     .signet/hook.mjs  (plain node, no dependencies)\n`);

  if (install) {
    const settingsPath = join(process.cwd(), '.claude', 'settings.json');
    const existing = existsSync(settingsPath)
      ? JSON.parse(readFileSync(settingsPath, 'utf-8'))
      : {};
    const merged = mergeSettings(existing, hookCommand);
    if (merged === existing) {
      console.log(`  Settings: ${settingsPath} already registers this hook — unchanged.\n`);
    } else {
      if (!existsSync(join(process.cwd(), '.claude'))) {
        mkdirSync(join(process.cwd(), '.claude'), { recursive: true });
      }
      writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
      console.log(`  Settings: merged PreToolUse hook into ${settingsPath} (existing entries preserved).\n`);
    }
  } else {
    console.log(`  To activate, add this to your project's .claude/settings.json`);
    console.log(`  (or re-run with --install to merge it automatically):\n`);
    console.log(JSON.stringify(settingsSnippet(hookCommand), null, 2).split('\n').map(l => '  ' + l).join('\n'));
    console.log('');
  }

  console.log(`  Honest limits: checks declared lock patterns only; not a sandbox;`);
  console.log(`  a host without PreToolUse hooks is not constrained.\n`);
  process.exit(0);
}

function cmdEnforceReport(receiptOut: string): never {
  const signetDir = join(process.cwd(), '.signet');
  const manifestPath = join(signetDir, 'enforce.json');
  if (!existsSync(manifestPath)) {
    die('no .signet/enforce.json found — run `signet hook init <packet.md>` first');
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const journalPath = join(signetDir, 'journal.jsonl');
  const journalText = existsSync(journalPath) ? readFileSync(journalPath, 'utf-8') : '';

  const receipt = buildEnforcementReceipt(manifest, journalText);
  writeFileSync(receiptOut, JSON.stringify(receipt, null, 2) + '\n', 'utf-8');

  console.log(`\nSignet Enforce Report — ${receipt.packet.id}\n`);
  console.log(`  Denials:  ${receipt.summary.denials} (hook_intercepted)`);
  for (const e of receipt.events) {
    console.log(`    ${e.ts}  ${e.tool_name} → "${e.target}"  [${e.lock_id}: "${e.matched_pattern}"]`);
  }
  console.log(`  Coverage: denials only — allowed calls are not recorded`);
  console.log(`  Receipt:  ${receiptOut}`);
  console.log(`  Hashes:   sha256=${receipt.hashes.sha256.slice(0, 12)}…  h10=${receipt.hashes.h10.slice(0, 12)}…`);
  console.log(`  Signed:   [UNSIGNED — hash verified, no authority signature]\n`);
  process.exit(0);
}

// ── dispatch ─────────────────────────────────────────────────

const [, , cmd, target, ...rest] = process.argv;

const USAGE = `Signet v0.3 — governed AI agent work

Usage:
  signet validate <packet.md>
  signet run <packet.md> [--receipt <out.json>]          simulation + receipt
  signet verify <receipt.json> [--packet <packet.md>]
  signet history [--limit <n>]
  signet hook init <packet.md> [--install]               compile locks → PreToolUse hook
  signet enforce report [--receipt <out.json>]           journal → enforcement receipt`;

if (!cmd || (!target && cmd !== 'history' && cmd !== 'enforce')) {
  console.log(USAGE);
  process.exit(2);
}

switch (cmd) {
  case 'validate': cmdValidate(target);
  case 'run': {
    const ri = rest.indexOf('--receipt');
    cmdRun(target, ri !== -1 && rest[ri + 1] ? rest[ri + 1] : './receipt.json');
  }
  case 'verify': {
    const pi = rest.indexOf('--packet');
    cmdVerify(target, pi !== -1 && rest[pi + 1] ? rest[pi + 1] : undefined);
  }
  case 'history': {
    const args = [target, ...rest].filter(Boolean);
    const li = args.indexOf('--limit');
    cmdHistory(li !== -1 ? args[li + 1] : undefined);
  }
  case 'hook': {
    if (target !== 'init' || !rest[0]) die(`usage: signet hook init <packet.md> [--install]`);
    cmdHookInit(rest[0], rest.includes('--install'));
  }
  case 'enforce': {
    if (target !== 'report') die(`usage: signet enforce report [--receipt <out.json>]`);
    const ri = rest.indexOf('--receipt');
    cmdEnforceReport(ri !== -1 && rest[ri + 1] ? rest[ri + 1] : './enforcement-receipt.json');
  }
  default: die(`unknown command: ${cmd}\n\n${USAGE}`);
}
