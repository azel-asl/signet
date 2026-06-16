// Signet v0.1 — Public API
// All modules in this repository are open source (Apache 2.0).
// The closed components (authority signing, approval infrastructure)
// are v0.2 work and are not present in this repository.

// Canonical serialization + hashing (XAS-CANON-1)
export { canonicalize, canonHash, sha256text, receiptSemanticCore, h10, receiptSha256 } from './canon.js';

// Receipt verification (standalone — never imports the runtime)
export { verifyReceipt, type VerifyStatus, type VerifyResult } from './verify.js';

// Packet parsing + validation
export { parsePacket } from './parser.js';
export { validate } from './validator.js';

// Governance runtime (v0.1: simulation mode)
export { govern, GovernanceError, type GovernanceErrorCode, deriveActions, evaluateAction, buildForbiddenSet, type ForbiddenPattern } from './runtime.js';

// Types
export type {
  ParsedPacket, Task, Lock, Gate, AcceptanceTest, ValidationResult, ValidationIssue,
  Action, GovernanceReceipt, GovernanceResult, GovernOptions,
  BlockEvent, TaskResult, GateResult, AcceptanceTestResult, BehavioralLockReport,
} from './types.js';
export {
  compileManifest, buildEnforcementReceipt, parseJournal, settingsSnippet,
  mergeSettings, HOOK_SCRIPT, HOOK_MATCHER,
  type EnforceManifest, type ManifestPattern,
} from './enforce.js';
