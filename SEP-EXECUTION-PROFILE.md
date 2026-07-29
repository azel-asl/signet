# Signet Evidence Pipeline — Execution Profile

**Subtitle:** Normative rules for compiling SEP pipelines into valid execution topologies

**Status:** Draft v0.1 · Companion to [SEP-v0.1-draft.md](SEP-v0.1-draft.md) · **License:** Apache 2.0 · **Author:** Erwin Layaoen / ASL Labs · **Date:** 2026-07-22

---

## 1. Purpose & Position

The Signet Evidence Pipeline specification defines *what* an evidence-driven decision system must guarantee. This profile defines *how those guarantees constrain execution* — which execution topologies (sequential workflows, parallel agent graphs, pipelines, state machines, human-operated processes) are valid realizations of a SEP pipeline, and which transitions are forbidden regardless of runtime.

This document is words, not machinery. It specifies what a legal implementation must preserve; it provides no shared executable code. See §9 (Target State) for what may eventually be built, and under what condition.

**The layer relationship:**

- **SEP** defines the evidence-and-decision constitution (seven layers, seven identity conditions).
- **This profile** defines which execution topologies are valid for that constitution.
- **Signet** provides the broader governance primitives (authority, receipts, checkpoints) and records whether the constraints were respected.

**Positioning in one sentence:** Graphs provide execution width. SEP provides constitutional separation of responsibilities. Signet makes compliance with those boundaries detectable, traceable, and provable.

---

## 2. Foundational Rule: Layers Are Semantic Contracts, Not Nodes

> SEP layers are semantic responsibility contracts. An implementation MAY realize a layer as a single execution unit, multiple parallel units, deterministic code, a router, a reducer, or a runtime-specific subgraph — provided the layer's invariants are preserved.

A layer is defined by what it is responsible for and what it is forbidden to do — never by how many processes, agents, or functions implement it. This keeps SEP stable when the underlying runtime changes: the same seven contracts hold whether executed by one model call, a fifty-node agent graph, or a human with a clipboard.

Corollary: **Evidence is not a layer.**

> Evidence is not a discrete SEP layer. Evidence consists of traceable observations, verification results, enrichments, measurements, and outcomes carried *between* layers with provenance. It is the substance flowing through the pipeline, not a position in it.

Observation, VerificationResult, provider response, measurement, decision basis, outcome, receipt — these are evidence objects moving through the system, not a separate place they must visit. Adding an "Evidence stage" for diagram symmetry would violate SEP's incident-driven discipline: every SEP rule traces to a real failure, and no incident motivates such a stage.

---

## 3. Permitted Realizations Per Layer

These are typical, not exhaustive. Any realization is permitted if the layer's invariants (SEP §5) hold.

| SEP layer | Typical execution shapes | Notes |
|---|---|---|
| **Perception** | One or more parallel extraction units; schema-validated output | Bounded, repetitive work — MAY run on lower-capability components |
| **Identity** | Resolution unit + deterministic router on its four outcomes | Judgment lives inside the layer; the branch that follows is code |
| **Verification** | Independent verifier unit(s) on the Identity→Decision path | Modality fixed by configuration (§5); shadow mode = record-only branch |
| **Knowledge** | Parallel provider fan-out + deterministic normalization | Providers are independent by construction; null-handling is edge code |
| **Decision** | Single governed synthesis unit behind a justified barrier | The one place a full-set barrier is inherently legitimate |
| **Presentation** | Deterministic rendering; constrained narration where transformation is required | See §6 — SHOULD contain no model where none is needed |
| **Learning** | Append-only capture + proposal generation | No execution edge into production (§4) |

**Edges are code.** Flattening, deduplication, filtering, reshaping between layers is deterministic plumbing — not a layer, not a governed capability, and not a job for a model. Implementations SHOULD keep inter-layer transforms deterministic and auditable.

---

## 4. Forbidden Transitions

An execution topology is invalid — regardless of runtime — if it contains any of the following:

1. **Perception → any layer's identity conclusion.** Perception output MUST NOT be treated as an identity; only the Identity layer produces one of the four resolution outcomes.
2. **Verification creating candidates.** No path may exist by which Verification introduces an entity that Identity did not produce. Verification's reachable outcomes are confirm, demote, reorder, or null-to-unresolved — never substitute.
3. **Any layer bypassing Verification when the profile requires it.** A topology in which a high-confidence Identity conclusion can reach Decision without passing the configured Verification path (or an explicit recorded "unavailable") is invalid.
4. **Presentation → intelligence mutation.** No path may exist by which rendering alters the recommendation, the confidence value, or their relationship. Multiple renderers MUST be able to consume the identical Decision output.
5. **Learning → production, directly.**
   > Learning MUST NOT directly modify production capabilities, policies, thresholds, models, or decision behavior. Learning MAY produce calibration or change proposals that enter a separate governed evaluation and promotion process.
   
   The valid promotion path is its own governed topology, outside the production pipeline:
   ```
   Learning → Proposal → Shadow evaluation → Verification → Human approval → New production configuration
   ```
   The rule is precisely *no direct execution edge* — a total prohibition on paths out of Learning would forbid governed improvement, which is not intended.
6. **Skipping designated gates.** A topology MUST NOT contain a path that advances past a configured gate (maturity gate, approval gate, checkpoint) without the evidence that gate requires.

---

