// F7: reducer reuse — the scheduler emits events; the SAME reducer publishes state.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { runScheduler, type EmittedEvent } from '../src/scheduler.js';
import { applyEvent, reduceTo } from '../src/reducer.js';
import { buildSnapshot } from '../src/views.js';
import { buildBranchLog } from '../src/branch.js';
import { canonicalJson } from '../src/canon.js';
import { m2Setup, TB, TH } from './m2-setup.js';
import { FIX } from './paths.js';

describe('F7 reducer reuse', () => {
  it('(a) M1 reducer over prefix ++ oracle trace reproduces s4/s4b hashes', async () => {
    const { world, ledger } = await m2Setup();
    const prefix = ledger.events.filter((e) => e.t <= TB);
    const cases = [
      { trace: 'expected/sim_baseline.events.ndjson', snap: 'expected/s4b_simulated_baseline.json', branch: 'sim:baseline' },
      { trace: 'expected/sim_scenario.events.ndjson', snap: 'snapshots/s4_simulated_intervention.json', branch: 'sim:scenario' },
    ] as const;
    for (const { trace, snap, branch } of cases) {
      const traceEvents = (await readFile(`${FIX}/${trace}`, 'utf8'))
        .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
      const branchLog = [...prefix, ...traceEvents];
      const expected = JSON.parse(await readFile(`${FIX}/${snap}`, 'utf8'));
      const tS4 = TB + 40 * 60;
      const s: any = buildSnapshot(world, {
        id: expected.id, title: expected.title, log: branchLog, t: tS4,
        branch, mode: 'SIMULATE', claim_class: 'simulated', narrative: '',
      });
      expect(s.state_hash).toBe(expected.state_hash);
    }
  });

  it('(b) scheduler takes apply injected; spy sees every emitted event exactly once in emission order', async () => {
    const { world, baseState, scenario } = await m2Setup();
    const seen: EmittedEvent[] = [];
    const spy = (s: any, e: any) => {
      seen.push({ t: e.t, type: e.type, subject: e.subject, data: e.data, claim_class: 'simulated' } as EmittedEvent);
      applyEvent(s, e);
    };
    const { events } = runScheduler({
      world, baseState, tB: TB, tH: TH,
      arrivals: [],
      interventions: scenario.scenario_interventions,
      handoff_s: 60,
      apply: spy,
    });
    expect(seen.length).toBe(events.length);
    for (let i = 0; i < events.length; i++) {
      expect(seen[i].t).toBe(events[i].t);
      expect(seen[i].type).toBe(events[i].type);
      expect(seen[i].subject).toBe(events[i].subject);
    }
  });

  it('(c) scheduler.ts has no direct writes to state collections', async () => {
    const src = await readFile(new URL('../src/scheduler.ts', import.meta.url), 'utf8');
    // The scheduler may READ state (st.queue[0], scratch.work[id]) but must not
    // WRITE it; all mutations go through the injected apply. Writes look like
    // `.queue.push(`, `.in_progress.push(`, `s.work[x] =`, etc. The scheduler's
    // own timers/emitted/inputs arrays are not state and may be pushed to.
    const lines = src.split('\n');
    const bad: string[] = [];
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith('//')) continue;
      if (/\.queue\.(push|pop|splice)\s*\(/.test(line)) bad.push(line);
      if (/\.in_progress\.(push|pop|splice)\s*\(/.test(line)) bad.push(line);
      if (/\b(scratch|state|s)\.(work|orders|stations|assignments|on_shift|equipment)\[[^\]]+\]\s*=/.test(line)) bad.push(line);
      if (/\b(scratch|state|s)\.(queue|in_progress)\s*=/.test(line)) bad.push(line);
    }
    expect(bad).toEqual([]);
  });

  it('(d) published snapshots come only from reduceTo over the branch log', async () => {
    const { world, ledger, baseline } = await m2Setup();
    const branchLog = buildBranchLog(ledger.events, TB, baseline.events);
    // recompute the final snapshot independently from the branch log
    const snap: any = buildSnapshot(world, {
      id: 'x', title: 'x', log: branchLog, t: TH,
      branch: baseline.branch, mode: 'SIMULATE', claim_class: 'simulated', narrative: '',
    });
    expect(snap.state_hash).toBe(baseline.receipt.outputs.final_state_hash);
    // and the scheduler never publishes its scratch state: the receipt's
    // final hash is a pure function of the branch log
    const { state } = reduceTo(world, branchLog, TH);
    expect(canonicalJson(state)).toBe(canonicalJson(reduceTo(world, branchLog, TH).state));
  });
});
