// ASL Packet Validator — Core Types
// ASL Lite + GCL Packet Standard v1.5.2

export type PacketTier = 1 | 2 | 3;
export type PacketType = 'review' | 'build' | 'query' | 'analysis' | 'deploy' | 'report';
export type PacketStatus = 'active' | 'draft' | 'archived';

export type EvidenceType =
  | 'file_read' | 'file_write' | 'command_output' | 'gate_check'
  | 'acceptance_test' | 'human_confirmation' | 'agent_assertion'
  // v1.5.2 external evidence types (runtime-lock eligible)
  | 'file_checksum' | 'tool_call_log' | 'approval_token';

export interface AslMeta {
  id: string;
  version: string;
  packet_tier: PacketTier;
  type: PacketType;
  policy_profile?: string;
  owner: string;
  status: PacketStatus;
}

export interface AslRole { name: string; description: string; }
export interface AslScope { included: string[]; excluded: string[]; }

export interface AslOutputContract {
  required_outputs: string[];
  forbidden_outputs: string[];
  completion_phrase: string;
}

export interface AslReceipt {
  enabled: boolean;
  receipt_required: boolean;
  ledger_required: boolean;
  receipt_seals?: string;
}

export type OnDependencyFail = 'HALT' | 'SKIP' | 'RETRY';
export type TaskStatus = 'PENDING' | 'COMPLETE' | 'FAILED' | 'SKIPPED' | 'BLOCKED' | 'RETRYING';

export interface Task {
  id: string;
  description: string;
  required: boolean;
  depends_on: string[];
  on_dependency_fail: OnDependencyFail;
  retry_max: number;
  retry_backoff: string;
  on_retry_exhausted: string;
  evidence_type: EvidenceType;
  evidence_template: string;
  expected_result: string;
  status: TaskStatus;
}

export interface ExecutionPlan {
  task_count: number;
  task_count_justification?: string;
  tasks: Task[];
}

export type LockType = 'behavioral' | 'runtime_enforced';

export interface Lock {
  id: string;
  rule: string;
  type: LockType;
  enforced_by: string;
  paired_with?: string[];
  /** v1.5.2: evidence type used to prove the lock held (external types only for runtime_enforced) */
  evidence_type?: EvidenceType;
}

export type GateOnFail = 'HALT' | 'WARN' | 'SKIP';

export interface Gate {
  id: string;
  condition: string;
  evaluator: string;
  evidence_type: EvidenceType;
  on_fail: GateOnFail;
  /** v1.5.2: required when evaluator = "human" — references a signed approval record */
  approval_id?: string;
}

// ── v1.5.2: Approval records (human-gate enforcement) ────────

export interface ApprovalRecord {
  approval_id: string;
  approver: string;
  timestamp: string;
  /** signature / token proving the approval is not a plain-text claim */
  signature: string;
  raw: string;
  line_number: number;
}

export interface AcceptanceTest {
  id: string;
  name: string;
  check: string;
  pass_condition: string;
  evaluator: string;
  evidence_type: EvidenceType;
  on_fail: string;
}

export interface AcceptanceTestBlock { count: number; tests: AcceptanceTest[]; }

export interface VerificationLedger {
  required_task_count: number;
  required_gate_count: number;
  required_lock_count: number;
  required_acceptance_test_count: number;
  required_receipt_count: number;
  ledger_status: 'PENDING' | 'COMPLETE' | 'FAILED';
}

export interface DriftMarker {
  task_id: string;
  status: TaskStatus;
  evidence_type: EvidenceType | string;
  evidence_ref: string;
  raw: string;
  line_number: number;
}

export interface ParserIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface ParsedPacket {
  raw: string;
  aslBlocks: Record<string, string>;
  gclBlocks: Record<string, string>;
  /** Issues detected during parsing (unclosed blocks, duplicates, etc.) */
  parserIssues: ParserIssue[];
  meta?: AslMeta;
  role?: AslRole;
  scope?: AslScope;
  outputContract?: AslOutputContract;
  receipt?: AslReceipt;
  executionPlan?: ExecutionPlan;
  locks: Lock[];
  gates: Gate[];
  acceptanceTests: AcceptanceTestBlock | null;
  verificationLedger?: VerificationLedger;
  driftMarkers: DriftMarker[];
}

