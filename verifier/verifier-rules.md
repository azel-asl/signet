# Verifier Rules (human-readable)

What the verifier checks — governance honesty and receipt integrity. These
mirror `src/validator.ts`, `src/governance.ts`, and `src/verify.ts`. The
deterministic source of truth is the CLI; this doc lets an LLM apply the same
judgment logically in ZIP mode.

## Governance checks (on the packet)

1. **Honest enforcement language.** A LOCK that claims to be enforced by an
   agent's own report (`enforced_by = "agent_receipt"`) cannot be called
   runtime-enforced. Self-report is *attestation*, not enforcement.
2. **Behavioral locks must be paired.** A `type = "behavioral"` LOCK must list
   `paired_with` referencing a GATE or acceptance test that actually verifies
   it. An unpaired behavioral lock is a FAIL.
3. **Human gates need an approval id.** A GATE with `evaluator = "human"` must
   carry an `approval_id`. Without an approval record at run time, the gate
   correctly **FAILS** — nothing fakes approval.
4. **Forbidden outputs are real.** `OUTPUT_CONTRACT.forbidden_outputs` and
   `SCOPE.excluded` define hard boundaries the runtime checks against declared
   actions.
5. **No fabricated evidence.** Gates and acceptance tests cannot pass on
   `agent_assertion` evidence; that is a warning-level signal, never proof.
6. **Ledger consistency.** VERIFICATION_LEDGER counts must match the actual
   block counts (see parser rules).

## Verifier verdicts

- **PASS** — well-formed and governed; no honesty violations.
- **PASS_WITH_LIMITS** — valid, but some checks are UNEVALUATED in simulation
  (no mechanical checker), or rely on warning-level evidence. Safe to review;
  not a correctness proof.
- **FAIL** — a governance violation: unpaired behavioral lock, human gate with
  no approval id, missing stop/escalation, external action with no approval
  gate, or a ledger count mismatch.

## Receipt verification (on the receipt JSON)

A receipt is checked independently of the runtime:
- **sha256** — byte integrity of the whole receipt.
- **h10** — the semantic core (verdict, tasks, blocks); detects meaning
  changes even if sha256 is recomputed.
- **signature** — `UNSIGNED` unless a Signet Authority signed it. An unsigned
  receipt can still be hash-verified by anyone.

What a passing receipt means: *its contents have not been modified since
creation.* What it does **not** mean: that the work was performed or correct.

## What the verifier never claims
- Never "tamper-proof", never "safe", never "proves the work is correct".
- Simulation evaluates declared actions, not live agent behavior.
