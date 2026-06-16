# XAS-CANON-1: Canonical Serialization

**Version:** 1.0 | **Author:** ASL Labs | **Status:** Final

Deterministic JSON serialization for Signet receipts. Based on RFC 8785 with Signet additions.

---

## Rules

| # | Rule |
|---|---|
| 1 | Object keys sorted lexicographically (ASCII code point), recursively |
| 2 | Strings NFC-normalized |
| 3 | Numbers in shortest decimal form: `1.0→1`, `1e2→100`, non-finite → ERROR |
| 4 | No insignificant whitespace |
| 5 | Arrays: order preserved, elements recursively canonicalized |
| 6 | `undefined` anywhere → ERROR |
| 7 | Absent field ≠ null field (different canonical forms) |

---

## Algorithms

### `canonicalize(value)`
Recursively apply rules above. Returns a deterministic JSON string.

### `canonHash(value)`
`SHA-256(UTF-8(canonicalize(value)))` → hex string.

### `receiptSemanticCore(receipt)`
Extracts only semantically meaningful fields — excludes timestamps, prose, hashes, signature:
```
{ packet_id, packet_sha256, verdict, outcome, task_results[],
  block_events[], gate_results[], acceptance_results[],
  behavioral_reports[], ledger_matches }
```

### `h10(receipt)`
`canonHash(receiptSemanticCore(receipt))`  
**Property:** Identical meaning ⟹ identical h10, regardless of timestamps.

### `receiptSha256(receipt)`
`canonHash(receipt with hashes + signature deleted)`  
**Property:** Any byte change to the receipt changes sha256.

---

## Dual-Hash Integrity

| Hash | Input | Detects |
|---|---|---|
| `sha256` | Full receipt (minus hashes/sig) | Byte tampering |
| `h10` | Semantic core only | Meaning alteration |

**Cross-check:** Edit bytes → sha256 fails. Edit meaning and recompute sha256 → h10 still fails.

---

## Required Test Cases

1. Key order independence
2. Nested key sorting
3. NFC normalization — composed vs decomposed `café`
4. Absent vs null are different
5. Undefined throws
6. Number formats (`1.0→1`, `1e2→100`, non-finite throws)
7. Array order preserved
8. Round-trip stability
9. Same packet, different timestamps → same h10, different sha256
10. Flip task status → h10 changes
11. h10 ignores prose/timestamps; sha256 does not
12. Semantic core contains exactly spec fields

---

## References
- RFC 8785: JSON Canonicalization Scheme
- Unicode Normalization Forms (NFC/NFD)
- SHA-256 (FIPS 180-4)