export type Severity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  severity: Severity;
  code: string;
  message: string;
  location?: string;
}

export interface ValidationResult {
  valid: boolean;
  packet_id?: string;
  packet_tier?: PacketTier;
  packet_type?: PacketType;
  issues: ValidationIssue[];
  summary: { errors: number; warnings: number; info: number; };
  checks: {
    tier_valid: boolean;
    required_blocks_present: boolean;
    task_count_valid: boolean;
    task_ids_valid: boolean;
    dependency_refs_valid: boolean;
    required_task_skip_check: boolean;
    retry_config_valid: boolean;
    locks_valid: boolean;
    behavioral_locks_paired: boolean;
    gates_valid: boolean;
    acceptance_tests_valid: boolean;
    evidence_types_valid: boolean;
    evidence_templates_valid: boolean;
    drift_markers_valid: boolean;
    completion_block_valid: boolean;
    verification_ledger_valid: boolean;
    /** Phase 6: policy_profile exists and packet meets profile minimums */
    policy_profile_valid: boolean;
    /** v1.5.2: no duplicate authority-bearing blocks */
    authority_blocks_unique?: boolean;
    /** v1.5.2: runtime_enforced locks declare external (non-attestation) evidence */
    runtime_locks_externally_evidenced?: boolean;
    /** v1.5.2: human gates reference an approval_id */
    human_gates_have_approval_id?: boolean;
    /** v1.5.2: enforcement terminology is honest (no attestation masquerading as enforcement) */
    enforcement_terminology_honest?: boolean;
  };
}

// ── Phase 6: Policy profile validation ───────────────────────

export interface ProfileValidationCheck {
  profile_found: boolean;
  tier_compatible: boolean;
  type_compatible: boolean;
  lock_count_meets_minimum: boolean;
  gate_count_meets_minimum: boolean;
  at_count_meets_minimum: boolean;
}

export interface ProfileValidationResult {
  valid: boolean;
  profile_id: string | null;
  profile_name: string | null;
  issues: ValidationIssue[];
  summary: { errors: number; warnings: number; info: number };
  checks: ProfileValidationCheck;
}

// ── Phase 3: Ledger validation ───────────────────────────────

// ── Phase 4: Ledger count cross-check ────────────────────────

export interface LedgerCountSet {
  required_task_count: number | null;
  required_gate_count: number | null;
  required_lock_count: number | null;
  required_acceptance_test_count: number | null;
  required_receipt_count: number | null;
}

export interface LedgerCountCrossCheck {
  /** Counts declared in packet ::VERIFICATION_LEDGER */
  packet_declared: LedgerCountSet;
  /** Counts reported in final ledger ::VERIFICATION_LEDGER (null = block absent) */
  ledger_reported: LedgerCountSet;
  /** Per-field match results */
  matches: {
    task_count: boolean;
    gate_count: boolean;
    lock_count: boolean;
    acceptance_test_count: boolean;
    receipt_count: boolean;
  };
  /** true only if ledger_reported block was found AND all counts match */
  valid: boolean;
  /** true if the ledger file contained no ::VERIFICATION_LEDGER block */
  block_absent: boolean;
}

export interface LedgerValidationResult {
  valid: boolean;
  ledger_file: string;
  packet_task_count: number;
  ledger_marker_count: number;
  issues: ValidationIssue[];
  summary: { errors: number; warnings: number; info: number; };
  checks: {
    task_count_matches: boolean;
    marker_ids_contiguous: boolean;
    no_duplicate_markers: boolean;
    required_tasks_complete: boolean;
    evidence_refs_valid: boolean;
    checksums_valid: boolean;
    no_retrying_at_completion: boolean;
    ledger_count_crosscheck_valid: boolean;
  };
  evidence_validation: {
    total: number;
    validated: number;   // file existed and hash was computed
    failed: number;      // checksum mismatch or fake placeholder
    skipped: number;     // file not found / non-file evidence
  };
  /** Phase 4: count cross-check result (always present) */
  ledger_count_crosscheck: LedgerCountCrossCheck;
}

