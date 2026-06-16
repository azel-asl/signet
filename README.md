# Signet

**Turn plain-English intent into structured, parseable, verifiable AI work.**

> **Signet provides governance by contract, enforcement by hook (on hook-capable hosts), and verification by receipt.**

A Signet Packet declares what a task is allowed to do — scope, locks, gates, evidence, completion rules — in the **ASL Lite + GCL** format (ASL = *Agentic Specification Language*; GCL = *Governance Contract Layer*).

```
Prompting tells AI what to do.
Signet tells AI what it is allowed to do, how it should be checked,
when it must stop, and what proof it must produce.
```

---

## The Flow

```
Intent → Packet → Parse → Verify → Approve → Run → Receipt
```

Plain-English intent becomes a governed packet that can be parsed, verified, approved, executed, and receipted. The outcome isn't a better prompt — it's a contract with proof.

---

## Two Ways to Use Signet

| | **ZIP mode** (no-code, LLM-assisted) | **CLI mode** (deterministic, local) |
|---|---|---|
| Who | Anyone, no install | Developers |
| Intent → packet | An LLM generates it from your words | You or an LLM author it |
| Parse / verify | LLM applies the included rules | Sub-second, deterministic |
| Run + receipt | — | `signet run`, `signet verify` |

**ZIP mode:** get the no-code pack — download `signet-starter.zip` from the [latest release](https://github.com/azel-asl/signet/releases/latest), or take the [`signet-starter/`](signet-starter/) folder from this repo — upload it to an LLM, say *"read PROMPT.md and act as the Signet Intent Compiler,"* then type:

```
/signet Review this vendor contract, flag payment risks,
do not give legal advice, and create a receipt.
```

The LLM generates the packet, runs parser + verifier checks, shows pass/fail, corrects missing fields, and **asks before running**. Nothing executes automatically. See [QUICKSTART.md](QUICKSTART.md) and [PROMPT.md](PROMPT.md).

**CLI mode:** see [Quickstart](#quickstart-verified) below.

---

## Benefits

Signet helps you:
- turn vague intent into structured AI work
- define what the AI **is** allowed to do
- define what the AI is **forbidden** from doing
- require gates before execution
- require human approval for risky actions
- create receipts after work
- reduce unsafe or ambiguous AI behavior
- make AI workflows repeatable
- make AI work easy to inspect, test, and audit
- move from *prompting* to *governed intent*

---

## The Example That Matters

The demo packet contains a task that tries to write an API key to `.env`. The packet forbids it.

```
TASK_003  ✗ BLOCKED    file_write    LOCK_001 fired: .env matched ".env"
          └─ Rule:     Do not write credential files (.env, secrets, private keys)
          └─ Action:   write → .env
          └─ Verdict:  BLOCKED (matched ".env" from scope.excluded + output_contract.forbidden_outputs)
```

The receipt records the block. The verifier proves the receipt hasn't been altered:

```
  sha256       ✓  (recomputed, matches)
  h10          ✓  (semantic core, matches)

Result: PASS
```

Something was forbidden. It was blocked. The proof survives independent verification. That is the whole idea.

---

## Parser / Verifier Result Examples

A packet that passes:

```
Parser:            PASS
Verifier:          PASS_WITH_LIMITS
Execution:         NOT RUN
Approval Required: YES
```

A packet that fails — and is corrected before anything runs:

```
Parser:    PASS
Verifier:  FAIL
Reason:
  - Missing stop condition (no ESCALATION / on_fail = HALT)
  - No receipt requirement (RECEIPT.receipt_required not set)
  - External action requested with no approval gate

Corrected Packet:  [adds ESCALATION, RECEIPT, and a human GATE]
Execution:         NOT RUN
```

---

## Typical Signet Journey

Timing varies with intent size, model, tools, and packet complexity. Approximate (ZIP mode, LLM-assisted):

```
0–10s    User states intent
10–20s   LLM generates the Signet packet
20–28s   Parser result shown
28–40s   Verifier result shown
40–55s   Pass/fail, warnings, and missing fields shown
55–60s   Corrected packet shown if needed
60–65s   User approves or stops
65s+     Packet is ready to run — but only after approval
```

In CLI mode the parse and verify steps are deterministic and sub-second; the timings above reflect the LLM authoring the packet for you.

> Intent in. Packet generated. Parser checks structure. Verifier checks governance. Unsafe packets are corrected or blocked. Nothing runs until approval. Every run ends with a receipt.

---

## Quickstart (verified)

```bash
git clone https://github.com/azel-asl/signet.git
cd signet
npm install               # requires Node >= 22.5 (node:sqlite built-in)
npm test                  # 232 tests pass

# Validate the simple sample (Tier 1 review)
npm run signet -- validate examples/contract-review.packet.md

# Run the complex sample (Tier 3) — writes a receipt
npm run signet -- run examples/phi-transfer.packet.md --receipt receipt.json

# Verify the receipt independently (anyone can do this)
npm run signet -- verify receipt.json
```

`contract-review` is **VALID** (Tier 1). `phi-transfer` runs and **blocks at the human-approval gate** (GATE_002) because no approval token is present — the intended behavior. The receipt still verifies as intact.

Two pre-generated, verifiable receipts are committed:
[examples/receipt.verified.json](examples/receipt.verified.json) (a blocked credential write) and
[examples/demo-phi-transfer.receipt.json](examples/demo-phi-transfer.receipt.json) (a blocked human gate). Verify either without running anything first:

```bash
npm run signet -- verify examples/demo-phi-transfer.receipt.json
```

---

## Using Signet with AI Loops

Signet does **not** require loops. You can use it simply to turn intent into a structured packet and review it by hand.

But Signet works well with loops, because loops need clear instructions, boundaries, stop conditions, verification gates, retry rules, and receipts. A loop usually runs:

```
Discover → Plan → Execute → Verify → Iterate
```

Signet defines the governed contract for that loop:

```
Intent → Scope → Allowed actions → Forbidden actions → Gates → Approval → Stop rules → Receipt
```

Using Signet with a loop:
- gives the loop a clear mission
- prevents scope drift
- defines hard blocks and retry limits
- separates maker from checker
- requires objective verification gates
- prevents automatic execution of risky actions
- records what happened in a receipt
- makes loop outputs easy to audit

> Signet is useful without loops. Loops become safer and more governable with Signet.

---

## What Works Today (v0.3)

| Capability | Status |
|---|---|
| Packet parsing + validation (ASL Lite + GCL: tiers, locks, gates, ledger cross-checks, honest-enforcement vocabulary) | ✅ Working, tested |
| Governed execution — **simulation mode** | ✅ Working, tested |
| Lock checks against **declared** task actions | ✅ Working, tested |
| **Hook enforcement** (`signet hook init`): packet locks compiled into a dependency-free PreToolUse hook that denies forbidden tool calls before they execute, on hosts with hook support (Claude Code) | ✅ Working, tested |
| **Enforcement receipts** (`signet enforce report`): journaled denials → verifiable receipt | ✅ Working, tested |
| Receipts with dual hashes (XAS-CANON-1: sha256 byte integrity + h10 semantic core) | ✅ Working, tested |
| Independent receipt verification, explicit UNSIGNED reporting, human-readable failures | ✅ Working, tested |
| Packet ↔ receipt structural alignment (`signet verify --packet`) | ✅ Working, tested |
| Usage memory (XAS-MEM): every run auto-logged to a local SQLite db + a usage log; `signet history` lists past runs | ✅ Working, tested |

**Run `npm test` yourself — the suite count is printed, not promised.**

## Not Yet Supported

- ❌ **Sandboxing.** Hook enforcement checks declared lock patterns on hook-capable hosts. It is not an OS sandbox, does not inspect file contents or network traffic, and an agent on a host without PreToolUse hooks is not constrained.
- ❌ **Allowed-call records.** The enforcement journal records denials only.
- ❌ **Signatures (in this repo).** Receipts here are hash-verified, not authority-signed — `signature` is `null`. Ed25519 signing lives in **Signet Authority**, a closed layer; this repo's verifier reports a signature as present-but-unverifiable and still verifies hashes.
- ❌ **Approval issuance (in this repo).** Human gates require approval records; this repo parses and checks them but never creates them, so human gates correctly FAIL until a record exists. Issuance is a Signet Authority capability.
- ❌ **npm package.** Install from source for now.

---

## What the Receipt Proves (and What It Doesn't)

Accurate claim: **this receipt has been independently verified — its contents have not been modified since creation. It is unsigned and not authority-certified.**

| Hash | Input | Detects |
|---|---|---|
| `sha256` | Entire receipt (minus hashes/signature) | Any byte change |
| `h10` | Semantic core only | Meaning changes, even if sha256 is recomputed to hide them |

A receipt does **not** prove the work was performed or correct. And the boundary that makes verification trustworthy: `src/verify.ts` never imports the runtime — you can audit the verifier in isolation.

---

## Simulation Mode, Stated Plainly

Signet governs **declared intent, not live behavior**. The runtime extracts action targets from task descriptions (recorded in the receipt as `source: "extracted"`) and checks locks against them. Gates and acceptance tests that cannot be checked mechanically are marked `UNEVALUATED` — never silently passed. Human gates without an approval record FAIL.

A real agent could do something its packet never declared; catching that requires a hook layer that intercepts tool calls. That layer exists: `signet hook init` compiles the packet's locks into a PreToolUse hook on hook-capable hosts, and only those `hook_intercepted` denials are ever described as enforcement of a running agent.

---

## Open Protocol, Closed Authority Services

> **Open = protocol. Closed = authority services. Enterprise = delegated authority.**

Anyone should be able to create, inspect, parse, and verify Signet packets. Trusted authority issuance, enterprise policy enforcement, hosted registries, and compliance services are commercial authority services.

| Open source (this repo, Apache 2.0) | Closed / commercial layer |
|---|---|
| Signet spec, packet format, examples | Private signing keys |
| Parser, validator/verifier, receipt verifier | Authority signing service |
| Canonicalization / hash standard (XAS-CANON-1) | Hosted approval issuance |
| CLI, local tests, simulation runtime | Hosted registry + audit trail |
| `/signet` starter skill | Enterprise dashboards |
| | Compliance / policy mapping packs |
| | Managed connectors, delegated enterprise authority |

Conceptually similar to HTTPS: the protocol can be open, while trusted authority services can be operated separately. Enterprises (e.g. a hospital) can run their own **delegated** signing authority — the open verifier already accepts any public key.

---

## Using Signet as a Library

```typescript
import { parsePacket, validate, govern, verifyReceipt, canonHash } from '@azel-asl/signet';

const packet = parsePacket(packetText);
const result = validate(packet);            // ValidationResult
const run    = govern(packet);              // GovernanceResult (receipt inside)
const check  = verifyReceipt(receiptJson);  // VerifyResult
```

Working examples: [examples/library-usage.js](examples/library-usage.js), [examples/library-usage.ts](examples/library-usage.ts).

---

## Writing Packets

1. **Copy a sample.** [examples/contract-review.packet.md](examples/contract-review.packet.md) (simple, Tier 1) or [examples/phi-transfer.packet.md](examples/phi-transfer.packet.md) / [examples/db-migration.packet.md](examples/db-migration.packet.md) (full Tier 3: human gate, retries, behavioral locks).
2. **Use the template.** [templates/signet-packet-template.packet.md](templates/signet-packet-template.packet.md).
3. **Prompt an LLM** with [docs/Signet-Spec-v1.0.md](docs/Signet-Spec-v1.0.md) and validate the output with `signet validate`.

The validator is strict on purpose — it includes *honest-enforcement* checks (a lock claiming `enforced_by = "agent_receipt"` is flagged as attestation, not enforcement; human gates must reference an `approval_id`). See [parser/](parser/) and [verifier/](verifier/) for the rule docs.

---

## Licensing

| Component | License |
|---|---|
| Everything in this repository (parser, validator, runtime, verifier, canon, CLI, tests, examples) | Apache 2.0 |
| Specifications (`docs/`) | CC-BY 4.0 |
| Signet Authority (Ed25519 receipt signing, approval issuance) — not in this repo | Closed (ASL Labs — Agentic Specification Language Labs) |

---

## Repository Layout

```
src/        parser, validator, runtime (simulation), enforcement compiler, verifier, canon, XAS-MEM
cli/        signet validate | run | verify | history | hook init | enforce report
tests/      232 tests across 12 suites
examples/   sample packets + demo receipts + library usage
templates/  packet + receipt templates
parser/     parser rule docs (md + json)
verifier/   verifier rule docs (md + json)
skills/     the /signet Intent Compiler skill
docs/       Signet-Spec-v1.0.md, XAS-CANON-1.md
```

---

## Roadmap

- **v0.1:** validation, governed simulation, hash-verified receipts, open verifier
- **v0.2:** verifier hardening, XAS-MEM usage memory
- **v0.3 (this repo):** hook enforcement, verifiable enforcement receipts
- **Signet Authority (closed):** Ed25519 receipt signing + approval issuance — verification stays open
- **Future (open repo):** receipt chains / lineage, content-aware enforcement, multi-agent attribution, npm package

---

**Copyright 2026 Erwin Layaoen.** ASL Labs — Agentic Specification Language Labs. See [LICENSE](LICENSE), [NOTICE](NOTICE), [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md).
