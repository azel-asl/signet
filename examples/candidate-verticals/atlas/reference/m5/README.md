# reference/m5 — M5 RECOMMEND + ECONOMICS answer key

- `derive-expectations.mjs` regenerates `answer-key.json` (`--check` verifies byte equality).
- It uses the frozen fixture oracle's own scheduler and reducer by loading an unmodified copy of
  `fixtures/restaurant-v0/oracle/generate.mjs` (root path and final `main();` replaced by exports, written to the OS
  temp directory). It imports nothing from `impl/`.
- Built-in parity: the regenerated baseline and the `emp_04 → st_fry, to_horizon` candidate reproduce the frozen M2
  `expected/sim_baseline.events.ndjson` and `expected/sim_scenario.events.ndjson` (t, type, subject, data projection).
- `config.json` holds every configured assumption used by the canonical case (candidate windows, per-move cost,
  sensitivity values). None of them is an observation.
- The answer key fixes semantics (candidates, eligibility, metrics, deltas, statuses, dominance, ranking, economics,
  sensitivity, no-action cases), not the runtime JSON shape; the runtime shape is `schema/atlas-recommendation.schema.json`.
- Fixture-specific by design (it names the canonical destination station). It is not a template for pack code.