// ── Signet v0.1: Governance runtime types ────────────────────

/** What category of effect an action has. Derived from evidence_type. */
export type ActionKind = 'read' | 'write' | 'execute' | 'approve' | 'assert';

/** How the action's targets were obtained — honesty marker, recorded in receipt. */
export type ActionSource = 'declared' | 'extracted';

export interface Action {
  /** Task this action belongs to. */
  task_id: string;
  /** Effect category, derived from the task's evidence_type. */
  kind: ActionKind;
  /**
   * Resource identifiers this action touches (paths, file names).
   * v0.1: extracted from description + expected_result via TARGET_PATTERN.
   * v0.2+: supplied by the live agent as declared intent.
   */
  targets: string[];
  /** Task description, verbatim — for humans reading the receipt. */
  description: string;
  /** 'extracted' in v0.1 (regex-derived); 'declared' when an agent supplies them. */
  source: ActionSource;
}

export type EvalResult = 'PASS' | 'FAIL' | 'UNEVALUATED';
export type GovernanceVerdict = 'PASS' | 'FAIL';

export interface BlockEvent {
  task_id: string;
  /** Lock attributed to this block. */
  lock_id: string;
  lock_rule: string;
  lock_type: LockType;
  /** 'rule_token' = lock rule text contained the matched pattern; else packet-level. */
  attribution: 'rule_token' | 'packet_level';
  /** The structured pattern that actually fired — this is the mechanical evidence. */
  matched_pattern: string;
  pattern_source: 'scope.excluded' | 'output_contract.forbidden_outputs';
  /** The declared target that matched. */
  matched_target: string;
  action_kind: ActionKind;
  action_description: string;
  severity: 'error';
  timestamp: string;
}

export interface TaskResult {
  task_id: string;
  status: TaskStatus;
  required: boolean;
  action: Action;
  evidence_type: EvidenceType;
  /** 'simulated' until v0.2 live execution provides real evidence. Honesty marker. */
  evidence_mode: 'simulated' | 'live';
  blocked_by: string[];
  note: string;
}

export interface GateResult {
  gate_id: string;
  condition: string;
  result: EvalResult;
  method: 'dependency_order' | 'approval_record' | 'unevaluated';
  on_fail: GateOnFail;
  /** true if this gate's failure halted the run. */
  halted_run: boolean;
}

export interface AcceptanceTestResult {
  at_id: string;
  name: string;
  result: EvalResult;
  method: 'scope_containment' | 'unevaluated';
  detail: string;
}

export interface BehavioralLockReport {
  lock_id: string;
  rule: string;
  paired_with: string[];
  verified_by: 'acceptance_test' | 'gate' | 'unevaluated';
  result: EvalResult;
}

export interface LedgerCrossCheck {
  declared: VerificationLedger | null;
  observed: {
    task_count: number;
    gate_count: number;
    lock_count: number;
    acceptance_test_count: number;
    receipt_count: 1;
  };
  matches: boolean;
}

export interface GovernanceReceipt {
  receipt_version: 'signet-receipt-v1';
  receipt_id: string;
  parent_receipt_id: string | null;
  packet: {
    id: string;
    sha256: string;
    tier: PacketTier;
    type: PacketType;
  };
  action: 'governed_execution';
  verdict: 'allowed' | 'blocked' | 'warned';
  outcome: 'passed' | 'failed';
  summary: {
    tasks_total: number;
    tasks_complete: number;
    tasks_blocked: number;
    tasks_skipped: number;
    tasks_failed: number;
    blocks_recorded: number;
    gates_passed: number;
    gates_failed: number;
    gates_unevaluated: number;
    ats_passed: number;
    ats_failed: number;
    ats_unevaluated: number;
  };
  task_results: TaskResult[];
  block_events: BlockEvent[];
  gate_results: GateResult[];
  behavioral_reports: BehavioralLockReport[];
  acceptance_results: AcceptanceTestResult[];
  ledger_crosscheck: LedgerCrossCheck;
  timestamps: { started_at: string; finished_at: string };
  canon: 'XAS-CANON-1';
  /** Computed LAST, over the receipt minus `hashes` and `signature`. */
  hashes: { sha256: string; h10: string };
  /** null in v0.1 — explicitly unsigned. */
  signature: null;
}

