# Signet Evidence Pipeline (SEP) — v0.1 Draft Specification

**Status:** Draft. Descriptive of one reference implementation (CardSignal). Constitutional rules are normative for conformance; the specification itself remains descriptive until a second independent implementation stress-tests these contracts.

**License:** Apache 2.0 · **Author:** Erwin Layaoen / ASL Labs · **Date:** 2026-07-03

---

## 1. Scope & Intent

The Signet Evidence Pipeline is a specification for systems that transform raw observations into actionable recommendations through structured evidence collection. It defines seven layers, each contributing one independent form of evidence, with strict contracts about what each layer may and may not do. The distinguishing discipline: **no layer trusts another blindly, no behavior changes without recorded evidence, and uncertainty is always expressed honestly rather than fabricated.**

**What SEP is not:** An AI architecture. A human-operated process can implement it; AI components are replaceable; the evidence discipline is the invariant. SEP is language-agnostic and model-agnostic. What matters is how evidence is collected, verified independently, enriched without corruption, and presented without alteration.

**Applicability:** Any domain requiring identification of a real-world entity from imperfect observation and recommendation of an action. Positive examples: collectibles scanning, document intake (invoices, forms), inventory identification, content triage, entity deduplication. Negative examples: real-time control loops (latency incompatible with layering), pure generation (nothing to verify against), trivial identification (barcode scanning), regulated advice domains (financial, medical — out of scope).

---

## 2. Terminology

- **MUST / MUST NOT / SHOULD / MAY** — per RFC 2119
- **Evidence** — Any traceable observation, verification result, knowledge enrichment, or derived measurement that contributes to a recommendation. Every evidence item carries provenance (source), and a confidence value that may be `null` ("unquantified," distinct from zero). **Absence of evidence is never evidence** — `null` confidence and missing data both lower recommendation confidence, they never fabricate a score.
- **Confidence** — Quantified trust in a specific evidence item or decision. Null means "the source does not quantify this"; zero means "the source measured and found nothing." These are distinct.
- **Receipt** — A traceable record of evidence, decisions, and reasoning at layer boundaries. Every recommendation MUST be auditable back to its evidence.
- **Adapter** — Domain-specific configuration and plugins that wire SEP's abstract layers to a concrete domain (e.g., catalog lookup, grading rules). Adapters are not part of this specification.

---

## 3. Constitutional Identity Conditions

A system implements SEP **if and only if all of the following hold.** Violating any one means the system does not implement SEP:

1. **Verification exists, is evidence-independent, and is incapable of inventing.** Verification MUST use a different signal modality than Identity's primary path. It MUST be able to confirm, demote, or reorder Identity's conclusions; it MUST NOT create new candidates or substitute a different answer (worst case: null the conclusion back to "unresolved"). Real incident: TG05 misread as "160/165" by OCR, exact-matched the wrong Pokémon — Verification's pixel-based fingerprint caught the disagreement.

2. **Confidence renormalizes over measurable evidence; missing data lowers confidence, never fabricates it.** When a confidence component's source is immature system-wide, that component is removed and remaining weights are renormalized — not scored as zero. Real incident: every card scored as WATCH because unmeasurable community signals were scored as zero, destroying signal. Fix: maturity gates that honestly exclude immature sources rather than penalizing absence.

3. **Learning MUST NOT modify production behavior directly.** The invariant is **Observation → Calibration → explicitly approved Change**. Every behavioral improvement must first exist as measurable evidence. Recording happens; auto-modification does not. Real incident: temptation to build recognition engines pre-beta; the discipline prevents that.

4. **Presentation MUST NOT alter intelligence.** Presentation controls visibility, layout, and access tier only. The recommendation is identical across all renderers. Real incident: multiple renderers (Free/Pro/Dealer) must consume the same Decision layer output unchanged.

5. **Decision MUST separate recommendation from confidence.** A recommendation is "BUY/PASS/FAIR"; confidence is a separate, independently-auditable score. This prevents opacity in recommendation logic. Real incident: caught cases where high-confidence reasoning was invisible in the rendered decision.

