import type {
  ParsedPacket, ParserIssue, AslMeta, AslRole, AslScope, AslOutputContract, AslReceipt,
  ExecutionPlan, Task, Lock, Gate, AcceptanceTest, AcceptanceTestBlock,
  VerificationLedger, DriftMarker, PacketTier, PacketType, PacketStatus,
  EvidenceType, OnDependencyFail, TaskStatus, LockType, GateOnFail, ApprovalRecord
} from './types.js';
import { AUTHORITY_BEARING_BLOCKS } from './schemas.js';

// ============================================================
// PARSER — ASL Lite + GCL Block Extraction
// ============================================================

// ── TASK_006: ASL Lite block parser ────────────────────────

/**
 * Extract all asl::BLOCK_NAME ... ::END blocks from raw text.
 * Returns a map of blockName -> raw inner content.
 * Last occurrence wins when names are duplicated (detected separately).
 */
export function parseAslBlocks(raw: string): Record<string, string> {
  const blocks: Record<string, string> = {};
  const pattern = /^asl::(\w+)\s*\n([\s\S]*?)^::END/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    const blockName = match[1].toUpperCase();
    blocks[blockName] = match[2];
  }
  return blocks;
}

// ── TASK_004 / TASK_005: Unclosed + duplicate block detection ──

/**
 * Detect asl:: block openers with no matching ::END and duplicate block names.
 * Uses line-by-line scanning: each asl::BLOCKNAME must be closed by the
 * NEXT ::END that appears before any subsequent asl:: opener.
 */
export function detectAslBlockIssues(raw: string): ParserIssue[] {
  const issues: ParserIssue[] = [];
  const lines = raw.split('\n');

  // Track: (blockName, lineIndex) for each opener seen without a closer yet
  const openStack: Array<{ name: string; line: number }> = [];
  // Count of successfully closed occurrences per block name
  const closedCounts: Record<string, number> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();

    // ASL block opener: line starts with asl::BLOCKNAME (optional whitespace)
    const openerMatch = line.match(/^asl::(\w+)\s*$/);
    if (openerMatch) {
      openStack.push({ name: openerMatch[1].toUpperCase(), line: i + 1 });
      continue;
    }

    // ::END — closes the most-recently-opened asl:: block (LIFO)
    if (line.match(/^::END\s*$/) && openStack.length > 0) {
      const closed = openStack.pop()!;
      closedCounts[closed.name] = (closedCounts[closed.name] ?? 0) + 1;
    }
  }

  // Anything still open is unclosed
  for (const unclosed of openStack) {
    issues.push({
      severity: 'error',
      code: 'PARSE_001',
      message: `asl::${unclosed.name} block opener (line ${unclosed.line}) found without matching ::END (unclosed block)`,
    });
  }

  // Duplicates: closed more than once
  for (const [name, count] of Object.entries(closedCounts)) {
    if (count > 1) {
      issues.push({
        severity: 'warning',
        code: 'PARSE_002',
        message: `asl::${name} block appears ${count} times — duplicate blocks detected (last wins)`,
      });
    }
  }

  return issues;
}

/**
 * Detect ::BLOCKNAME GCL openers with no matching ::END and duplicate GCL block names.
 * Uses line-by-line scanning, ignoring ::END as an opener.
 * GCL and ASL stacks are independent — a GCL ::END only closes GCL blocks.
 */
export function detectGclBlockIssues(raw: string): ParserIssue[] {
  const issues: ParserIssue[] = [];
  const lines = raw.split('\n');

  const openStack: Array<{ name: string; line: number }> = [];
  const closedCounts: Record<string, number> = {};
  // Track whether we're inside an asl:: block (to skip its ::END)
  let aslDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();

    // asl:: openers increase depth — their ::END is NOT a GCL closer
    if (line.match(/^asl::(\w+)\s*$/)) {
      aslDepth++;
      continue;
    }

    // GCL block opener: ::BLOCKNAME (not ::END)
    const gclOpenerMatch = line.match(/^::((?!END\b)\w+)\s*$/);
    if (gclOpenerMatch && aslDepth === 0) {
      openStack.push({ name: gclOpenerMatch[1].toUpperCase(), line: i + 1 });
      continue;
    }

    // ::END closes whichever block is on top of the relevant stack
    if (line.match(/^::END\s*$/)) {
      if (aslDepth > 0) {
        aslDepth--;
      } else if (openStack.length > 0) {
        const closed = openStack.pop()!;
        closedCounts[closed.name] = (closedCounts[closed.name] ?? 0) + 1;
      }
    }
  }

  for (const unclosed of openStack) {
    issues.push({
      severity: 'error',
      code: 'PARSE_003',
      message: `::${unclosed.name} GCL block opener (line ${unclosed.line}) found without matching ::END (unclosed block)`,
    });
  }

  for (const [name, count] of Object.entries(closedCounts)) {
    if (count > 1) {
      // v1.5.2: duplicates of authority-bearing blocks are HARD ERRORS, not "last wins".
      // A second, looser ::PERMISSIONS/::LOCKS/::AUTHORITY block is an
      // authority-escalation vector and must fail validation.
      if (AUTHORITY_BEARING_BLOCKS.has(name)) {
        issues.push({
          severity: 'error',
          code: 'PARSE_005',
          message: `::${name} is an authority-bearing block and appears ${count} times — ` +
            `duplicate authority blocks are forbidden (no "last wins"). Merge into a single ::${name} block.`,
        });
      } else {
        issues.push({
          severity: 'warning',
          code: 'PARSE_004',
          message: `::${name} GCL block appears ${count} times — duplicate blocks detected (last wins)`,
        });
      }
    }
  }

  return issues;
}

