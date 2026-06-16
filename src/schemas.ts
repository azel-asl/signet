import type { PacketTier, PacketType, EvidenceType } from './types.js';

// ── Tier + canonical type rules (TASK_010) ──────────────────

export const VALID_TIERS: PacketTier[] = [1, 2, 3];

export const TYPE_TIER_MAP: Record<PacketType, PacketTier[]> = {
  review:   [1, 2, 3],
  build:    [2, 3],
  query:    [1],
  analysis: [1, 2, 3],
  deploy:   [2, 3],
  report:   [1, 2, 3],
};

// ── Required blocks by tier ──────────────────────────────────

export const REQUIRED_ASL_BLOCKS_TIER1 = ['META', 'ROLE', 'SCOPE'];
export const REQUIRED_GCL_BLOCKS_TIER1 = ['AUTHORITY', 'PERMISSIONS'];

export const REQUIRED_ASL_BLOCKS_TIER2 = [
  'META', 'ROLE', 'SCOPE', 'PURPOSE', 'INPUTS', 'PROCESS',
  'OUTPUT_CONTRACT', 'FAILURE_MODES', 'RECEIPT', 'EXECUTION_PLAN',
];
export const REQUIRED_GCL_BLOCKS_TIER2 = [
  'AUTHORITY', 'PERMISSIONS', 'LOCKS', 'LOCK_CHECK_RULES', 'GATES',
  'ACCEPTANCE_TESTS', 'EVIDENCE_POLICY', 'EVIDENCE_TEMPLATES',
  'DRIFT', 'ESCALATION', 'COMPLETION', 'VERIFICATION_LEDGER',
];

// Tier 3 — full block set (same as Tier 2; reserved for multi-agent orchestration)
export const REQUIRED_ASL_BLOCKS_TIER3 = REQUIRED_ASL_BLOCKS_TIER2;
export const REQUIRED_GCL_BLOCKS_TIER3 = REQUIRED_GCL_BLOCKS_TIER2;

// ── Evidence template required fields (TASK_021) ────────────

export const EVIDENCE_TEMPLATES: Record<EvidenceType, string[]> = {
  file_read:           ['path', 'line_count', 'checksum'],
  file_write:          ['path', 'diff_summary', 'checksum'],
  command_output:      ['command', 'exit_code', 'key_result'],
  gate_check:          ['gate_id', 'result', 'assertion'],
  acceptance_test:     ['test_id', 'result', 'assertion'],
  human_confirmation:  ['timestamp', 'approver', 'quote_or_marker'],
  agent_assertion:     ['claim', 'reason_not_system_verified'],
  // v1.5.2 external evidence types
  file_checksum:       ['path', 'sha256'],
  tool_call_log:       ['tool', 'args_digest', 'result'],
  approval_token:      ['approval_id', 'approver', 'signature'],
};

export const VALID_EVIDENCE_TYPES = new Set<string>(Object.keys(EVIDENCE_TEMPLATES));

// ── v1.5.2 governance hardening constants ────────────────────

/**
 * Authority-bearing GCL blocks. Duplicates of these are HARD ERRORS (PARSE_005),
 * never "last wins" — a second, looser ::PERMISSIONS/::LOCKS block is an
 * authority-escalation vector.
 */
export const AUTHORITY_BEARING_BLOCKS = new Set<string>([
  'AUTHORITY', 'PERMISSIONS', 'LOCKS',
]);

/**
 * Evidence types that constitute EXTERNAL proof (not agent self-report).
 * A runtime_enforced lock must be backed by one of these.
 */
export const RUNTIME_LOCK_EVIDENCE_TYPES = new Set<string>([
  'command_output', 'file_checksum', 'tool_call_log', 'approval_token',
]);

/**
 * `enforced_by` values that are actually ATTESTATION, not enforcement.
 * Using these is permitted but flagged (GOV_001) so the packet does not
 * misrepresent its own governance strength.
 */
export const ATTESTATION_ENFORCED_BY = new Set<string>([
  'agent_receipt', 'agent_assertion', 'agent', 'self', 'self_report',
]);

/**
 * Honest enforcement vocabulary introduced in v1.5.2. These describe what the
 * mechanism ACTUALLY is, so readers do not mistake attestation for enforcement.
 */
export const HONEST_ENFORCED_BY = new Set<string>([
  'attested_by',                 // agent self-reports; no external check
  'structurally_validated',      // validator checks packet structure only
  'requires_external_evidence',  // must be backed by external evidence at receipt time
  'runtime_enforced_external',   // an external system (sandbox/tool) blocks the action
]);

/**
 * Secret / credential patterns scanned in produced artifacts for forbidden-output
 * enforcement (REC_018). Conservative set — high-signal, low false-positive.
 */
export const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'AWS access key id',     re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'AWS secret access key', re: /\baws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9/+]{40}\b/i },
  { name: 'private key block',     re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: 'GitHub token',          re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token',           re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Google API key',        re: /\bAIza[0-9A-Za-z_\-]{35}\b/ },
  { name: 'Stripe live key',       re: /\bsk_live_[0-9a-zA-Z]{24,}\b/ },
  { name: 'OpenAI key',            re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'generic bearer/secret', re: /\b(?:api[_-]?key|secret|password|passwd|token)\s*[=:]\s*['"][^'"\s]{8,}['"]/i },
];
