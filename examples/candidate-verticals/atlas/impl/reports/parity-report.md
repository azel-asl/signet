# ATLAS V0 Milestone 1 — parity report

Generated 2026-10-07T07:20:27.999Z · engine atlas-impl/0.1.0 · world restaurant-v0 · branch history:day1
Ledger: 1815 events (committed order matched reduction order: true) · checkpoints: 9

| Snapshot | T | Expected | Actual (canonical) | Re-stamp = actual | Content | Hash | Checkpoint ≡ full |
|---|---|---|---|---|---|---|---|---|
| s1_normal | 2026-10-06T17:45:00-07:00 | `e43bb95a3f84…` | `7d7139243bb4…` | yes | PASS | FAIL (CCR-002 pending) | yes |
| s2_bottleneck_emerging | 2026-10-06T18:08:00-07:00 | `ce8385bf396e…` | `765d5cb501ec…` | yes | PASS | FAIL (CCR-002 pending) | yes |
| s3_bottleneck_active | 2026-10-06T18:20:00-07:00 | `5ed539b87773…` | `67f66b29b3f9…` | yes | PASS | FAIL (CCR-002 pending) | yes |
| s4_observed_reference | 2026-10-06T19:00:00-07:00 | `9542f78fe959…` | `8de373a7d10f…` | yes | PASS | FAIL (CCR-002 pending) | yes |

Content parity: **PASS** · Hash parity: **FAIL** · Overall: **FAIL**
- Blocker: CCR-001: frozen world fails frozen schema (10 id-pattern pointers)
- Blocker: CCR-002: state_hash re-stamp to XAS-CANON-1 pending