## 5. Verification Independence

> Verification modality MUST be fixed by the applicable profile or approved configuration. An executing model MUST NOT weaken, replace, or self-select its required verification method during a run.

This is the sharpest point of tension with self-routing orchestration styles, and it is deliberate. Dynamic orchestration may freely choose *how many* verifiers run, *what order* work proceeds in, and *which model tier* executes bounded work. It MUST NOT choose *what kind of evidence* Verification uses — that is set ahead of time, precisely so a "conflict" verdict cannot be gamed by convenient path selection at run time.

Failure isolation: the unavailability or failure of Verification MUST NOT break Identity's output. The topology records the gap and proceeds as SEP §5 (Verification, `unavailable`) defines.

---

## 6. Determinism Requirements

> Presentation MUST NOT modify the governed intelligence supplied by Decision. Deterministic rendering SHOULD be used where transformation is not required.

Model-capable components are permitted only where judgment is the job: Perception extraction, Identity resolution, Verification comparison, Decision synthesis, and constrained narration in Presentation. Everywhere else — routing on classified outcomes, inter-layer transforms, evidence assembly, record-keeping — determinism is the default and any exception must be justified. A topology paying model cost for plumbing is not invalid, but it is not conformant with this profile's SHOULD-level guidance.

---

## 7. Missing-Data Semantics

> Missing, unavailable, or unverified evidence MUST NOT be represented as a measured zero unless the governing contract explicitly defines that interpretation.

In topology terms: every fan-in point (barrier, reducer, synthesis unit) MUST distinguish "branch returned nothing" from "branch measured zero," and every external fetch MUST classify failure as transient or permanent before anything is recorded. A parallel branch that fails resolves to *absent* — it is filtered, recorded as a gap, and never coerced into a value.

---

## 8. Traceability

The constitutional requirement is **not** "sign every arrow." It is:

> Every recommendation must be traceable through its material evidence, transformations, verification, and governing decisions.

Receipt semantics — granularity, signing, retention — are owned by Signet's governance layer, not by this profile; implementations follow the applicable Signet receipt discipline. For orientation, the record types an execution typically produces:

| Record | Purpose |
|---|---|
| Transition event | Lightweight operational trace of a meaningful state transition |
| Capability receipt | Proof that a governed capability executed |
| Checkpoint receipt | Evidence at a critical trust boundary, approval, or restore point |
| Run receipt | End-to-end summary of the completed pipeline |

A large parallel topology generating thousands of signed artifacts for internal array transforms has misread the requirement; a topology whose recommendation cannot be traced back through its evidence has violated it.

---

## 9. Target State — Not Built, Rule-of-Two Gated

Nothing in this section exists. It is recorded so the boundary is explicit, in the same discipline as the reference implementation's own Target State documentation: implemented and envisioned are never blended.

```
Today:                              Target (after a second vertical):

SEP specification                   SEP specification
      ↓                                   ↓
Vertical implementation             SEP Execution Profile
      ↓                                   ↓
Execution                           Topology validator / compiler
      ↓                                   ↓
Traceability & receipts             Runtime-specific execution plan
                                          ↓
                                    Signet-governed execution
```

A future **topology validator/compiler** — machinery that takes adapter values, produces a candidate execution topology, and rejects illegal transitions before execution — may mechanize enforcement of this profile. Per SEP's Non-Goals, it MUST NOT be built until a second independent vertical implementation has stress-tested the layer contracts. CardSignal is the first concrete implementation; one implementation is not proof that a universal runtime should exist. Until then, this profile is enforced the same way SEP itself is: by implementations honoring it, and by receipts making violations detectable.

---

## 10. Honest Claims

What a conformant implementation can credibly claim — and what it cannot:

A SEP-conformant execution **can still produce an incorrect result.** What it cannot legally do:

- bypass required stages;
- promote learning output directly into production behavior;
- treat missing data as a measured zero where the contract forbids it;
- let presentation rewrite the governed decision;
- allow a run to weaken or self-select its own verification method;
- advance past designated gates without required evidence.

And when a violation occurs anyway: **it can be detected and proven through receipts.** That is the claim to put in front of a customer — not "cannot hallucinate," but "cannot legally cut the corners that make hallucination dangerous, and cannot hide having done so."

---

## Appendix: Graph Mapping Profile (Informative)

For implementations executing on concurrent agent-graph runtimes (fan-out/fan-in orchestration, e.g. dynamic workflow tooling), the typical compilation:

- **Perception** → parallel extraction nodes, schema-validated, lower model tier
- **Identity** → resolution node + code-level router on the four outcomes
- **Verification** → verifier node on the Identity→Decision edge; shadow mode = log-only branch; fixed modality per §5
- **Knowledge** → parallel provider fan-out; reduce step is deterministic edge code (null ≠ zero per §7)
- **Decision** → single schema-validated synthesis node behind a barrier (legitimate: it needs the full evidence set)
- **Presentation** → plain rendering code, zero agent nodes
- **Learning** → append-only sink node; no back-edge into the production graph; the promotion path (§4.5) is a separate, separately-governed graph

Orchestration freedoms that remain open to the runtime: concurrency width, node count per layer, model tiering for bounded work, pipeline-vs-barrier scheduling (except Decision's barrier), retry and isolation strategy. Orchestration choices that this profile removes: everything in §4, §5, and §6.
