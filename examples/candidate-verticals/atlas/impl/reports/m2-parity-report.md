# ATLAS V0 Milestone 2 — parity report

Generated 2026-10-09T15:15:16.605Z · engine atlas-impl/0.2.0 · reference cae5adf
Workload sha256: `ae7ad2b264fc003cd70413c2e0ad96baa726861ace6f85d6aab9258880bd471d`

| Arm | Events | trace_content_sha256 | final_state_hash | run_id |
|---|---|---|---|---|
| baseline | 872 | `9c4089b7e6682ea7df701856e31cf593c423f14f3e7642ccc6927daa8c684f9b` | `176e0d643322b0d15fbb3fb28a19c3d9bdb5c18d1d185d0c67c4399092b43b42` | `run_e8a2064271e4acd8` |
| scenario | 994 | `97e0d1fbb4e329df31f7dee08d09b2f945b217f6c5ecfa30f0ce10009b710ede` | `e11f66e8eb0389b57427da2515ff7f5f0d41c7708b9073a1a3e874de0ec9d279` | `run_720bb5fe3a1bd061` |

## Checks

- PASS scenario loads and validates (id=scn_fry_rush_reassign_emp04)
- PASS baseline: base_state_hash == s3
- PASS baseline: events_applied == 544
- PASS baseline: event count (872)
- PASS baseline: first seq (545)
- PASS baseline: workload_sha256
- PASS baseline: trace_content_sha256
- PASS baseline: final_state_hash
- PASS baseline: receipt_sha256 recomputes
- PASS scenario: base_state_hash == s3
- PASS scenario: events_applied == 544
- PASS scenario: event count (994)
- PASS scenario: first seq (545)
- PASS scenario: workload_sha256
- PASS scenario: trace_content_sha256
- PASS scenario: final_state_hash
- PASS scenario: receipt_sha256 recomputes
- PASS baseline: snapshot state_hash
- PASS baseline: snapshot state
- PASS baseline: snapshot metrics
- PASS baseline: snapshot diagnosis
- PASS scenario: snapshot state_hash
- PASS scenario: snapshot state
- PASS scenario: snapshot metrics
- PASS scenario: snapshot diagnosis
- PASS comparison operational subset == expected
- PASS calibration operational subset == expected, comparable
- PASS deterministic rerun

**Overall: PASS**