// ── TASK_007: GCL block parser ─────────────────────────────

/**
 * Extract all ::BLOCK_NAME ... ::END GCL blocks from raw text.
 * Returns a map of blockName -> raw inner content.
 */
export function parseGclBlocks(raw: string): Record<string, string> {
  const blocks: Record<string, string> = {};
  // Match ::BLOCKNAME (NOT ::END) ... ::END — multiline
  // Negative lookahead (?!END\b) prevents ::END from being treated as a block opener
  const pattern = /^::((?!END\b)\w+)\s*\n([\s\S]*?)^::END/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    const blockName = match[1].toUpperCase();
    blocks[blockName] = match[2];
  }
  return blocks;
}

// ── TASK_008: META key-value parser ────────────────────────

function parseStringValue(raw: string): string {
  const m = raw.match(/^"(.*)"$/s);
  return m ? m[1] : raw.trim();
}

function parseArrayValue(raw: string): string[] {
  const inner = raw.replace(/^\[/, '').replace(/\]$/, '').trim();
  if (!inner) return [];
  return inner
    .split(',')
    .map(s => s.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
}

function parseKeyValue(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    result[key] = parseStringValue(val);
  }
  return result;
}

export function parseMeta(content: string): AslMeta | undefined {
  const kv = parseKeyValue(content);
  if (!kv['id'] || !kv['packet_tier'] || !kv['type']) return undefined;
  const tier = parseInt(kv['packet_tier'], 10);
  return {
    id: kv['id'],
    version: kv['version'] || '',
    packet_tier: tier as PacketTier,
    type: kv['type'] as PacketType,
    policy_profile: kv['policy_profile'],
    owner: kv['owner'] || '',
    status: (kv['status'] as PacketStatus) || 'active',
  };
}

export function parseRole(content: string): AslRole | undefined {
  const kv = parseKeyValue(content);
  if (!kv['name']) return undefined;
  return { name: kv['name'], description: kv['description'] || '' };
}

export function parseScope(content: string): AslScope | undefined {
  const includedMatch = content.match(/included\s*=\s*(\[[\s\S]*?\])/);
  const excludedMatch = content.match(/excluded\s*=\s*(\[[\s\S]*?\])/);
  return {
    included: includedMatch ? parseArrayValue(includedMatch[1]) : [],
    excluded: excludedMatch ? parseArrayValue(excludedMatch[1]) : [],
  };
}

export function parseOutputContract(content: string): AslOutputContract | undefined {
  const requiredMatch = content.match(/required_outputs\s*=\s*(\[[\s\S]*?\])/);
  const forbiddenMatch = content.match(/forbidden_outputs\s*=\s*(\[[\s\S]*?\])/);
  const phraseMatch = content.match(/completion_phrase\s*=\s*"([^"]+)"/);
  return {
    required_outputs: requiredMatch ? parseArrayValue(requiredMatch[1]) : [],
    forbidden_outputs: forbiddenMatch ? parseArrayValue(forbiddenMatch[1]) : [],
    completion_phrase: phraseMatch ? phraseMatch[1] : '',
  };
}

export function parseReceipt(content: string): AslReceipt | undefined {
  const kv = parseKeyValue(content);
  return {
    enabled: kv['enabled'] === 'true',
    receipt_required: kv['receipt_required'] === 'true',
    ledger_required: kv['ledger_required'] === 'true',
    receipt_seals: kv['receipt_seals'],
  };
}

// ── TASK_009: Execution plan parser ────────────────────────

function parseBoolValue(v: string): boolean {
  return v.trim().toLowerCase() === 'true';
}

