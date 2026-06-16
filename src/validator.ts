import type {
  ParsedPacket, ValidationResult, ValidationIssue, Severity,
  EvidenceType
} from './types.js';
import {
  VALID_TIERS, TYPE_TIER_MAP,
  REQUIRED_ASL_BLOCKS_TIER1, REQUIRED_GCL_BLOCKS_TIER1,
  REQUIRED_ASL_BLOCKS_TIER2, REQUIRED_GCL_BLOCKS_TIER2,
  REQUIRED_ASL_BLOCKS_TIER3, REQUIRED_GCL_BLOCKS_TIER3,
  EVIDENCE_TEMPLATES, VALID_EVIDENCE_TYPES,
  RUNTIME_LOCK_EVIDENCE_TYPES, ATTESTATION_ENFORCED_BY, HONEST_ENFORCED_BY,
} from './schemas.js';
import { parseEvidenceRef, checkEvidenceTemplate } from './evidence.js';
import { validateProfile } from './profile-validator.js';

// ============================================================
// VALIDATOR — All rule checks TASK_010 through TASK_025
// ============================================================

function issue(severity: Severity, code: string, message: string, location?: string): ValidationIssue {
  return { severity, code, message, location };
}

// ── TASK_010: Tier + type validation ────────────────────────

function validateTier(packet: ParsedPacket, issues: ValidationIssue[]): boolean {
  const meta = packet.meta;
  if (!meta) {
    issues.push(issue('error', 'TIER_001', 'asl::META block missing or unparseable'));
    return false;
  }
  if (!VALID_TIERS.includes(meta.packet_tier)) {
    issues.push(issue('error', 'TIER_002', `Invalid packet_tier: ${meta.packet_tier}. Valid: ${VALID_TIERS.join(', ')}`, 'META'));
    return false;
  }
  const allowedTiers = TYPE_TIER_MAP[meta.type];
  if (!allowedTiers) {
    issues.push(issue('error', 'TIER_003', `Unknown packet type: "${meta.type}"`, 'META'));
    return false;
  }
  if (!allowedTiers.includes(meta.packet_tier)) {
    issues.push(issue('error', 'TIER_004',
      `Type "${meta.type}" is not allowed at tier ${meta.packet_tier}. Allowed tiers: ${allowedTiers.join(', ')}`, 'META'));
    return false;
  }
  return true;
}

// ── Parser issue surfacing ───────────────────────────────────

function validateParserIssues(packet: ParsedPacket, issues: ValidationIssue[]): boolean {
  let ok = true;
  for (const pi of packet.parserIssues) {
    issues.push({
      severity: pi.severity,
      code: pi.code,
      message: pi.message,
      location: 'PARSER',
    });
    if (pi.severity === 'error') ok = false;
  }
  return ok;
}

// ── TASK_011 + TASK_006(Phase2): Required block validation ───

function validateRequiredBlocks(packet: ParsedPacket, issues: ValidationIssue[]): boolean {
  const tier = packet.meta?.packet_tier ?? 0;
  let ok = true;

  let aslRequired: string[];
  let gclRequired: string[];
  if (tier === 1) {
    aslRequired = REQUIRED_ASL_BLOCKS_TIER1;
    gclRequired = REQUIRED_GCL_BLOCKS_TIER1;
  } else if (tier === 3) {
    aslRequired = REQUIRED_ASL_BLOCKS_TIER3;
    gclRequired = REQUIRED_GCL_BLOCKS_TIER3;
  } else {
    // tier 2 (default)
    aslRequired = REQUIRED_ASL_BLOCKS_TIER2;
    gclRequired = REQUIRED_GCL_BLOCKS_TIER2;
  }

  for (const b of aslRequired) {
    if (!packet.aslBlocks[b]) {
      issues.push(issue('error', 'BLOCK_001', `Missing required ASL block: asl::${b}`, b));
      ok = false;
    }
  }
  for (const b of gclRequired) {
    if (!packet.gclBlocks[b]) {
      issues.push(issue('error', 'BLOCK_002', `Missing required GCL block: ::${b}`, b));
      ok = false;
    }
  }
  return ok;
}

// ── TASK_012: Task count, duplicate IDs, contiguous IDs ─────

