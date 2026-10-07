# ATLAS V0 Milestone 1 — parity report

Generated 2026-10-07T14:19:24.540Z · engine atlas-impl/0.1.0 · reference cd0db9e · world restaurant-v0 · branch history:day1
World validation: PASS · manifest.hash_rule: XAS-CANON-1
Ledger: 1815 events (committed order matched reduction order: true) · checkpoints: 9

| Snapshot | T | Expected hash | Actual hash | Hash | Content | Deterministic | Checkpoint ≡ full | Verdict |
|---|---|---|---|---|---|---|---|---|
| s1_normal | 2026-10-06T17:45:00-07:00 | `7d7139243bb43c08bb910bb7a641588b685c154b4178c11874d60250b70f71bd` | `7d7139243bb43c08bb910bb7a641588b685c154b4178c11874d60250b70f71bd` | match | match | yes | yes | **PASS** |
| s2_bottleneck_emerging | 2026-10-06T18:08:00-07:00 | `765d5cb501eccb71fcf890ecb89773ac207f325954c192c34306018186bb06b6` | `765d5cb501eccb71fcf890ecb89773ac207f325954c192c34306018186bb06b6` | match | match | yes | yes | **PASS** |
| s3_bottleneck_active | 2026-10-06T18:20:00-07:00 | `67f66b29b3f98237825b633f095ea1da56b4c4dbdf5e072c80b1b9faf4fefa84` | `67f66b29b3f98237825b633f095ea1da56b4c4dbdf5e072c80b1b9faf4fefa84` | match | match | yes | yes | **PASS** |
| s4_observed_reference | 2026-10-06T19:00:00-07:00 | `8de373a7d10fa05056c3227a81ff9f154a8d74de16ae2a4e94cc0132010cc42e` | `8de373a7d10fa05056c3227a81ff9f154a8d74de16ae2a4e94cc0132010cc42e` | match | match | yes | yes | **PASS** |

Overall: **PASS**

