// ASL Packet Validator — Policy Profile Registry
// ASL Lite + GCL Packet Standard v1.5.1
// Phase 6 — TASK_002, TASK_003, TASK_004, TASK_005

// ============================================================
// SCHEMA (TASK_002)
// ============================================================

export interface ProfileLock {
  rule: string;
  type: 'behavioral' | 'runtime_enforced';
  note?: string;
}

export interface ProfileGate {
  condition: string;
  on_fail: 'HALT' | 'WARN' | 'SKIP';
}

export interface ProfileAcceptanceTest {
  name: string;
  check: string;
}

/**
 * A PolicyProfile defines:
 *  - Which packet tiers + types it targets
 *  - Minimum governance requirements (min_locks, min_gates, min_ats)
 *  - Default rules the compiler uses when no custom overrides are provided
 *
 * Inheritance rule:
 *   local packet declaration beats profile default — profiles set MINIMUMS,
 *   not EXACT values. A packet can declare more locks/gates/ATs than the minimum.
 */
export interface PolicyProfile {
  id: string;
  name: string;
  description: string;
  /** Packet tiers this profile is valid for */
  target_tiers: number[];
  /** Packet types this profile is compatible with */
  compatible_types: string[];
  /** Authority runtime_mode default */
  default_authority_mode: string;
  /** Minimum locks the packet must declare */
  min_locks: number;
  /** Minimum gates the packet must declare */
  min_gates: number;
  /** Minimum acceptance tests the packet must declare */
  min_acceptance_tests: number;
  /** Default lock rules (used by compiler when no custom_locks provided) */
  default_locks: ProfileLock[];
  /** Default gate conditions (used by compiler when no custom_gates provided) */
  default_gates: ProfileGate[];
  /** Default acceptance tests (used by compiler when no custom_ats provided) */
  default_acceptance_tests: ProfileAcceptanceTest[];
}

// ============================================================
// DEFAULT PROFILES (TASK_003)
// ============================================================

/**
 * minimal_tier1 — Baseline governance for review/query/analysis/report packets.
 * Requires at least 1 lock, 1 gate, 1 AT.
 */
const minimal_tier1: PolicyProfile = {
  id: 'minimal_tier1',
  name: 'Minimal Tier 1',
  description: 'Baseline governance for simple review, query, analysis, and report packets. Minimal lock/gate/AT requirements.',
  target_tiers: [1],
  compatible_types: ['review', 'query', 'analysis', 'report'],
  default_authority_mode: 'governed_review',
  min_locks: 1,
  min_gates: 1,
  min_acceptance_tests: 1,
  default_locks: [
    {
      rule: 'Do not execute code or commands outside the defined scope',
      type: 'behavioral',
      note: 'Default behavioral lock for Tier 1 review/query packets',
    },
  ],
  default_gates: [
    { condition: 'Scope confirmed before execution begins', on_fail: 'HALT' },
  ],
  default_acceptance_tests: [
    { name: 'Scope respected', check: 'All actions stayed within declared scope' },
  ],
};

/**
 * standard_tier2 — Standard governance for build/deploy workflow packets.
 * Requires at least 2 locks, 2 gates, 2 ATs.
 */
const standard_tier2: PolicyProfile = {
  id: 'standard_tier2',
  name: 'Standard Tier 2',
  description: 'Standard governance for build, deploy, analysis, and report packets at Tier 2. Balanced lock/gate/AT requirements for normal automation workflows.',
  target_tiers: [2],
  compatible_types: ['build', 'deploy', 'analysis', 'report', 'review'],
  default_authority_mode: 'governed_build',
  min_locks: 2,
  min_gates: 2,
  min_acceptance_tests: 2,
  default_locks: [
    {
      rule: 'Do not build execution or runtime infrastructure',
      type: 'behavioral',
      note: 'Prevents scope creep into executor territory',
    },
    {
      rule: 'Do not write credential or secret files',
      type: 'runtime_enforced',
    },
  ],
  default_gates: [
    { condition: 'Scope and inputs reviewed before execution', on_fail: 'HALT' },
    { condition: 'All required outputs produced before completion', on_fail: 'HALT' },
  ],
  default_acceptance_tests: [
    { name: 'No executor behavior added', check: 'Project remains non-executable after completion' },
    { name: 'Full test suite passes', check: 'All tests pass with exit code 0' },
  ],
};

/**
 * governed_tier3 — High-governance profile for multi-agent orchestration packets.
 * Requires at least 4 locks, 4 gates, 4 ATs.
 */
const governed_tier3: PolicyProfile = {
  id: 'governed_tier3',
  name: 'Governed Tier 3',
  description: 'High-governance profile for multi-agent orchestration and complex deployment packets. Strict lock/gate/AT requirements with explicit human confirmation checkpoints.',
  target_tiers: [3],
  compatible_types: ['build', 'deploy', 'analysis', 'report', 'review'],
  default_authority_mode: 'governed_orchestration',
  min_locks: 4,
  min_gates: 4,
  min_acceptance_tests: 4,
  default_locks: [
    { rule: 'Do not spawn sub-agents without explicit human approval', type: 'behavioral' },
    { rule: 'Do not write credential or secret files', type: 'runtime_enforced' },
    { rule: 'Do not execute destructive operations without human confirmation', type: 'behavioral' },
    { rule: 'All cross-agent communication must be logged', type: 'runtime_enforced' },
  ],
  default_gates: [
    { condition: 'Human confirmation received before orchestration begins', on_fail: 'HALT' },
    { condition: 'All sub-agent packets validated before dispatch', on_fail: 'HALT' },
    { condition: 'All sub-agent receipts verified before final commit', on_fail: 'HALT' },
    { condition: 'Final human review before delivery', on_fail: 'HALT' },
  ],
  default_acceptance_tests: [
    { name: 'Sub-agent isolation verified', check: 'Each sub-agent operated within its declared scope' },
    { name: 'Human approval gates honored', check: 'All human confirmation gates were triggered' },
    { name: 'No cross-scope data leak', check: 'No data crossed scope boundaries without declaration' },
    { name: 'Full audit trail exists', check: 'All sub-agent receipts are present and valid' },
  ],
};

