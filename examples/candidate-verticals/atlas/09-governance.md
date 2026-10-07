# 09 — Governance and authority

## Authorities

| Authority | Meaning | V0 | V0.2 |
|---|---|---|---|
| observe | read snapshots and evidence | everyone | everyone |
| explain | read diagnoses and explanations | everyone | everyone |
| simulate | create scenarios and run branches | everyone | analyst, manager |
| recommend | publish a recommendation to others | — | analyst, manager |
| approve:`<kind>` | approve an intervention of a kind | — | manager |
| execute:`<kind>` | cause a real-world effect | — | nobody (not implemented) |

Confidence does not equal authority: a recommendation with a strong comparison has the
same authority as one with none. The gate reads the actor, not the comparison.

## Gate (deterministic)

```
gate(actor, request):
  need = 'approve:' + request.kind
  if need ∉ actor.authorities         → DENY 'missing_authority'
  if request.intervention violates R08 → DENY 'skills_required'
  if request.intervention.employee not on shift at request.t → DENY 'not_on_shift'
  if request.recommendation_id and its valid_until < request.t → DENY 'expired'
  → ALLOW
```
The gate is called by the UI and by the CLI; intelligence cannot call it, and nothing
downstream of a DENY runs. There is no override flag.

## Approval in V0.2

An approval does three things, in order, and nothing else:
1. Writes an `ApprovalReceipt` (schema in 03) to `receipts/`.
2. Creates a branch `sim:approved_<id>` from the current T with the intervention as
   `ASSIGNMENT_CHANGED` events whose provenance is `{claim_class: 'human_corrected', source: 'approval', record_id: <receipt_id>}`.
3. Marks the recommendation as approved with the receipt id.

The history ledger is untouched. The viewer shows the approved branch in the simulated
register with the label "APPROVED, not executed". V0.2 does not touch any workforce system.

## Receipts

Receipts use the same shape discipline as Signet's governance receipt: computed-last
`hashes: { sha256, h10 }` over the receipt minus `hashes` and `signature`, canonicalized
per XAS-CANON-1, `signature: null`. This is deliberate: an ATLAS approval receipt can be
verified by a Signet verifier later without a format change, and a future SignalWorks
deployment can govern `execute:*` through a Signet packet. No Signet code is imported in
V0; the canonicalization function is a 40-line port with its own tests.

Action receipts (V1, `execute:*`) add: `system_affected, parameters, result, requested_by,
approved_by (receipt id), authority_used`.

## Permissions model

Three roles, hard-coded authorities, selected at CLI/viewer start with `--as manager`.
No login. This is enough to prove that the gate exists and outranks recommendations;
anything more is an enterprise permissions platform, which is a non-goal.

## Audit

Receipts and calibration records are append-only files. The ledger is append-only. The
`IngestReport` is kept with the ledger. Together they answer: what evidence entered, what
state it produced, what was recommended on what basis, who approved what, what happened.

## Wording rule (inherited from Signet)

ATLAS simulation is never described as enforcement or control of a live operation. The
approved branch is a simulation under a human-corrected assumption. Only an `execute:*`
action with a result receipt may be described as an action on the operation.