6. **Absence of evidence is never evidence of absence.** Transient failures (CDN outage, API timeout) MUST be classified separately from permanent facts. Missing data MUST be recorded as `null`, not zero. Real incident: a CDN outage was recorded as "permanent fingerprints missing," overwriting 14k good records. Fix: transient ≠ permanent; record nothing on transient failures.

7. **Every recommendation MUST be traceable to its evidence.** Receipts at layer boundaries record what entered, what was decided, and why. No recommendation exists without a receipt.

---

## 4. The Pipeline

```
raw input
    ↓
PERCEPTION     — extract observations; no reasoning
    ↓
IDENTITY       — determine what observations likely represent
    ↓
VERIFICATION   — independently verify identity using different modality
    ↓
KNOWLEDGE      — enrich with everything the system knows
    ↓
DECISION       — transform evidence into recommendation + confidence
    ↓
PRESENTATION   — render for audience and channel (never alters intelligence)
    ↓
LEARNING       — record everything; change nothing in production
```

Each layer has exactly one responsibility. A fact belongs to exactly one layer — never duplicated. The output of each layer is one form of evidence for the layer below it.

---

## 5. Layer Contracts

### Perception — *Observe without interpreting*

**Purpose:** Extract observable features from raw input; output observations with confidence, never identity.

**Inputs:** Raw sensory data (image, text, sensor reading, document scan).

**Outputs:** Structured observations: feature name, extracted value, source modality, confidence (may be null).