// ============================================================
// OPTIONAL PROFILES (TASK_004)
// ============================================================

/**
 * safety_critical_tier3 — Maximum governance for safety-critical operations.
 * Requires at least 6 locks, 6 gates, 6 ATs.
 */
const safety_critical_tier3: PolicyProfile = {
  id: 'safety_critical_tier3',
  name: 'Safety Critical Tier 3',
  description: 'Maximum governance for safety-critical multi-agent operations. Every action requires human confirmation. No autonomous execution permitted.',
  target_tiers: [3],
  compatible_types: ['deploy', 'analysis', 'report'],
  default_authority_mode: 'governed_safety_critical',
  min_locks: 6,
  min_gates: 6,
  min_acceptance_tests: 6,
  default_locks: [
    { rule: 'No autonomous execution without human confirmation at every gate', type: 'behavioral' },
    { rule: 'Do not write credential or secret files', type: 'runtime_enforced' },
    { rule: 'Do not make irreversible changes without human sign-off', type: 'behavioral' },
    { rule: 'All outputs must be reviewed before delivery', type: 'behavioral' },
    { rule: 'All external API calls require explicit user approval', type: 'runtime_enforced' },
    { rule: 'Emergency rollback plan must be declared before execution', type: 'behavioral' },
  ],
  default_gates: [
    { condition: 'Safety review completed and documented', on_fail: 'HALT' },
    { condition: 'Human confirmation: execute plan', on_fail: 'HALT' },
    { condition: 'Human confirmation: commit output', on_fail: 'HALT' },
    { condition: 'Human confirmation: approve delivery', on_fail: 'HALT' },
    { condition: 'Rollback plan reviewed and acknowledged', on_fail: 'HALT' },
    { condition: 'Post-action audit completed', on_fail: 'HALT' },
  ],
  default_acceptance_tests: [
    { name: 'No autonomous execution', check: 'Every action had prior human approval' },
    { name: 'Rollback plan exists', check: 'Rollback procedure documented before execution' },
    { name: 'Human confirmation gates honored', check: 'All HC gates were triggered, not bypassed' },
    { name: 'No secret files written', check: 'No .env or credential files created' },
    { name: 'Audit trail complete', check: 'Full audit log exists for every action taken' },
    { name: 'Post-action review done', check: 'Human reviewer signed off on final state' },
  ],
};

/**
 * external_action_tier3 — Governance for packets that interact with external systems.
 * Requires at least 4 locks, 4 gates, 4 ATs.
 */
const external_action_tier3: PolicyProfile = {
  id: 'external_action_tier3',
  name: 'External Action Tier 3',
  description: 'Governance profile for multi-agent packets that interact with external APIs, databases, or services. Strict rate-limiting and approval requirements.',
  target_tiers: [3],
  compatible_types: ['deploy', 'build', 'analysis'],
  default_authority_mode: 'governed_external_action',
  min_locks: 4,
  min_gates: 4,
  min_acceptance_tests: 4,
  default_locks: [
    { rule: 'All external API calls must be declared in scope', type: 'behavioral' },
    { rule: 'Do not write credential or secret files', type: 'runtime_enforced' },
    { rule: 'External writes require human confirmation', type: 'behavioral' },
    { rule: 'Rate limits must be respected for all external services', type: 'runtime_enforced' },
  ],
  default_gates: [
    { condition: 'Human approval: allow external API calls', on_fail: 'HALT' },
    { condition: 'External service reachability confirmed', on_fail: 'HALT' },
    { condition: 'Human approval: commit external writes', on_fail: 'HALT' },
    { condition: 'External action receipt verified', on_fail: 'HALT' },
  ],
  default_acceptance_tests: [
    { name: 'No undeclared external calls', check: 'All external endpoints were declared in scope' },
    { name: 'Human approval gates honored', check: 'No external write bypassed human confirmation' },
    { name: 'Rate limits respected', check: 'No rate limit violations detected' },
    { name: 'Receipts present for external actions', check: 'All external actions have receipts' },
  ],
};

// ============================================================
// PROFILE LOADER (TASK_005)
// ============================================================

const PROFILE_REGISTRY = new Map<string, PolicyProfile>([
  ['minimal_tier1',           minimal_tier1],
  ['standard_tier2',          standard_tier2],
  ['governed_tier3',          governed_tier3],
  ['safety_critical_tier3',   safety_critical_tier3],
  ['external_action_tier3',   external_action_tier3],
]);

/** Load a profile by name. Returns null if not found. */
export function loadProfile(name: string): PolicyProfile | null {
  return PROFILE_REGISTRY.get(name) ?? null;
}

/** Return all registered profile names. */
export function listProfiles(): string[] {
  return Array.from(PROFILE_REGISTRY.keys());
}

/** Return all registered profiles. */
export function getAllProfiles(): PolicyProfile[] {
  return Array.from(PROFILE_REGISTRY.values());
}