export interface GovernanceResult {
  verdict: GovernanceVerdict;
  packet_id: string;
  receipt: GovernanceReceipt;
  /** Warnings surfaced to CLI (unevaluated gates/ATs, packet_level attributions). */
  warnings: string[];
}

export interface GovernOptions {
  /** Override derived actions (v0.2 live agents pass declared actions here). */
  actions?: Action[];
  /** Receipt lineage. */
  parent_receipt_id?: string | null;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

// ── Phase 5: Strict Receipt validation ───────────────────────

export interface ReceiptValidationResult {
  valid: boolean;
  receipt_file: string;
  packet_task_count: number;
  receipt_marker_count: number;
  /** Always true — identifies this as strict receipt mode */
  strict_mode: true;
  issues: ValidationIssue[];
  summary: { errors: number; warnings: number; info: number; };
  checks: {
    task_count_matches: boolean;
    marker_ids_contiguous: boolean;
    no_duplicate_markers: boolean;
    required_tasks_complete: boolean;
    evidence_refs_valid: boolean;
    /** Strict: fake checksum on missing file = REC_009 error (vs LED_009 warning in ledger mode) */
    checksums_valid: boolean;
    no_retrying_at_completion: boolean;
    /** REC_017: agent_assertion evidence must be listed in Drift Report section */
    agent_assertions_in_drift_report: boolean;
    receipt_count_crosscheck_valid: boolean;
    /** v1.5.2 REC_018: no forbidden outputs (secrets / forbidden paths) in produced artifacts */
    forbidden_outputs_clean?: boolean;
    /** v1.5.2 REC_019: every human gate has a matching signed approval record */
    human_gate_approvals_present?: boolean;
  };
  evidence_validation: {
    total: number;
    validated: number;
    failed: number;
    skipped: number;
  };
  /** Phase 5: receipt count cross-check (uses REC_ codes, parallel to ledger's LED_ codes) */
  receipt_count_crosscheck: LedgerCountCrossCheck;
}

// ============================================================
// Signet v0.3 — Enforcement receipts (hook interception)
// ============================================================

/** One denied tool call, recorded by the PreToolUse hook at interception time. */
export interface EnforcementEvent {
  ts: string;
  tool_name: string;
  /** What the tool call targeted (file path, or command string for Bash). */
  target: string;
  matched_pattern: string;
  pattern_source: 'scope.excluded' | 'output_contract.forbidden_outputs';
  lock_id: string;
  lock_rule: string;
  /** Always 'hook_intercepted' — the only attribution Signet may call enforcement. */
  attribution: 'hook_intercepted';
  decision: 'deny';
}

/**
 * Receipt for a hook-enforcement session. Distinct from GovernanceReceipt:
 * enforcement has no tasks/gates — only real interception events.
 */
export interface EnforcementReceipt {
  receipt_version: 'signet-enforcement-receipt-v1';
  receipt_id: string;
  packet: { id: string; sha256: string };
  mode: 'hook_intercepted';
  /** Honest coverage statement — denials only; allowed calls are not recorded. */
  coverage: string;
  events: EnforcementEvent[];
  summary: {
    denials: number;
    first_event_ts: string | null;
    last_event_ts: string | null;
  };
  timestamps: { generated_at: string };
  canon: 'XAS-CANON-1';
  hashes: { sha256: string; h10: string };
  signature: string | null;
}