**Invariants:**
- MUST output what is measurable; MUST NOT infer identity, category, or meaning
- Confidence may be null (source doesn't quantify); MUST NOT be fabricated
- Output schema leaves room for future enrichment (blur, glare, orientation) without breaking downstream contracts

**CardSignal reference:** Claude Vision + Number Recovery pass; extracts text, symbols, language, layout — no reasoning about what card this might be.

---

### Identity — *Determine what the observations likely represent*

**Purpose:** Match observations against known entities using local context first.

**Inputs:** Observations from Perception; local reference catalog; optional external sources.

**Outputs:** One of `Exact Match` / `Likely Match` / `Candidate List` / `Unknown`. Ranked by confidence.

**Invariants:**
- MUST resolve against locally-owned reference data first, external sources only as fallback
- Normalization (typo correction, alias resolution) MUST run before search; the corrected value is what's searched, not a signal among many
- MUST output exactly one of the four outcomes; MUST prefer honest uncertainty to fabricated confidence
- Number/set/name precedence rules are domain-specific (Adapter responsibility), not part of this specification
- Identity's confidence formula may consider multiple signals; it feeds one unified confidence downstream

**CardSignal reference:** Resolver + Catalog (23k EN, 6k JA); number precedence over name; 0.90 escalation gate; species-correction penalty (misread name proves something went wrong).

---

### Verification — *Independently confirm or demote, never invent*

**Purpose:** Test Identity's conclusion using evidence-independent of Identity's primary signal.

**Inputs:** Identity's decision; observations from Perception (via different modality than Identity used); reference data.

**Outputs:** `consistent` / `conflict` / `unavailable`; optional rank adjustment for candidates; never new candidates.

**Invariants:**
- MUST use a different evidence modality than Identity's primary path (CardSignal: pixels vs. text)
- On `consistent`: proceed; may refine confidence
- On `conflict`: reorder candidates (demote contradicted identity back to candidates) or null high-confidence conclusion back to "unresolved"; MUST NOT substitute a different answer
- On `unavailable`: proceed with unverified conclusion; record the gap
- MUST be operationally independent — failure of Verification MUST NOT break Identity's output
- **Operational mode:** Shadow (records evidence, changes nothing) until calibration on real-world corrections justifies enforcement

**CardSignal reference:** Signet Visual Identity (SVI); fingerprints (Whole, Artwork, Edge, Color) compared to catalog; ranks against same-name peers; operates in shadow mode.

---

### Knowledge — *Enrich without corruption*

**Purpose:** Attach everything the system knows about the identified entity.

**Inputs:** Identity's result; external provider interfaces (APIs, databases, services); internal accumulated data.

**Outputs:** Enriched entity record: external knowledge (vendor-supplied, behind provider interface) + internal knowledge (owned, accumulating).

**Invariants:**
- MUST separate external (pluggable, vendor-supplied, interface-driven) from internal (owned, accumulated over time)
- MUST distinguish "provider returned null" from "provider can't answer" (distinct failure modes)
- Knowledge provider MUST be swappable without affecting layer contracts (PriceCharting ↔ another source requires only Adapter change)
- MUST NOT invent values; `null` fields are recorded as `null`

**CardSignal reference:** MarketProvider interface (raw price, PSA prices, volume, population, history) + internal snapshots, market movement, liquidity, discovery, portfolio analytics.

---

### Decision — *Recommend, never assert certainty you don't have*

**Purpose:** Transform evidence into a recommendation plus independently-auditable confidence.

**Inputs:** All upstream layers' evidence (observations, identity, verification, knowledge).

**Outputs:** Recommendation (domain vocabulary, e.g., "BUY"/"PASS"/"FAIR") + Confidence (separate value: score + measurable components).

**Invariants:**
- Recommendation and confidence are separate outputs
- Confidence MUST renormalize: remove immature components, renormalize weights of remaining ones; missing data lowers confidence, never fabricates it
- Measurable components list MUST be auditable (what data actually went into this score)
- Low confidence MUST trigger conservative defaults (CardSignal: WATCH override); this is not a hack, it's an invariant
- Scoring rules are domain-specific (Adapter), not part of this specification

**CardSignal reference:** Asset Grade (Demand/Liquidity/Dealer Exit/Confidence/Character) → A+/A/B+/B/C/F; Grail Score (separate metric); Confidence (5 components, maturity-gated: Coverage/Activity/History/Community/Identifier); Verdict (Grade + Confidence + Price → BUY/FAIR/PASS).

---

### Presentation — *Render without altering*

**Purpose:** Make recommendation accessible for a specific audience, channel, or tier.

**Inputs:** Decision layer's recommendation and confidence (unchanged).

**Outputs:** Rendered intelligence: layout, visibility, actions, tier-specific capabilities.

**Invariants:**
- MUST NOT modify, filter, or reinterpret the recommendation
- MUST NOT alter the confidence value
- MAY control which tiers see certain features
- Multiple renderers consuming identical Decision output MUST produce semantically identical recommendations, differing only in presentation

**CardSignal reference:** Free / Pro / Dealer renderers; same Decision output; different layouts, visibility, and actions.

---

### Learning — *Record everything; change nothing until calibrated*

**Purpose:** Collect evidence from every cycle for continuous improvement.

**Inputs:** Full pipeline state at each stage: observations, identity result, verification result, knowledge, decision, user action.

**Outputs:** Immutable learning records; zero automatic behavior modification.

**Invariants:**
- MUST record observations, identity conclusions, verification results, decisions, and user corrections (what they corrected to, why)
- Record provenance on every piece of evidence (version, timestamp, data source)
- MUST NOT auto-modify any upstream layer's behavior
- Behavior changes follow the sequence: Observation → Calibration → explicit, human-approved Change
- Learning records are the only source of truth for system improvement; speculation is not recorded as fact

**CardSignal reference:** Records vision output, SVI descriptors, candidate list, resolved asset, user corrections, correction reasons; currently at observation stage.

---

## 6. Conformance

**Core Conformance (MUST)** — minimum to claim "implements SEP":
- Perception outputs observations with confidence; never identity
- Identity outputs one of four outcomes; never fabricates certainty
- Decision separates recommendation from confidence
- Presentation cannot alter intelligence
- Receipts at layer boundaries; every recommendation traceable

**Full Conformance (adds)**:
- Verification present and evidence-independent; incapable of creating candidates
- Knowledge separates external (provider interface) from internal (owned)
- Learning records every cycle; zero automatic behavior modification; changes follow Observation → Calibration → approved Change

**SHOULD (expected, not required)**:
- Per-descriptor confidence breakdowns for explainability
- Maturity gates on confidence components
- Kill switches per subsystem
- Failure classification (transient vs permanent) on external fetches

---

## 7. Illustrative Domains

**Collectibles** (the reference implementation, CardSignal) — photo of a trading card → identify the specific card and print variant → verify with fingerprint → enrich from market data → recommend buy/pass → present by tier → learn from user corrections.

**Document Processing** (representative alternative) — scan of an invoice → identify the vendor and document type → verify against header/footer patterns → enrich from vendor master data → recommend approve/flag/route → present as alert/queue entry → learn from corrections. This domain is intentionally boring, universally understood, and regulation-light — a proof that the layers generalize beyond collectibles.

**Regulated Domains (Financial Advice, Medical Decisions)** — out of scope. Compliance obligations beyond this specification's scope. SEP does not address them. Implementation in regulated domains requires domain-specific governance layers not defined here.

---

## 8. Non-Goals

- **No SDK, runtime, or shared adapter framework until a second independent implementation exists** (rule of two). The reference implementation's internals are not part of this specification. Runtime extraction is justified only after two verticals prove the contracts work across different domains.
- **No code generation from this specification.** Implementations start from these contracts, not from generated scaffolds.
- **Specification is language-agnostic.** Appendix A's TypeScript shapes are illustrative, not normative. Implement in your language; the contracts are what matter.

---

## 9. Appendix A: Illustrative Type Shapes (Non-Normative)

These shapes show how one implementation might structure data. The specification is language-agnostic; use these as a reference, not a requirement.

```typescript
// Every piece of evidence carries provenance — traceability is required by constitution.
interface Evidence<T> {
  value: T;
  source: string;             // "claude-vision", "local-catalog", "pricecharting", etc.
  confidence: number | null;  // null: source doesn't quantify; 0: source measured and found nothing
  observedAt: string;         // ISO 8601 timestamp
}

// PERCEPTION — observations only. What is absent is as important as what's present.
interface Observation {
  fields: Record<string, Evidence<string | number>>;
  quality?: { blur?: number; glare?: number };  // optional, extensible
}

// IDENTITY — the four honest outcomes.
type IdentityResolution =
  | { kind: "exact"; subject: SubjectRef; confidence: number }
  | { kind: "likely"; subject: SubjectRef; confidence: number }
  | { kind: "candidates"; candidates: SubjectRef[] }  // ordered, unresolved
  | { kind: "unknown" };

// VERIFICATION — confirms, demotes, reorders; never creates.
interface VerificationResult {
  verdict: "consistent" | "conflict" | "unavailable";
  perDescriptorScore: Record<string, number | null>;
  rankVsEquals: number | null;  // position among same-category peers
  mode: "shadow" | "enforce";
}

// DECISION — recommendation and confidence are separate, always auditable.
interface Decision {
  recommendation: string;      // domain vocabulary: "BUY", "PASS", etc.
  confidence: {
    score: number;
    measurableComponents: Record<string, { value: number; weight: number }>;
  };
  reasoning: string;  // human-auditable always
  receipts: string[]; // chain to evidence
}

// LEARNING — immutable record, never a behavior lever.
interface LearningRecord {
  observation: Observation;
  resolution: IdentityResolution;
  verification: VerificationResult | null;
  knowledge: Record<string, unknown>;
  decision: Decision;
  userCorrection?: { correctedTo: SubjectRef; reason?: string };
  versions: { prompt?: string; model?: string; resolver?: string };  // for attribution
}

// An ADAPTER wires abstract layers to domain specifics.
interface VerticalAdapter {
  perception: { extractionPrompt: string; fields: string[] };
  identity: { catalogSource: string; normalizer?: (s: string) => string };
  verification: { regions?: RegionMap };  // domain-specific layout
  knowledge: { providers: ProviderConfig[] };
  decision: { vocabulary: string[]; scoringFormula: ScorerConfig };
  presentation: { renderers: RendererSet };
}
```

---

## References & Related Standards

- **CardSignal Architecture v1.0** — the reference implementation, verified against code 2026-07-03
- **Signet Governance & Authority** — complementary specification for authorization, approvals, receipts
- **ASL (Agentic Specification Language)** — governance layer for this specification's deployment

---

**Next step:** Once a second independent implementation stress-tests these contracts, this document moves from Draft to Stable, and runtime extraction becomes justified. Until then, implementations start from these contracts as a guide, not a scaffold.