export function parseExecutionPlan(content: string): ExecutionPlan | undefined {
  // Extract task_count
  const countMatch = content.match(/task_count\s*=\s*(\d+)/);
  const justMatch = content.match(/task_count_justification\s*=\s*"([^"]+)"/);
  const taskCount = countMatch ? parseInt(countMatch[1], 10) : 0;

  // Extract each TASK_NNN block (indented key-value block)
  const tasks: Task[] = [];
  // Match TASK_NNN:\n  key = value blocks
  const taskPattern = /(TASK_\d{3}):\s*\n((?:[ \t]+[^\n]+\n?)*)/g;
  let m: RegExpExecArray | null;
  while ((m = taskPattern.exec(content)) !== null) {
    const id = m[1];
    const block = m[2];
    const kv = parseKeyValue(block);

    // parse depends_on array
    const depMatch = block.match(/depends_on\s*=\s*(\[[\s\S]*?\])/);
    const depends_on = depMatch ? parseArrayValue(depMatch[1]) : [];

    tasks.push({
      id,
      description: kv['description'] || '',
      required: parseBoolValue(kv['required'] || 'false'),
      depends_on,
      on_dependency_fail: (kv['on_dependency_fail'] as OnDependencyFail) || 'HALT',
      retry_max: parseInt(kv['retry_max'] || '0', 10),
      retry_backoff: kv['retry_backoff'] || 'none',
      on_retry_exhausted: kv['on_retry_exhausted'] || '',
      evidence_type: (kv['evidence_type'] as EvidenceType) || 'agent_assertion',
      evidence_template: kv['evidence_template'] || '',
      expected_result: kv['expected_result'] || '',
      status: (kv['status'] as TaskStatus) || 'PENDING',
    });
  }

  return { task_count: taskCount, task_count_justification: justMatch?.[1], tasks };
}

// ── Lock parser ─────────────────────────────────────────────

export function parseLocks(content: string): Lock[] {
  const locks: Lock[] = [];
  const lockPattern = /(LOCK_\d{3}):\s*\n((?:[ \t]+[^\n]+\n?)*)/g;
  let m: RegExpExecArray | null;
  while ((m = lockPattern.exec(content)) !== null) {
    const id = m[1];
    const block = m[2];
    const kv = parseKeyValue(block);
    const pairedMatch = block.match(/paired_with\s*=\s*(\[[\s\S]*?\])/);
    locks.push({
      id,
      rule: kv['rule'] || '',
      type: (kv['type'] as LockType) || 'runtime_enforced',
      enforced_by: kv['enforced_by'] || '',
      paired_with: pairedMatch ? parseArrayValue(pairedMatch[1]) : undefined,
      evidence_type: kv['evidence_type'] ? (kv['evidence_type'] as EvidenceType) : undefined,
    });
  }
  return locks;
}

// ── Gate parser ─────────────────────────────────────────────

export function parseGates(content: string): Gate[] {
  const gates: Gate[] = [];
  const gatePattern = /(GATE_\d{3}):\s*\n((?:[ \t]+[^\n]+\n?)*)/g;
  let m: RegExpExecArray | null;
  while ((m = gatePattern.exec(content)) !== null) {
    const id = m[1];
    const block = m[2];
    const kv = parseKeyValue(block);
    gates.push({
      id,
      condition: kv['condition'] || '',
      evaluator: kv['evaluator'] || '',
      evidence_type: (kv['evidence_type'] as EvidenceType) || 'agent_assertion',
      on_fail: (kv['on_fail'] as GateOnFail) || 'HALT',
      approval_id: kv['approval_id'] || undefined,
    });
  }
  return gates;
}

// ── Acceptance Test parser ──────────────────────────────────

export function parseAcceptanceTests(content: string): AcceptanceTestBlock | null {
  const countMatch = content.match(/count\s*=\s*(\d+)/);
  const count = countMatch ? parseInt(countMatch[1], 10) : 0;
  const tests: AcceptanceTest[] = [];
  const atPattern = /(AT_\d{3}):\s*\n((?:[ \t]+[^\n]+\n?)*)/g;
  let m: RegExpExecArray | null;
  while ((m = atPattern.exec(content)) !== null) {
    const id = m[1];
    const block = m[2];
    const kv = parseKeyValue(block);
    tests.push({
      id,
      name: kv['name'] || '',
      check: kv['check'] || '',
      pass_condition: kv['pass_condition'] || '',
      evaluator: kv['evaluator'] || '',
      evidence_type: (kv['evidence_type'] as EvidenceType) || 'agent_assertion',
      on_fail: kv['on_fail'] || 'HALT',
    });
  }
  return { count, tests };
}

