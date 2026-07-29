# WatchSignal — SEP Design Exploration

**Status:** Design exploration
**Execution:** Not implemented
**Conformance:** Target — not certified
**Purpose:** Stress-test the Signet Evidence Pipeline against a second Signal-family vertical
**Produced by:** `/sep-graph WatchSignal` + review corrections · 2026-07-22
**Specs:** [SEP-v0.1-draft.md](../../SEP-v0.1-draft.md) · [SEP-EXECUTION-PROFILE.md](../../SEP-EXECUTION-PROFILE.md)

WatchSignal does not exist. This document records what designing it against the
SEP specification surfaced. If it is ever built, it becomes vertical #2 — the
rule-of-two stress test that graduates SEP's contracts from draft.

---

## Scope Boundary (stated first, deliberately)

SEP Verification verifies **identity** (is this reference 116610LN?), not
**authenticity** (is it a genuine Rolex?). Replica watches, aftermarket dials,
replaced bezels, service parts, and "Frankenwatches" mean visual consistency
with catalog imagery can never certify authenticity. Authenticity is explicitly
out of scope for v1 and would require governance this pipeline does not provide.

The safe verification claim, verbatim:

> The observed visual regions are consistent or inconsistent with catalog
> imagery for the resolved reference.

Verification vocabulary stays the spec's conservative set — `consistent` /
`conflict` / `unavailable` — never `verified_authentic` or `verified_reference`.

---

## Adapter Values (⚠ = assumption)

| Slot | Value |
|---|---|
| Perception | ⚠ Photo(s): dial, side, caseback. Extract brand, model line, reference number, dial color/text, bezel, bracelet, complications, text language — per-field confidence |
| Identity | ⚠ Local reference catalog (brand + reference + model). Normalization pre-step: brand aliases, reference format variants (`116610LN`/`116610-LN`). Reference-number precedence over model name. Four outcomes: exact/likely/candidates/unknown |
| Verification | Pixel fingerprint of dial/bezel/caseback regions vs. catalog imagery — modality independent of Identity's text/reference path. ⚠ `WATCH_REGIONS` analog of `CARD_REGIONS`. Shadow mode at launch |
| Knowledge | ⚠ External: market price provider(s) behind a pluggable interface (Chrono24/WatchCharts-class). Internal: price snapshots, movement, liquidity, community HAVE/WANT/TRADE signals |
| Decision | ⚠ BUY / FAIR / PASS + conservative WATCH override. At launch only Identifier Confidence measurable; other components maturity-gated and renormalized out |
| Presentation | ⚠ Telegram bot, Free/Pro/Dealer tiers |
| Learning | ⚠ Per scan: vision output + prompt version, fingerprint descriptors, candidate list, resolved reference, user corrections + reasons |

---

## Execution Topology

```
photo(s)
   ↓
PERCEPTION      — parallel extraction nodes (dial / caseback concurrent),
                  schema-validated, lower model tier
   ↓  (edge: plain code — merge per-field observations, keep confidences)
IDENTITY        — one resolution unit + deterministic router on four outcomes;
                  reference-number search against local catalog, external
                  fallback only on miss
   ↓
VERIFICATION    — verifier node; modality FIXED by config to pixel-fingerprint
                  comparison; shadow mode at launch:
   ├── production evidence path → KNOWLEDGE   (result travels as evidence,
   │                                           does not yet gate Decision)
   └── shadow result log → LEARNING / calibration dataset
   ↓
KNOWLEDGE       — parallel provider fan-out + internal analytics; reduce step
                  is deterministic code enforcing null ≠ zero
   ↓
DECISION        — single synthesis unit behind the one legitimate barrier;
                  recommendation and confidence as separate values
   ↓  (edge: immutable decision object)
PRESENTATION    — deterministic renderers per tier, zero model calls
   ↓
LEARNING        — append-only sink; no edge back into the production pipeline;
                  gate promotion travels the separate governed path:
                  shadow evidence → calibration → approval → production change
```

---

## Legality Report

```
SEP Execution Profile Check — watchsignal

✓ Seven stage contracts preserved (no stage merged away or skipped)
✓ No Perception output treated as identity            (§4.1)
✓ Verification cannot create candidates               (§4.2) — reorders/demotes/nulls only
✓ Every resolved identity traverses Verification      (§4.3)
    — at launch Verification executes in shadow mode and records evidence,
      but does not yet gate Decision. Gate promotion requires calibration,
      approval, and a governed production change.
✓ Presentation cannot mutate intelligence             (§4.4) — deterministic renderers
✓ No direct Learning → production execution edge      (§4.5) — sink only; promotion path separate
✓ No gate can be passed without required evidence     (§4.6) — maturity gates on confidence components
✓ Verification modality fixed by config, not run-time (§5)  — set in adapter, never model-selected
✓ Plumbing deterministic; models only where judgment  (§6)  — models in Perception/Identity/Decision only
✓ Missing ≠ zero at every fan-in and external fetch   (§7)  — nulls stay null; failures classified before write
✓ Recommendation traceable to evidence (receipt plan) (§8)  — observation → resolution → verification → decision chain

Conformance target: FULL.
Current design status: structurally conforming; empirical verification
independence and production gating remain unproven until shadow calibration
is complete. Full conformance cannot be claimed until the verification
modality is implemented, calibrated in shadow mode, and promoted through a
governed change.
```

What FULL still requires beyond naming the modality: catalog imagery suitable
for comparison; region stability across photography conditions; a verifier
basis that never reuses Identity's text-derived conclusion; fixed, calibrated
thresholds; a defined effect for verification results; measured shadow
performance before promotion.

---

## Assumptions (most load-bearing first)

1. **A watch reference catalog exists or can be sourced** — the biggest
   unknown. Cards had TCGdex/pokemontcg.io; watches have no obvious open
   equivalent. If none exists, Identity launches thin and "unknown" is the
   honest dominant outcome for a while.
2. Market data providers accessible on acceptable terms.
3. Decision vocabulary and tier structure reused from the reference
   implementation.
4. Telegram is the channel.

## Open Questions

- Catalog source?
- Authenticity ever in scope? (Recommendation: explicitly NO in v1.)
- Multi-photo requirement? Caseback shots materially help reference
  resolution; requiring them changes Perception's shape and the UX.

---

## What the Exercise Proved

The profile forced the consequential questions into the design artifact —
catalog availability, genuine modality independence, shadow-mode semantics,
missing-data handling, the identity-vs-authenticity boundary — where they are
cheap to resolve, instead of surfacing mid-implementation where they are not.

The first serious stress test did not reveal that SEP needed another layer or
a shared runtime. It revealed implementation-specific adapter questions —
which is exactly what a stable specification should produce.
