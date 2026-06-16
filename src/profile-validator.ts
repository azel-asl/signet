// ASL Packet Validator — Policy Profile Validator
// Phase 6 — TASK_006, TASK_007, TASK_008

import type { ParsedPacket, ValidationIssue, Severity } from './types.js';
import { loadProfile, listProfiles, type PolicyProfile } from './profiles.js';

// ============================================================
// PROFILE VALIDATION  — PROF_001 through PROF_006
// ============================================================

function issue(severity: Severity, code: string, message: string, location?: string): ValidationIssue {
  return { severity, code, message, ...(location ? { location } : {}) };
}

/**
 * TASK_006 — Validate that the declared policy_profile exists.
 * PROF_001: unknown profile name.
 * PROF_002: profile incompatible with packet tier.
 * PROF_003: profile incompatible with packet type.
 *
 * Returns null if no policy_profile declared (no-op).
 * Returns the loaded profile on success.
 */
function checkProfileExists(
  packet: ParsedPacket,
  issues: ValidationIssue[]
): PolicyProfile | null {
  const declared = packet.meta?.policy_profile;
  if (!declared) return null; // No profile declared — nothing to validate

  const profile = loadProfile(declared);
  if (!profile) {
    issues.push(issue(
      'error', 'PROF_001',
      `Unknown policy_profile "${declared}". Known profiles: ${listProfiles().join(', ')}`,
      'META'
    ));
    return null;
  }

  // Tier compatibility check
  const tier = packet.meta?.packet_tier;
  if (tier !== undefined && !profile.target_tiers.includes(tier)) {
    issues.push(issue(
      'error', 'PROF_002',
      `Profile "${declared}" targets tiers [${profile.target_tiers.join(', ')}] ` +
      `but packet is Tier ${tier}`,
      'META'
    ));
    // Still return the profile so further checks can run
  }

  // Type compatibility check
  const type = packet.meta?.type;
  if (type !== undefined && !profile.compatible_types.includes(type)) {
    issues.push(issue(
      'error', 'PROF_003',
      `Profile "${declared}" is not compatible with packet type "${type}". ` +
      `Compatible types: [${profile.compatible_types.join(', ')}]`,
      'META'
    ));
  }

  return profile;
}

/**
 * TASK_007 + TASK_008 — Profile inheritance: enforce profile minimums.
 *
 * Inheritance rule: local packet declarations override profile defaults.
 * Profiles set MINIMUMS — packets can declare more, never less.
 *
 * PROF_004: fewer locks than profile minimum.
 * PROF_005: fewer gates than profile minimum.
 * PROF_006: fewer acceptance tests than profile minimum.
 */
function checkProfileCompliance(
  packet: ParsedPacket,
  profile: PolicyProfile,
  issues: ValidationIssue[]
): boolean {
  let ok = true;

  // Lock count — PROF_004
  const lockCount = packet.locks.length;
  if (lockCount < profile.min_locks) {
    issues.push(issue(
      'error', 'PROF_004',
      `Profile "${profile.id}" requires at least ${profile.min_locks} lock(s), ` +
      `packet declares ${lockCount}`,
      'LOCKS'
    ));
    ok = false;
  }

  // Gate count — PROF_005
  const gateCount = packet.gates.length;
  if (gateCount < profile.min_gates) {
    issues.push(issue(
      'error', 'PROF_005',
      `Profile "${profile.id}" requires at least ${profile.min_gates} gate(s), ` +
      `packet declares ${gateCount}`,
      'GATES'
    ));
    ok = false;
  }

  // Acceptance test count — PROF_006
  const atCount = packet.acceptanceTests?.tests.length ?? 0;
  if (atCount < profile.min_acceptance_tests) {
    issues.push(issue(
      'error', 'PROF_006',
      `Profile "${profile.id}" requires at least ${profile.min_acceptance_tests} acceptance test(s), ` +
      `packet declares ${atCount}`,
      'ACCEPTANCE_TESTS'
    ));
    ok = false;
  }

  return ok;
}

// ============================================================
// RESULT TYPE
// ============================================================

export interface ProfileValidationResult {
  /** true if no profile declared, or profile is valid and packet complies */
  valid: boolean;
  /** null if no profile declared */
  profile_id: string | null;
  /** null if no profile declared or profile not found */
  profile_name: string | null;
  issues: ValidationIssue[];
  summary: { errors: number; warnings: number; info: number };
  checks: {
    profile_found: boolean;
    tier_compatible: boolean;
    type_compatible: boolean;
    lock_count_meets_minimum: boolean;
    gate_count_meets_minimum: boolean;
    at_count_meets_minimum: boolean;
  };
}

// ============================================================
// MAIN EXPORT (TASK_005, TASK_006, TASK_007, TASK_008)
// ============================================================

/**
 * Validate a packet's policy_profile declaration:
 *  - PROF_001: profile not found
 *  - PROF_002: profile incompatible with tier
 *  - PROF_003: profile incompatible with type
 *  - PROF_004: packet declares fewer locks than profile minimum
 *  - PROF_005: packet declares fewer gates than profile minimum
 *  - PROF_006: packet declares fewer ATs than profile minimum
 *
 * Returns a ProfileValidationResult.
 * If no policy_profile declared: valid=true, profile_id=null, no issues.
 */
export function validateProfile(packet: ParsedPacket): ProfileValidationResult {
  const declared = packet.meta?.policy_profile ?? null;
  const localIssues: ValidationIssue[] = [];

  // No profile declared — pass silently
  if (!declared) {
    return {
      valid: true,
      profile_id: null,
      profile_name: null,
      issues: [],
      summary: { errors: 0, warnings: 0, info: 0 },
      checks: {
        profile_found:            true,
        tier_compatible:          true,
        type_compatible:          true,
        lock_count_meets_minimum: true,
        gate_count_meets_minimum: true,
        at_count_meets_minimum:   true,
      },
    };
  }

  const profile = checkProfileExists(packet, localIssues);

  let lockOk = true;
  let gateOk = true;
  let atOk   = true;

  if (profile) {
    const compliant = checkProfileCompliance(packet, profile, localIssues);
    // Unpack compliance checks individually
    lockOk = !localIssues.some(i => i.code === 'PROF_004');
    gateOk = !localIssues.some(i => i.code === 'PROF_005');
    atOk   = !localIssues.some(i => i.code === 'PROF_006');
    void compliant;
  }

  const errors   = localIssues.filter(i => i.severity === 'error').length;
  const warnings = localIssues.filter(i => i.severity === 'warning').length;
  const info     = localIssues.filter(i => i.severity === 'info').length;

  return {
    valid: errors === 0,
    profile_id:   declared,
    profile_name: profile?.name ?? null,
    issues:       localIssues,
    summary:      { errors, warnings, info },
    checks: {
      profile_found:            profile !== null,
      tier_compatible:          !localIssues.some(i => i.code === 'PROF_002'),
      type_compatible:          !localIssues.some(i => i.code === 'PROF_003'),
      lock_count_meets_minimum: lockOk,
      gate_count_meets_minimum: gateOk,
      at_count_meets_minimum:   atOk,
    },
  };
}