function validateTaskStructure(packet: ParsedPacket, issues: ValidationIssue[]): boolean {
  const plan = packet.executionPlan;
  if (!plan) {
    if (packet.meta?.packet_tier === 2) {
      issues.push(issue('error', 'TASK_001', 'Execution plan missing (required for tier 2)'));
      return false;
    }
    return true;
  }
  let ok = true;
  const tasks = plan.tasks;
  const declared = plan.task_count;
  const actual = tasks.length;

  if (declared !== actual) {
    issues.push(issue('error', 'TASK_002',
      `task_count mismatch: declared ${declared}, found ${actual}`, 'EXECUTION_PLAN'));
    ok = false;
  }

  // Check duplicate IDs
  const seen = new Set<string>();
  for (const t of tasks) {
    if (seen.has(t.id)) {
      issues.push(issue('error', 'TASK_003', `Duplicate task ID: ${t.id}`, t.id));
      ok = false;
    }
    seen.add(t.id);
  }

  // Check contiguous IDs
  const ids = tasks.map(t => parseInt(t.id.replace('TASK_', ''), 10)).sort((a, b) => a - b);
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] !== i + 1) {
      issues.push(issue('error', 'TASK_004',
        `Non-contiguous task IDs: expected TASK_${String(i + 1).padStart(3, '0')}, found TASK_${String(ids[i]).padStart(3, '0')}`,
        'EXECUTION_PLAN'));
      ok = false;
      break;
    }
  }
  return ok;
}

// ── TASK_013: Dependency reference validation ────────────────

function validateDependencies(packet: ParsedPacket, issues: ValidationIssue[]): boolean {
  const plan = packet.executionPlan;
  if (!plan) return true;
  let ok = true;
  const taskIds = new Set(plan.tasks.map(t => t.id));
  for (const t of plan.tasks) {
    for (const dep of t.depends_on) {
      if (dep && !taskIds.has(dep)) {
        issues.push(issue('error', 'DEP_001',
          `Task ${t.id} depends_on "${dep}" which does not exist`, t.id));
        ok = false;
      }
    }
  }
  return ok;
}

// ── TASK_014: Required task cannot use SKIP ──────────────────

function validateRequiredTaskSkip(packet: ParsedPacket, issues: ValidationIssue[]): boolean {
  const plan = packet.executionPlan;
  if (!plan) return true;
  let ok = true;
  for (const t of plan.tasks) {
    if (t.required && t.on_dependency_fail === 'SKIP') {
      issues.push(issue('error', 'TASK_005',
        `Task ${t.id} is required=true but uses on_dependency_fail=SKIP (forbidden)`, t.id));
      ok = false;
    }
  }
  return ok;
}

// ── TASK_015: Retry config validation ───────────────────────

function validateRetryConfig(packet: ParsedPacket, issues: ValidationIssue[]): boolean {
  const plan = packet.executionPlan;
  if (!plan) return true;
  let ok = true;
  for (const t of plan.tasks) {
    if (t.on_dependency_fail === 'RETRY') {
      if (!t.retry_max || t.retry_max <= 0) {
        issues.push(issue('error', 'RETRY_001',
          `Task ${t.id} uses RETRY but retry_max is 0 or missing`, t.id));
        ok = false;
      }
      if (!t.retry_backoff || t.retry_backoff === 'none') {
        issues.push(issue('warning', 'RETRY_002',
          `Task ${t.id} uses RETRY but retry_backoff is "none"`, t.id));
      }
      if (!t.on_retry_exhausted) {
        issues.push(issue('error', 'RETRY_003',
          `Task ${t.id} uses RETRY but on_retry_exhausted is not set`, t.id));
        ok = false;
      }
    }
  }
  return ok;
}

// ── TASK_016: Lock structure validation ─────────────────────

function validateLockStructure(packet: ParsedPacket, issues: ValidationIssue[]): boolean {
  if (!packet.locks.length && packet.meta?.packet_tier === 2) {
    issues.push(issue('warning', 'LOCK_001', 'No locks found in tier 2 packet'));
  }
  let ok = true;
  for (const lock of packet.locks) {
    if (!lock.rule) {
      issues.push(issue('error', 'LOCK_002', `${lock.id}: missing "rule" field`, lock.id));
      ok = false;
    }
    if (!['behavioral', 'runtime_enforced'].includes(lock.type)) {
      issues.push(issue('error', 'LOCK_003',
        `${lock.id}: invalid type "${lock.type}". Must be behavioral or runtime_enforced`, lock.id));
      ok = false;
    }
    if (!lock.enforced_by) {
      issues.push(issue('error', 'LOCK_004', `${lock.id}: missing "enforced_by" field`, lock.id));
      ok = false;
    }
  }
  return ok;
}

