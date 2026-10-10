// ATLAS M5 explanation (19 §O). Fixed deterministic templates rendering only
// structured values. Same post-checks as M4 §L plus forbidden words:
// will, guarantee, profit. Every set's explanation ends with R_AUTHORITY.
// No generative prose engine.
import type { World } from '../types.js';
import type { Candidate, RecommendationSet } from './types.js';
import { RecommendationError } from './types.js';

export interface ExplainLine {
  candidate_id: string | null;
  text: string;
  claim_class: string;
}

const FORBIDDEN = /\b(will|guarantee|profit)\b/i;

function checkText(text: string): void {
  if (FORBIDDEN.test(text)) {
    throw new RecommendationError('EXPLANATION_FORBIDDEN_WORD', `forbidden word in: ${text}`);
  }
}

function entityName(world: World, id: string): string {
  const e = world.entities.find((x) => x.id === id);
  return (e?.attrs as { name?: string } | undefined)?.name ?? id;
}

function hhmm(world: World, t: number): string {
  // Format as HH:MM in the world's timezone-naive local rendering.
  const d = new Date(t * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function fmtDeltaSeconds(v: number): string {
  const a = Math.abs(v);
  if (v === 0) return 'unchanged';
  return v < 0 ? `down ${a}s` : `up ${a}s`;
}

export function explainCandidate(world: World, c: Candidate): ExplainLine[] {
  const lines: ExplainLine[] = [];
  const rName = entityName(world, c.resource);
  const toName = entityName(world, c.to);
  const fromName = c.from ? entityName(world, c.from) : 'unassigned';

  // R_CANDIDATE
  lines.push({
    candidate_id: c.id,
    text: `${rName}: ${fromName} → ${toName}, ${hhmm(world, c.window.start_t)}–${hhmm(world, c.window.end_t)}.`,
    claim_class: 'derived',
  });

  if (c.status === 'infeasible') {
    // R_INFEASIBLE
    const reasons = c.eligibility.reasons.join(', ');
    lines.push({
      candidate_id: c.id,
      text: `${rName} cannot be moved to ${toName}: ${reasons}.`,
      claim_class: 'derived',
    });
    return lines;
  }

  if (c.delta && c.metrics) {
    // R_DELTA
    const tis = c.delta.order_time_in_system_s;
    const tisText = tis < 0 ? `improves by ${-tis}s` : tis > 0 ? `worsens by ${tis}s` : 'unchanged';
    const qb = c.delta.stations[c.to]?.queue_burden_s ?? 0;
    lines.push({
      candidate_id: c.id,
      text: `SIMULATED · Versus doing nothing: order time in system ${tisText}, ${c.delta.orders_completed_in_window} more orders completed, ${toName} queue burden ${fmtDeltaSeconds(qb)}.`,
      claim_class: 'simulated',
    });

    // R_OVERLOAD_END
    const baseLast = (c as { _baselineLast?: number | null })._baselineLast;
    const candLast = c.metrics.stations[c.to]?.overload_last_t ?? null;
    if (baseLast != null && candLast != null && baseLast > candLast) {
      const mins = Math.round((baseLast - candLast) / 60);
      lines.push({
        candidate_id: c.id,
        text: `SIMULATED · ${toName} overload ends ${mins} minutes earlier.`,
        claim_class: 'simulated',
      });
    }

    // R_TRADEOFF / R_NEW_OVERLOAD
    for (const t of c.trade_offs) {
      const sName = entityName(world, t.station);
      if (t.metric === 'overload_s' && c.new_overload_stations.includes(t.station)) {
        lines.push({
          candidate_id: c.id,
          text: `SIMULATED · New overload at ${sName} (${t.scenario}s).`,
          claim_class: 'simulated',
        });
      } else {
        const metricText = t.metric === 'queue_burden_s' ? 'queue burden' : 'overload time';
        lines.push({
          candidate_id: c.id,
          text: `SIMULATED · Trade-off: ${sName} ${metricText} rises from ${t.baseline} to ${t.scenario}.`,
          claim_class: 'simulated',
        });
      }
    }

    // R_ECONOMICS (base rate)
    if (c.economics) {
      const rate = c.economics.inputs.find((x) => x.name === 'delay_cost_per_order_minute')?.value ?? 0;
      const net = c.economics.by_value.base.net_effect;
      const netText = net >= 0 ? `+${net.toFixed(2)}` : net.toFixed(2);
      lines.push({
        candidate_id: c.id,
        text: `ASSUMED · At ${rate} per order-minute over target, net effect ${netText} (delay cost only; no revenue is assumed).`,
        claim_class: 'assumed',
      });
    }

    // R_RANK / R_DOMINATED
    if (c.rank != null) {
      const variant = c.status === 'conditionally_recommended'
        ? 'Ranked conditionally: lowest order time in system among non-dominated candidates with new overloads.'
        : 'Ranked: lowest order time in system among non-dominated candidates without new overloads.';
      lines.push({ candidate_id: c.id, text: `Ranked ${c.rank}: ${variant}`, claim_class: 'simulated' });
    } else if (c.dominated_by.length > 0) {
      lines.push({
        candidate_id: c.id,
        text: `Dominated by ${c.dominated_by.join(', ')}.`,
        claim_class: 'simulated',
      });
    }
  }

  return lines;
}

export function explainSet(world: World, set: RecommendationSet): ExplainLine[] {
  const lines: ExplainLine[] = [];
  for (const c of set.candidates) {
    lines.push(...explainCandidate(world, c));
  }
  if (set.top.kind === 'no_action') {
    const reasonText = set.top.reason.replace(/_/g, ' ').toLowerCase();
    lines.push({
      candidate_id: null,
      text: `No evaluated intervention is better than doing nothing (${reasonText}).`,
      claim_class: set.top.claim_class,
    });
  }
  // R_AUTHORITY always last.
  lines.push({
    candidate_id: null,
    text: 'Advisory only. ATLAS does not execute or authorise this change.',
    claim_class: 'derived',
  });
  for (const l of lines) checkText(l.text);
  return lines;
}