// ── Verification Ledger parser ──────────────────────────────

export function parseVerificationLedger(content: string): VerificationLedger | undefined {
  const kv = parseKeyValue(content);
  return {
    required_task_count: parseInt(kv['required_task_count'] || '0', 10),
    required_gate_count: parseInt(kv['required_gate_count'] || '0', 10),
    required_lock_count: parseInt(kv['required_lock_count'] || '0', 10),
    required_acceptance_test_count: parseInt(kv['required_acceptance_test_count'] || '0', 10),
    required_receipt_count: parseInt(kv['required_receipt_count'] || '0', 10),
    ledger_status: (kv['ledger_status'] as 'PENDING' | 'COMPLETE' | 'FAILED') || 'PENDING',
  };
}

// ── Drift Marker parser (TASK_022 prep) ─────────────────────

export function parseDriftMarkers(raw: string): DriftMarker[] {
  const markers: DriftMarker[] = [];
  const lines = raw.split('\n');
  // Format: [TASK_NNN: STATUS | evidence_type: TYPE | evidence_ref: REF]
  const pattern = /\[(TASK_\d{3}):\s*(\w+)\s*\|\s*evidence_type:\s*(\S+)\s*\|\s*evidence_ref:\s*(.+?)\]/;
  lines.forEach((line, idx) => {
    const m = line.match(pattern);
    if (m) {
      markers.push({
        task_id: m[1],
        status: m[2] as TaskStatus,
        evidence_type: m[3] as EvidenceType,
        evidence_ref: m[4].trim(),
        raw: line.trim(),
        line_number: idx + 1,
      });
    }
  });
  return markers;
}

// ── v1.5.2: Approval record parser (human-gate enforcement) ──

/**
 * Parse signed approval records from a receipt/ledger.
 * Format: [APPROVAL: approval_id | approver: NAME | timestamp: TS | signature: SIG]
 * The signature field is what distinguishes a real approval record from a
 * free-text "approved by ..." line (which v1.5.1 accepted via text-grep).
 */
export function parseApprovalRecords(raw: string): ApprovalRecord[] {
  const records: ApprovalRecord[] = [];
  const lines = raw.split('\n');
  const pattern = /\[APPROVAL:\s*([A-Za-z0-9_\-]+)\s*\|\s*approver:\s*([^|\]]+?)\s*\|\s*timestamp:\s*([^|\]]+?)\s*\|\s*signature:\s*([^|\]]+?)\]/;
  lines.forEach((line, idx) => {
    const m = line.match(pattern);
    if (m) {
      records.push({
        approval_id: m[1].trim(),
        approver: m[2].trim(),
        timestamp: m[3].trim(),
        signature: m[4].trim(),
        raw: line.trim(),
        line_number: idx + 1,
      });
    }
  });
  return records;
}

// ── Main parse function ─────────────────────────────────────

export function parsePacket(raw: string): ParsedPacket {
  const aslBlocks = parseAslBlocks(raw);
  const gclBlocks = parseGclBlocks(raw);
  const parserIssues = [
    ...detectAslBlockIssues(raw),
    ...detectGclBlockIssues(raw),
  ];

  return {
    raw,
    aslBlocks,
    gclBlocks,
    parserIssues,
    meta: aslBlocks['META'] ? parseMeta(aslBlocks['META']) : undefined,
    role: aslBlocks['ROLE'] ? parseRole(aslBlocks['ROLE']) : undefined,
    scope: aslBlocks['SCOPE'] ? parseScope(aslBlocks['SCOPE']) : undefined,
    outputContract: aslBlocks['OUTPUT_CONTRACT'] ? parseOutputContract(aslBlocks['OUTPUT_CONTRACT']) : undefined,
    receipt: aslBlocks['RECEIPT'] ? parseReceipt(aslBlocks['RECEIPT']) : undefined,
    executionPlan: aslBlocks['EXECUTION_PLAN'] ? parseExecutionPlan(aslBlocks['EXECUTION_PLAN']) : undefined,
    locks: gclBlocks['LOCKS'] ? parseLocks(gclBlocks['LOCKS']) : [],
    gates: gclBlocks['GATES'] ? parseGates(gclBlocks['GATES']) : [],
    acceptanceTests: gclBlocks['ACCEPTANCE_TESTS'] ? parseAcceptanceTests(gclBlocks['ACCEPTANCE_TESTS']) : null,
    verificationLedger: gclBlocks['VERIFICATION_LEDGER'] ? parseVerificationLedger(gclBlocks['VERIFICATION_LEDGER']) : undefined,
    driftMarkers: parseDriftMarkers(raw),
  };
}