// ── TASK_017 + TASK_009(Phase2): Behavioral lock pairing validation ──
// paired_with may reference AT, GATE, or TASK IDs

function validateBehavioralLockPairing(packet: ParsedPacket, issues: ValidationIssue[]): boolean {
  let ok = true;
  const atIds = new Set((packet.acceptanceTests?.tests ?? []).map(a => a.id));
  const gateIds = new Set(packet.gates.map(g => g.id));
  const taskIds = new Set((packet.executionPlan?.tasks ?? []).map(t => t.id));

  for (const lock of packet.locks) {
    if (lock.type === 'behavioral') {
      if (!lock.paired_with || lock.paired_with.length === 0) {
        issues.push(issue('error', 'LOCK_005',
          `${lock.id}: behavioral lock has no paired_with references`, lock.id));
        ok = false;
        continue;
      }
      for (const ref of lock.paired_with) {
        if (!atIds.has(ref) && !gateIds.has(ref) && !taskIds.has(ref)) {
          issues.push(issue('error', 'LOCK_006',
            `${lock.id}: paired_with "${ref}" does not match any AT, GATE, or TASK ID`, lock.id));
          ok = false;
        }
      }
    }
  }
  return ok;
}

// ── TASK_018: Gate validation ────────────────────────────────

function validateGates(packet: ParsedPacket, issues: ValidationIssue[]): boolean {
  let ok = true;
  const validOnFail = ['HALT', 'WARN', 'SKIP'];
  for (const g of packet.gates) {
    if (!g.condition) {
      issues.push(issue('error', 'GATE_001', `${g.id}: missing "condition" field`, g.id));
      ok = false;
    }
    if (!g.evaluator) {
      issues.push(issue('error', 'GATE_002', `${g.id}: missing "evaluator" field`, g.id));
      ok = false;
    }
    if (!VALID_EVIDENCE_TYPES.has(g.evidence_type)) {
      issues.push(issue('error', 'GATE_003',
        `${g.id}: invalid evidence_type "${g.evidence_type}"`, g.id));
      ok = false;
    }
    if (!validOnFail.includes(g.on_fail)) {
      issues.push(issue('error', 'GATE_004',
        `${g.id}: invalid on_fail "${g.on_fail}". Must be HALT, WARN, or SKIP`, g.id));
      ok = false;
    }
  }
  return ok;
}

// ── TASK_019: Acceptance test validation ─────────────────────

function validateAcceptanceTests(packet: ParsedPacket, issues: ValidationIssue[]): boolean {
  const atBlock = packet.acceptanceTests;
  if (!atBlock) {
    if (packet.meta?.packet_tier === 2) {
      issues.push(issue('error', 'AT_001', 'ACCEPTANCE_TESTS block missing (required for tier 2)'));
      return false;
    }
    return true;
  }
  let ok = true;
  const declared = atBlock.count;
  const actual = atBlock.tests.length;
  if (declared !== actual) {
    issues.push(issue('error', 'AT_002',
      `ACCEPTANCE_TESTS count mismatch: declared ${declared}, found ${actual}`));
    ok = false;
  }
  for (const at of atBlock.tests) {
    if (!at.name)           { issues.push(issue('error', 'AT_003', `${at.id}: missing "name"`, at.id)); ok = false; }
    if (!at.check)          { issues.push(issue('error', 'AT_004', `${at.id}: missing "check"`, at.id)); ok = false; }
    if (!at.pass_condition) { issues.push(issue('error', 'AT_005', `${at.id}: missing "pass_condition"`, at.id)); ok = false; }
    if (!at.evaluator)      { issues.push(issue('error', 'AT_006', `${at.id}: missing "evaluator"`, at.id)); ok = false; }
    if (!VALID_EVIDENCE_TYPES.has(at.evidence_type)) {
      issues.push(issue('error', 'AT_007', `${at.id}: invalid evidence_type "${at.evidence_type}"`, at.id));
      ok = false;
    }
  }
  return ok;
}

// ── TASK_020: Evidence type validation ───────────────────────

