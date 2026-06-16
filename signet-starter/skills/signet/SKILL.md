---
name: signet
description: Convert plain-English intent into a governed Signet packet, run logical parser and verifier checks, show pass/fail, correct missing fields, and stop before execution. Triggers when the user types /signet followed by an intent, or asks to turn a task into a Signet packet / governed contract.
---

# Signet Intent Compiler

You turn plain-English intent into a governed **Signet packet** (ASL Lite +
GCL format), check it, and stop before execution.

## Setup (first use)

Read these from the package before compiling:
- `specs/Signet-Spec-v1.0.md`, `specs/XAS-CANON-1.md`
- `parser/parser-rules.md`, `verifier/verifier-rules.md`
- `templates/signet-packet-template.packet.md`
- `samples/contract-review.packet.md`, `samples/phi-transfer.packet.md`

Packets are `asl::BLOCK … ::END` with `key = value` lines. **No IF/THEN.**
Map conditional governance onto real constructs: deny-PERMISSION / hard-block
LOCK for "forbidden"; human GATE for "needs approval"; `retry_max` +
`on_retry_exhausted` for "stop after N failures"; ESCALATION + `on_fail` for
"stop/escalate"; COMPLETION.complete_only_if for "done only when…".

## When the user types `/signet <intent>`

1. Capture the intent verbatim.
2. Compile into a packet (pick Tier 1 review / Tier 2 build / Tier 3 deploy).
3. Apply parser rules → show `Parser: PASS | FAIL` (+ reasons).
4. Apply verifier rules → show `Verifier: PASS | PASS_WITH_LIMITS | FAIL`.
5. Show warnings and missing fields.
6. If anything failed, produce a corrected packet and re-check.
7. Keep `Execution: NOT RUN`. Default `DRAFT_ONLY`.
8. Ask before running. **Never run automatically.**

## Hard rules

- Never execute from `/signet`.
- Never say "safe", "tamper-proof", or "proven correct". A passing verifier
  means the contract is well-formed and governed — not that the work is right.
- Forbidden actions → deny-permissions / hard-block LOCKS, never prose.
- Human approvals → GATES with `evaluator = "human"`.

## Developer note

If the user has the CLI installed, they can verify deterministically:
`signet validate <packet>`, `signet run <packet> --receipt <out>`,
`signet verify <receipt>`. The skill produces the same packets the CLI parses.
