// Milestone 1 parity runner: rebuilds the four canonical historical snapshots
// with the independent runtime and compares them against the frozen fixtures.
// Writes reports/parity-report.json (machine-readable) and parity-report.md.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorld } from '../src/world.js';
import { loadLedger } from '../src/ledger.js';
import { reduceTo } from '../src/reducer.js';
import { buildCheckpoints, reduceToCheckpointed } from '../src/checkpoints.js';
import { buildSnapshot, computeMetrics, iso } from '../src/views.js';
import { compareSnapshots } from '../src/parity.js';
import { stateHash } from '../src/canon.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ATLAS = path.resolve(here, '..', '..', '..'); // dist/scripts -> atlas/
const FIX = path.join(ATLAS, 'fixtures', 'restaurant-v0');
const SCHEMA = path.join(ATLAS, 'schema');
const REPORTS = path.resolve(here, '..', '..', 'reports'); // impl/reports/

const CANONICAL = [
  { fixture: 'snapshots/s1_normal.json', hhmm: '17:45' },
  { fixture: 'snapshots/s2_bottleneck_emerging.json', hhmm: '18:08' },
  { fixture: 'snapshots/s3_bottleneck_active.json', hhmm: '18:20' },
  { fixture: 'expected/s4_observed_reference.json', hhmm: '19:00' },
];

function tOf(world: { time: { origin: string } }, hhmm: string): number {
  const t0 = Math.floor(Date.parse(world.time.origin) / 1000);
  const [h, m] = hhmm.split(':').map(Number);
  return t0 + (h - 17) * 3600 + m * 60;
}

async function main(): Promise<void> {
  // Strict load: the corrected reference world must validate with no deviations.
  const world = await loadWorld(
    path.join(FIX, 'world.restaurant-v0.json'),
    path.join(SCHEMA, 'atlas-world-definition.schema.json'),
  );
  const ledger = await loadLedger(
    path.join(FIX, 'normalized', 'events.ndjson'),
    path.join(SCHEMA, 'atlas-event.schema.json'),
  );
  const manifest = JSON.parse(await readFile(path.join(FIX, 'manifest.json'), 'utf8'));
  const checkpoints = buildCheckpoints(world, ledger.events);

  const snapshots: Record<string, any>[] = [];
  for (const c of CANONICAL) {
    const expected = JSON.parse(await readFile(path.join(FIX, c.fixture), 'utf8'));
    const t = tOf(world, c.hhmm);
    const input = (id: string) => ({
      id, title: expected.title, log: ledger.events, t,
      branch: 'history:day1', mode: 'RECONSTRUCT' as const, claim_class: 'derived' as const,
      narrative: expected.narrative ?? '',
    });
    const runA = buildSnapshot(world, input(expected.id));
    const runB = buildSnapshot(world, input(expected.id));
    const cmp = compareSnapshots(expected, runA);
    // checkpoint-vs-full-replay equivalence at this T
    const full = reduceTo(world, ledger.events, t);
    const { result: viaCp } = reduceToCheckpointed(world, ledger.events, checkpoints, t);
    const fullHash = stateHash(full.state, computeMetrics(world, full.state, t, ledger.events));
    const cpHash = stateHash(viaCp.state, computeMetrics(world, viaCp.state, t, ledger.events));
    const deterministic = runA.state_hash === runB.state_hash;
    const checkpointEquivalent = fullHash === cpHash;
    snapshots.push({
      id: expected.id,
      t, ts: iso(world, t),
      fixture: c.fixture,
      expected_hash: cmp.expectedHash,
      actual_hash: cmp.actualHash,
      hash_match: cmp.hashMatch,
      content_match: Object.values(cmp.sections).every((s) => s.match),
      sections: Object.fromEntries(
        Object.entries(cmp.sections).map(([k, v]) => [k, { match: v.match, diff_count: v.diffs.length }]),
      ),
      diffs: cmp.diffs.slice(0, 10),
      run_a_hash: runA.state_hash,
      run_b_hash: runB.state_hash,
      deterministic,
      full_replay_hash: fullHash,
      checkpoint_replay_hash: cpHash,
      checkpoint_equivalent: checkpointEquivalent,
      verdict: cmp.match && deterministic && checkpointEquivalent ? 'PASS' : 'FAIL',
    });
  }

  const allPass = snapshots.every((s) => s.verdict === 'PASS');
  const report = {
    generated_at: new Date().toISOString(),
    engine: 'atlas-impl/0.1.0',
    reference_commit: 'cd0db9e',
    world: world.metadata.id,
    world_validation: 'PASS',
    manifest_hash_rule: manifest.hash_rule ?? null,
    branch: 'history:day1',
    ledger_events: ledger.count,
    ledger_input_order_matched: ledger.inputOrderMatched,
    checkpoints_built: checkpoints.length,
    snapshots,
    overall: allPass ? 'PASS' : 'FAIL',
  };

  await mkdir(REPORTS, { recursive: true });
  await writeFile(path.join(REPORTS, 'parity-report.json'), JSON.stringify(report, null, 2) + '\n');
  const md = [
    '# ATLAS V0 Milestone 1 — parity report',
    '',
    `Generated ${report.generated_at} · engine ${report.engine} · reference ${report.reference_commit} · world ${report.world} · branch history:day1`,
    `World validation: ${report.world_validation} · manifest.hash_rule: ${report.manifest_hash_rule}`,
    `Ledger: ${ledger.count} events (committed order matched reduction order: ${ledger.inputOrderMatched}) · checkpoints: ${checkpoints.length}`,
    '',
    '| Snapshot | T | Expected hash | Actual hash | Hash | Content | Deterministic | Checkpoint ≡ full | Verdict |',
    '|---|---|---|---|---|---|---|---|---|',
    ...snapshots.map((s) =>
      `| ${s.id} | ${s.ts} | \`${s.expected_hash}\` | \`${s.actual_hash}\` | ${s.hash_match ? 'match' : '**MISMATCH**'} | ${s.content_match ? 'match' : '**MISMATCH**'} | ${s.deterministic ? 'yes' : '**NO**'} | ${s.checkpoint_equivalent ? 'yes' : '**NO**'} | **${s.verdict}** |`,
    ),
    '',
    `Overall: **${report.overall}**`,
    '',
    ...snapshots.flatMap((s) =>
      s.verdict === 'FAIL'
        ? ['', `## ${s.id} diffs`, ...s.diffs.map((d: any) => `- \`${d.path}\` (${d.kind}): expected ${JSON.stringify(d.expected)} vs actual ${JSON.stringify(d.actual)}`)]
        : [],
    ),
  ].join('\n');
  await writeFile(path.join(REPORTS, 'parity-report.md'), md + '\n');

  for (const s of snapshots) {
    console.log(`${s.verdict} ${s.id} @ ${s.ts}  hash_match=${s.hash_match} content_match=${s.content_match}`);
  }
  console.log(`overall: ${report.overall}`);
  if (!allPass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