function validateEvidenceTypes(packet: ParsedPacket, issues: ValidationIssue[]): boolean {
  let ok = true;
  const plan = packet.executionPlan;
  if (!plan) return true;
  for (const t of plan.tasks) {
    if (!VALID_EVIDENCE_TYPES.has(t.evidence_type)) {
      issues.push(issue('error', 'EVT_001',
        `Task ${t.id}: invalid evidence_type "${t.evidence_type}"`, t.id));
      ok = false;
    }
  }
  return ok;
}

// ── TASK_021: Evidence template field validation ─────────────

function validateEvidenceTemplates(packet: ParsedPacket, issues: ValidationIssue[]): boolean {
  // Validate that each task's evidence_template matches a known evidence type
  // and that agent_assertion evidence is flagged as warning
  let ok = true;
  const plan = packet.executionPlan;
  if (!plan) return true;
  for (const t of plan.tasks) {
    const evType = t.evidence_type as EvidenceType;
    const template = EVIDENCE_TEMPLATES[evType];
    if (!template) continue; // already caught by TASK_020

    if (evType === 'agent_assertion') {
      issues.push(issue('warning', 'EVT_002',
        `Task ${t.id}: uses agent_assertion evidence (severity: warning; cannot be used for gate pass or acceptance test)`,
        t.id));
    }
    // Check that evidence_template field matches evidence_type
    if (t.evidence_template && t.evidence_template !== evType &&
        t.evidence_template !== t.evidence_type) {
      issues.push(issue('warning', 'EVT_003',
        `Task ${t.id}: evidence_template "${t.evidence_template}" does not match evidence_type "${t.evidence_type}"`,
        t.id));
    }
  }
  return ok;
}

// ── TASK_024: Completion block validation ────────────────────

const REQUIRED_COMPLETE_ONLY_IF = [
  'all_required_tasks_COMPLETE', 'all_gates_passed', 'all_runtime_locks_verified',
  'all_behavioral_locks_reported', 'all_acceptance_tests_passed', 'drift_check_passed',
  'verification_ledger_exists', 'receipt_exists', 'receipt_seals_verification_ledger',
];
const REQUIRED_INVALID_IF = [
  'any_required_task_FAILED', 'any_required_task_SKIPPED', 'any_required_task_BLOCKED',
  'any_task_RETRYING_at_completion', 'gate_failed', 'runtime_lock_violation',
  'acceptance_test_failed', 'drift_event_unresolved', 'ledger_missing', 'receipt_missing',
];

function validateCompletionBlock(packet: ParsedPacket, issues: ValidationIssue[]): boolean {
  const completionRaw = packet.gclBlocks['COMPLETION'];
  if (!completionRaw) {
    const tier = packet.meta?.packet_tier ?? 0;
    if (tier === 2 || tier === 3) {
      issues.push(issue('error', 'COMP_001', `COMPLETION block missing (required for tier ${tier})`));
      return false;
    }
    return true;
  }
  let ok = true;
  for (const rule of REQUIRED_COMPLETE_ONLY_IF) {
    if (!completionRaw.includes(rule)) {
      issues.push(issue('warning', 'COMP_002',
        `COMPLETION block missing complete_only_if rule: "${rule}"`, 'COMPLETION'));
    }
  }
  for (const rule of REQUIRED_INVALID_IF) {
    if (!completionRaw.includes(rule)) {
      issues.push(issue('warning', 'COMP_003',
        `COMPLETION block missing completion_invalid_if rule: "${rule}"`, 'COMPLETION'));
    }
  }
  return ok;
}

// ── TASK_025: Verification ledger validation ─────────────────

function validateVerificationLedger(packet: ParsedPacket, issues: ValidationIssue[]): boolean {
  const ledger = packet.verificationLedger;
  if (!ledger) {
    const tier = packet.meta?.packet_tier ?? 0;
    if (tier === 2 || tier === 3) {
      issues.push(issue('error', 'LEDGER_001', `VERIFICATION_LEDGER block missing (required for tier ${tier})`));
      return false;
    }
    return true;
  }
  let ok = true;
  const fields: Array<keyof typeof ledger> = [
    'required_task_count', 'required_gate_count', 'required_lock_count',
    'required_acceptance_test_count', 'required_receipt_count',
  ];
  for (const f of fields) {
    if (ledger[f] === undefined || ledger[f] === null) {
      issues.push(issue('error', 'LEDGER_002',
        `VERIFICATION_LEDGER missing required field: "${f}"`, 'VERIFICATION_LEDGER'));
      ok = false;
    }
  }
  if (!['PENDING', 'COMPLETE', 'FAILED'].includes(ledger.ledger_status)) {
    issues.push(issue('error', 'LEDGER_003',
      `VERIFICATION_LEDGER invalid ledger_status: "${ledger.ledger_status}"`, 'VERIFICATION_LEDGER'));
    ok = false;
  }
  return ok;
}

