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
import { canonicalJson, sha256Hex, stateHash } from '../src/canon.js';

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
  // Strict load first: the frozen world is expected to FAIL here (CCR-001).
  // The replay demonstration below proceeds only through the explicit,
  // logged deviation affordance — never silently.
  let strictError: string | null = null;
  try {
    await loadWorld(
      path.join(FIX, 'world.restaurant-v0.json'),
      path.join(SCHEMA, 'atlas-world-definition.schema.json'),
    );
  } catch (e) {
    strictError = e instanceof Error ? e.message : String(e);
  }
  const { world, warnings } = await loadWorld(
    path.join(FIX, 'world.restaurant-v0.json'),
    path.join(SCHEMA, 'atlas-world-definition.schema.json'),
    { allowDeviations: ['CCR-001'] },
  );
  if (warnings.length) {
    console.log(`NOTE: proceeding under explicitly allowed deviation CCR-001 (${warnings.length} warnings):`);
    for (const w of warnings.slice(0, 12)) console.log(`  ${w.pointer}: ${w.message}`);
  }
  const ledger = await loadLedger(
    path.join(FIX, 'normalized', 'events.ndjson'),
    path.join(SCHEMA, 'atlas-event.schema.json'),
  );
  const checkpoints = buildCheckpoints(world, ledger.events);

  const snapshots: Record<string, any>[] = [];
  for (const c of CANONICAL) {
    const expected = JSON.parse(await readFile(path.join(FIX, c.fixture), 'utf8'));
    const t = tOf(world, c.hhmm);
    const runA = buildSnapshot(world, {
      id: expected.id, title: expected.title, log: ledger.events, t,
      branch: 'history:day1', mode: 'RECONSTRUCT', claim_class: 'derived',
      narrative: expected.narrative ?? '',
    });
    const runB = buildSnapshot(world, {
      id: expected.id, title: expected.title, log: ledger.events, t,
      branch: 'history:day1', mode: 'RECONSTRUCT', claim_class: 'derived',
      narrative: expected.narrative ?? '',
    });
    const cmp = compareSnapshots(expected, runA);
    // checkpoint-vs-full-replay equivalence at this T
    const full = reduceTo(world, ledger.events, t);
    const { result: viaCp } = reduceToCheckpointed(world, ledger.events, checkpoints, t);
    const mFull = computeMetrics(world, full.state, t, ledger.events);
    const mCp = computeMetrics(world, viaCp.state, t, ledger.events);
    const fullHash = stateHash(full.state, mFull);
    const cpHash = stateHash(viaCp.state, mCp);
    // CCR-002: the re-stamp value is fully determined by the frozen file's own
    // content — canonicalize it independently of the runtime.
    const restampHash = sha256Hex(canonicalJson({ state: expected.state, metrics: expected.metrics }));
    const contentMatch = Object.values(cmp.sections).every((s) => s.match);
    snapshots.push({
      id: expected.id,
      t, ts: iso(world, t),
      fixture: c.fixture,
      expected_hash: cmp.expectedHash,
      actual_hash: cmp.actualHash,
      hash_match: cmp.hashMatch,
      restamp_hash_ccr002: restampHash,
      restamp_matches_runtime: restampHash === (runA.state_hash as string),
      content_match: contentMatch,
      run_a_hash: runA.state_hash,
      run_b_hash: runB.state_hash,
      deterministic: runA.state_hash === runB.state_hash,
      full_replay_hash: fullHash,
      checkpoint_replay_hash: cpHash,
      checkpoint_equivalent: fullHash === cpHash,
      sections: Object.fromEntries(
        Object.entries(cmp.sections).map(([k, v]) => [k, { match: v.match, diff_count: v.diffs.length }]),
      ),
      diffs: cmp.diffs.slice(0, 10),
      // Per handoff §3 a contract disagreement remains a failing check until
      // approved: hash equality is gated on CCR-002, world validation on CCR-001.
      hash_verdict: cmp.hashMatch ? 'PASS' : 'FAIL (CCR-002 pending)',
      verdict:
        contentMatch && runA.state_hash === runB.state_hash && fullHash === cpHash
          ? 'PASS (content)'
          : 'FAIL',
    });
  }

  const contentPass = snapshots.every((s) => s.verdict === 'PASS (content)');
  const hashPass = snapshots.every((s) => s.hash_verdict === 'PASS');
  const blockers: string[] = [];
  if (strictError) blockers.push('CCR-001: frozen world fails frozen schema (10 id-pattern pointers)');
  if (!hashPass) blockers.push('CCR-002: state_hash re-stamp to XAS-CANON-1 pending');
  if (!contentPass) blockers.push('content parity failures (see diffs)');
  const report = {
    generated_at: new Date().toISOString(),
    engine: 'atlas-impl/0.1.0',
    world: world.metadata.id,
    world_validation: strictError
      ? { verdict: 'FAIL', reason: 'CCR-001 pending (see contract-changes/CCR-001.md)', detail: strictError }
      : { verdict: 'PASS' },
    world_load_warnings: warnings,
    branch: 'history:day1',
    ledger_events: ledger.count,
    ledger_input_order_matched: ledger.inputOrderMatched,
    checkpoints_built: checkpoints.length,
    snapshots,
    content_parity: contentPass ? 'PASS' : 'FAIL',
    hash_parity: hashPass ? 'PASS' : 'FAIL',
    blockers,
    overall: blockers.length === 0 ? 'PASS' : 'FAIL',
    overall_note:
      blockers.length === 0
        ? 'Milestone 1 passes.'
        : 'Implementation complete; content parity holds. M1 PASS is blocked on Fable accepting the filed CCRs — no frozen content disagreement remains.',
  };

  await mkdir(REPORTS, { recursive: true });
  await writeFile(path.join(REPORTS, 'parity-report.json'), JSON.stringify(report, null, 2) + '\n');
  const md = [
    '# ATLAS V0 Milestone 1 — parity report',
    '',
    `Generated ${report.generated_at} · engine ${report.engine} · world ${report.world} · branch history:day1`,
    `Ledger: ${ledger.count} events (committed order matched reduction order: ${ledger.inputOrderMatched}) · checkpoints: ${checkpoints.length}`,
    '',
    '| Snapshot | T | Expected | Actual (canonical) | Re-stamp = actual | Content | Hash | Checkpoint ≡ full |',
    '|---|---|---|---|---|---|---|---|---|',
    ...snapshots.map((s) =>
      `| ${s.id} | ${s.ts} | \`${String(s.expected_hash).slice(0, 12)}…\` | \`${String(s.actual_hash).slice(0, 12)}…\` | ${s.restamp_matches_runtime ? 'yes' : 'NO'} | ${s.content_match ? 'PASS' : 'FAIL'} | ${s.hash_verdict} | ${s.checkpoint_equivalent ? 'yes' : 'NO'} |`,
    ),
    '',
    `Content parity: **${report.content_parity}** · Hash parity: **${report.hash_parity}** · Overall: **${report.overall}**`,
    ...blockers.map((b) => `- Blocker: ${b}`),
    '',
    ...snapshots.flatMap((s) =>
      s.verdict === 'FAIL'
        ? ['', `## ${s.id} diffs`, ...s.diffs.map((d: any) => `- \`${d.path}\` (${d.kind}): expected ${JSON.stringify(d.expected)} vs actual ${JSON.stringify(d.actual)}`)]
        : [],
    ),
  ].join('\n');
  await writeFile(path.join(REPORTS, 'parity-report.md'), md + '\n');

  for (const s of snapshots) {
    console.log(
      `${s.verdict} ${s.id} @ ${s.ts}  expected=${String(s.expected_hash).slice(0, 16)} ` +
      `actual=${String(s.actual_hash).slice(0, 16)} restamp=${String(s.restamp_hash_ccr002).slice(0, 16)}`,
    );
  }
  console.log(`content: ${report.content_parity}, hashes: ${report.hash_parity}, overall: ${report.overall}`);
  if (blockers.length) {
    console.log('blockers:');
    for (const b of blockers) console.log(`  - ${b}`);
  }
  if (report.overall !== 'PASS') process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
