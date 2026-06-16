import { describe, it, expect } from 'vitest';
import {
  parseAslBlocks, parseGclBlocks, parseMeta, parseRole,
  parseScope, parseExecutionPlan, parseLocks, parseGates,
  parseAcceptanceTests, parseDriftMarkers, parsePacket,
} from '../src/parser.js';

// ── ASL block parser ────────────────────────────────────────

describe('parseAslBlocks', () => {
  it('extracts a single ASL block', () => {
    const raw = 'asl::META\nid = "test-001"\n::END\n';
    const blocks = parseAslBlocks(raw);
    expect(blocks['META']).toBeDefined();
    expect(blocks['META']).toContain('id = "test-001"');
  });

  it('extracts multiple ASL blocks', () => {
    const raw = 'asl::META\nid = "a"\n::END\nasl::ROLE\nname = "Builder"\n::END\n';
    const blocks = parseAslBlocks(raw);
    expect(Object.keys(blocks)).toHaveLength(2);
    expect(blocks['META']).toBeDefined();
    expect(blocks['ROLE']).toBeDefined();
  });

  it('returns empty object for no ASL blocks', () => {
    const raw = '# no blocks here\n::AUTHORITY\nfoo = bar\n::END\n';
    const blocks = parseAslBlocks(raw);
    expect(Object.keys(blocks)).toHaveLength(0);
  });
});

// ── GCL block parser ────────────────────────────────────────

describe('parseGclBlocks', () => {
  it('extracts a single GCL block', () => {
    const raw = '::AUTHORITY\nruntime_mode = "governed_build"\n::END\n';
    const blocks = parseGclBlocks(raw);
    expect(blocks['AUTHORITY']).toBeDefined();
    expect(blocks['AUTHORITY']).toContain('runtime_mode');
  });

  it('does not extract asl:: blocks as GCL', () => {
    const raw = 'asl::META\nid = "x"\n::END\n::AUTHORITY\nfoo = bar\n::END\n';
    const gclBlocks = parseGclBlocks(raw);
    expect(gclBlocks['META']).toBeUndefined();
    expect(gclBlocks['AUTHORITY']).toBeDefined();
  });

  it('extracts multiple GCL blocks', () => {
    const raw = '::AUTHORITY\na = b\n::END\n::PERMISSIONS\nc = d\n::END\n';
    const blocks = parseGclBlocks(raw);
    expect(Object.keys(blocks)).toHaveLength(2);
  });
});

// ── META parser ──────────────────────────────────────────────

describe('parseMeta', () => {
  it('parses valid META content', () => {
    const content = `
id = "my-packet-001"
version = "v1.5.1"
packet_tier = 2
type = "build"
owner = "ASL Labs"
status = "active"
`;
    const meta = parseMeta(content);
    expect(meta).toBeDefined();
    expect(meta!.id).toBe('my-packet-001');
    expect(meta!.packet_tier).toBe(2);
    expect(meta!.type).toBe('build');
    expect(meta!.status).toBe('active');
  });

  it('returns undefined for empty content', () => {
    expect(parseMeta('')).toBeUndefined();
  });
});

// ── Role parser ──────────────────────────────────────────────

describe('parseRole', () => {
  it('parses name and description', () => {
    const role = parseRole('name = "Builder"\ndescription = "Builds things."');
    expect(role?.name).toBe('Builder');
    expect(role?.description).toBe('Builds things.');
  });
});

// ── Execution plan parser ────────────────────────────────────

describe('parseExecutionPlan', () => {
  it('parses task_count and tasks', () => {
    const content = `
task_count = 2
task_count_justification = "test"

TASK_001:
  description = "First task."
  required = true
  depends_on = []
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_write"
  evidence_template = "file_write"
  expected_result = "Done."
  status = "PENDING"

TASK_002:
  description = "Second task."
  required = true
  depends_on = ["TASK_001"]
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "command_output"
  evidence_template = "command_output"
  expected_result = "Done."
  status = "PENDING"
`;
    const plan = parseExecutionPlan(content);
    expect(plan?.task_count).toBe(2);
    expect(plan?.tasks).toHaveLength(2);
    expect(plan?.tasks[0].id).toBe('TASK_001');
    expect(plan?.tasks[1].depends_on).toContain('TASK_001');
  });
});

// ── Lock parser ──────────────────────────────────────────────

describe('parseLocks', () => {
  it('parses behavioral lock with paired_with', () => {
    const content = `
LOCK_001:
  rule = "Do not exceed scope"
  type = "behavioral"
  enforced_by = "agent_receipt"
  paired_with = ["AT_001", "GATE_001"]
`;
    const locks = parseLocks(content);
    expect(locks).toHaveLength(1);
    expect(locks[0].type).toBe('behavioral');
    expect(locks[0].paired_with).toContain('AT_001');
  });

  it('parses runtime_enforced lock without paired_with', () => {
    const content = `
LOCK_001:
  rule = "No external APIs"
  type = "runtime_enforced"
  enforced_by = "agent_receipt"
`;
    const locks = parseLocks(content);
    expect(locks[0].paired_with).toBeUndefined();
  });
});

// ── Drift marker parser ──────────────────────────────────────

describe('parseDriftMarkers', () => {
  it('parses well-formed drift markers', () => {
    const raw = `
[TASK_001: COMPLETE | evidence_type: file_write | evidence_ref: src/index.ts created]
[TASK_002: COMPLETE | evidence_type: command_output | evidence_ref: tests passed]
`;
    const markers = parseDriftMarkers(raw);
    expect(markers).toHaveLength(2);
    expect(markers[0].task_id).toBe('TASK_001');
    expect(markers[0].status).toBe('COMPLETE');
    expect(markers[0].evidence_type).toBe('file_write');
  });

  it('ignores lines without drift marker format', () => {
    const raw = 'Some text\nNo markers here\n';
    expect(parseDriftMarkers(raw)).toHaveLength(0);
  });
});