// ── v1.5.2 GOV_001/002: Honest enforcement terminology ───────
// Flags locks whose `enforced_by` claims enforcement but is actually
// attestation (agent self-report). Warning, not error — the packet still
// validates, but it must not misrepresent attestation as enforcement.

function validateEnforcementTerminology(packet: ParsedPacket, issues: ValidationIssue[]): boolean {
  let honest = true;
  for (const lock of packet.locks) {
    const eb = (lock.enforced_by || '').trim().toLowerCase();
    if (!eb) continue;
    if (ATTESTATION_ENFORCED_BY.has(eb)) {
      honest = false;
      issues.push(issue('warning', 'GOV_001',
        `${lock.id}: enforced_by = "${lock.enforced_by}" is ATTESTATION (agent self-report), not enforcement. ` +
        `Use an honest term: ${[...HONEST_ENFORCED_BY].join(', ')}.`,
        lock.id));
    } else if (!HONEST_ENFORCED_BY.has(eb)) {
      issues.push(issue('info', 'GOV_002',
        `${lock.id}: enforced_by = "${lock.enforced_by}" is not a recognized v1.5.2 enforcement term ` +
        `(${[...HONEST_ENFORCED_BY].join(', ')}).`,
        lock.id));
    }
  }
  return honest;
}

// ── v1.5.2 LOCK_007/008: Runtime lock external evidence ──────
// A runtime_enforced lock must be backed by EXTERNAL evidence. agent_assertion
// (or attestation enforced_by) is forbidden → error. Missing any external
// evidence declaration → warning (migration signal), so existing packets that
// predate the field do not hard-break.

function validateRuntimeLockEvidence(packet: ParsedPacket, issues: ValidationIssue[]): boolean {
  let ok = true;
  for (const lock of packet.locks) {
    if (lock.type !== 'runtime_enforced') continue;
    const evType = lock.evidence_type;
    const eb = (lock.enforced_by || '').trim().toLowerCase();

    if (evType === 'agent_assertion') {
      issues.push(issue('error', 'LOCK_007',
        `${lock.id}: runtime_enforced lock declares evidence_type = "agent_assertion". ` +
        `Runtime locks require external evidence: ${[...RUNTIME_LOCK_EVIDENCE_TYPES].join(', ')}.`,
        lock.id));
      ok = false;
      continue;
    }
    if (evType && !RUNTIME_LOCK_EVIDENCE_TYPES.has(evType)) {
      issues.push(issue('error', 'LOCK_007',
        `${lock.id}: runtime_enforced lock declares evidence_type = "${evType}", which is not external. ` +
        `Allowed: ${[...RUNTIME_LOCK_EVIDENCE_TYPES].join(', ')}.`,
        lock.id));
      ok = false;
      continue;
    }
    if (!evType) {
      // No external evidence declared, and enforced_by is attestation → can't be proven externally.
      if (ATTESTATION_ENFORCED_BY.has(eb) || !eb) {
        issues.push(issue('warning', 'LOCK_008',
          `${lock.id}: runtime_enforced lock has no external evidence_type and relies on attestation ` +
          `(enforced_by = "${lock.enforced_by || 'unset'}"). Declare one of: ` +
          `${[...RUNTIME_LOCK_EVIDENCE_TYPES].join(', ')} to make the lock externally verifiable.`,
          lock.id));
      }
    }
  }
  return ok;
}

// ── v1.5.2 GATE_005: Human gates must reference an approval_id ─
// A gate with evaluator = "human" must carry an approval_id that a signed
// approval record in the ledger/receipt can be matched against (REC_019).
// Replaces v1.5.1 reliance on free-text "Drift Report" grep for approvals.

function validateHumanGateApprovals(packet: ParsedPacket, issues: ValidationIssue[]): boolean {
  let ok = true;
  for (const g of packet.gates) {
    if ((g.evaluator || '').trim().toLowerCase() !== 'human') continue;
    if (!g.approval_id || !g.approval_id.trim()) {
      issues.push(issue('error', 'GATE_005',
        `${g.id}: human gate (evaluator = "human") must declare an approval_id referencing a ` +
        `signed approval record. Free-text approval is no longer accepted (v1.5.2).`,
        g.id));
      ok = false;
    }
  }
  return ok;
}

// ── Main validate function ───────────────────────────────────

// ── TASK_007 (Phase2): Evidence_ref template check on tasks ──

function validateTaskEvidenceRefs(packet: ParsedPacket, issues: ValidationIssue[]): boolean {
  const plan = packet.executionPlan;
  if (!plan) return true;
  let ok = true;
  for (const t of plan.tasks) {
    const evType = t.evidence_type as EvidenceType;
    if (!VALID_EVIDENCE_TYPES.has(evType)) continue; // already caught
    // Only validate if the task has a structured evidence_ref (pipe-delimited)
    if (!t.expected_result.includes(':') && !t.expected_result.includes('|')) continue;
    const ref = parseEvidenceRef(t.expected_result, evType);
    const missing = checkEvidenceTemplate(evType, ref);
    if (missing.length > 0) {
      issues.push(issue('warning', 'EVT_004',
        `Task ${t.id}: expected_result appears to be an evidence_ref but is missing fields: ${missing.join(', ')}`,
        t.id));
    }
  }
  return ok;
}

export function validate(packet: ParsedPacket): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Parser issues surfaced first
  validateParserIssues(packet, issues);
  const tierOk          = validateTier(packet, issues);
  const blocksOk        = validateRequiredBlocks(packet, issues);
  const taskStructOk    = validateTaskStructure(packet, issues);
  const depsOk          = validateDependencies(packet, issues);
  const skipOk          = validateRequiredTaskSkip(packet, issues);
  const retryOk         = validateRetryConfig(packet, issues);
  const lockStructOk    = validateLockStructure(packet, issues);
  const lockPairOk      = validateBehavioralLockPairing(packet, issues);
  const gatesOk         = validateGates(packet, issues);
  const atsOk           = validateAcceptanceTests(packet, issues);
  const evTypesOk       = validateEvidenceTypes(packet, issues);
  const evTemplatesOk   = validateEvidenceTemplates(packet, issues);
  validateTaskEvidenceRefs(packet, issues);
  const completionOk    = validateCompletionBlock(packet, issues);
  const ledgerOk        = validateVerificationLedger(packet, issues);

  // v1.5.2 governance hardening
  const terminologyOk   = validateEnforcementTerminology(packet, issues);
  const runtimeLockOk   = validateRuntimeLockEvidence(packet, issues);
  const humanGateOk     = validateHumanGateApprovals(packet, issues);
  // Authority-block uniqueness is enforced in the parser (PARSE_005, surfaced
  // via validateParserIssues). Reflect its outcome in checks for visibility.
  const authorityUnique = !packet.parserIssues.some(p => p.code === 'PARSE_005');

  // Phase 6: policy profile validation (PROF_001–006)
  const profileResult = validateProfile(packet);
  for (const pi of profileResult.issues) {
    issues.push(pi);
  }
  const profileOk = profileResult.valid;

  const errors   = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const info     = issues.filter(i => i.severity === 'info').length;

  return {
    valid: errors === 0,
    packet_id:   packet.meta?.id,
    packet_tier: packet.meta?.packet_tier,
    packet_type: packet.meta?.type,
    issues,
    summary: { errors, warnings, info },
    checks: {
      tier_valid:               tierOk,
      required_blocks_present:  blocksOk,
      task_count_valid:         taskStructOk,
      task_ids_valid:           taskStructOk,
      dependency_refs_valid:    depsOk,
      required_task_skip_check: skipOk,
      retry_config_valid:       retryOk,
      locks_valid:              lockStructOk,
      behavioral_locks_paired:  lockPairOk,
      gates_valid:              gatesOk,
      acceptance_tests_valid:   atsOk,
      evidence_types_valid:     evTypesOk,
      evidence_templates_valid: evTemplatesOk,
      drift_markers_valid:      true, // set by drift.ts
      completion_block_valid:   completionOk,
      verification_ledger_valid: ledgerOk,
      policy_profile_valid:     profileOk,
      authority_blocks_unique:            authorityUnique,
      runtime_locks_externally_evidenced: runtimeLockOk,
      human_gates_have_approval_id:       humanGateOk,
      enforcement_terminology_honest:     terminologyOk,
    },
  };
}
