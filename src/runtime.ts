// Signet v0.1 — Governance Runtime (simulation mode)
// (named runtime.ts: governance.ts already holds v1.5.2 receipt-time enforcement)
//
// Imports: types.ts, canon.ts. MUST NOT import validator.ts (circular-dep rule)
// and MUST NOT be imported by verify.ts (open/closed boundary).
//
// v0.1 enforces locks against the actions a packet DECLARES, not against what
// a live agent actually does. Targets are extracted from task text by a
// documented rule and recorded in the receipt (source: "extracted").
// Gates and acceptance tests that cannot be checked mechanically are marked
// UNEVALUATED — never silently passed.

import type {
  ParsedPacket, Task, Lock, EvidenceType,
  Action, ActionKind, GovernanceResult, GovernanceReceipt, GovernOptions,
  BlockEvent, TaskResult, GateResult, AcceptanceTestResult,
  BehavioralLockReport, LedgerCrossCheck, EvalResult, GovernanceVerdict,
} from './types.js';
import { sha256text, receiptSha256, h10 } from './canon.js';

// ============================================================
// Errors
// ============================================================

export type GovernanceErrorCode =
  | 'NO_META' | 'NO_EXECUTION_PLAN' | 'DEPENDENCY_CYCLE' | 'UNKNOWN_DEPENDENCY';

export class GovernanceError extends Error {
  constructor(public code: GovernanceErrorCode, message: string) {
    super(message);
    this.name = 'GovernanceError';
  }
}

// ============================================================
// Action derivation (v0.1: extracted from task text)
// ============================================================

const KIND_MAP: Record<EvidenceType, ActionKind> = {
  file_read: 'read',
  file_checksum: 'read',
  file_write: 'write',
  command_output: 'execute',
  tool_call_log: 'execute',
  human_confirmation: 'approve',
  approval_token: 'approve',
  gate_check: 'assert',
  acceptance_test: 'assert',
  agent_assertion: 'assert',
};

/**
 * Extracts path-like tokens from task text. Deterministic and intentionally simple.
 * Matches: ./relative/paths, ../up/paths, bare dotfiles (.env), and
 * filename.ext tokens with known extensions.
 */
const TARGET_PATTERN =
  /(?:\.{1,2}\/[\w\-./*]+|(?<![\w.])\.\w[\w.]*|\b[\w-]+\.(?:ts|js|json|md|env|key|pem|sh|yml|yaml|sql|csv|txt)\b)/g;

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

export function deriveActions(packet: ParsedPacket): Action[] {
  return (packet.executionPlan?.tasks ?? []).map(task => ({
    task_id: task.id,
    kind: KIND_MAP[task.evidence_type] ?? 'assert',
    targets: unique([
      ...(task.description.match(TARGET_PATTERN) ?? []),
      ...(task.expected_result.match(TARGET_PATTERN) ?? []),
    ]),
    description: task.description,
    source: 'extracted' as const,
  }));
}

// ============================================================
// Forbidden pattern set (structural enforcement source)
// ============================================================

export interface ForbiddenPattern {
  pattern: string;
  source: 'scope.excluded' | 'output_contract.forbidden_outputs';
}

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/^\.\//, '');
}

export function buildForbiddenSet(packet: ParsedPacket): ForbiddenPattern[] {
  const out: ForbiddenPattern[] = [];
  for (const p of packet.scope?.excluded ?? []) {
    out.push({ pattern: normalize(p), source: 'scope.excluded' });
  }
  for (const p of packet.outputContract?.forbidden_outputs ?? []) {
    out.push({ pattern: normalize(p), source: 'output_contract.forbidden_outputs' });
  }
  return out;
}

// ============================================================
// Pure decision core — v0.2 live interceptors wrap this unchanged
// ============================================================

/**
 * Pure: evaluates one action against the forbidden set. No state, no clock.
 * Matching is substring containment in both directions after normalization.
 * Packet strings are treated as literals — no regex is ever compiled from
 * packet data (pattern injection defense).
 */
export function evaluateAction(
  action: Action,
  forbidden: ForbiddenPattern[],
  locks: Lock[],
): { blocked: boolean; events: Omit<BlockEvent, 'timestamp'>[] } {
  const events: Omit<BlockEvent, 'timestamp'>[] = [];

  // approve/assert actions produce no effects — never lock-checked
  if (action.kind === 'approve' || action.kind === 'assert') {
    return { blocked: false, events };
  }

  const runtimeLocks = locks.filter(l => l.type === 'runtime_enforced');

  for (const target of action.targets) {
    const nt = normalize(target);
    if (nt.length === 0) continue;
    for (const fp of forbidden) {
      // reads are only checked against excluded scope
      if (action.kind === 'read' && fp.source !== 'scope.excluded') continue;
      if (fp.pattern.length === 0) continue;

      const match = nt.includes(fp.pattern) || fp.pattern.includes(nt);
      if (!match) continue;

      // Attribution: first runtime_enforced lock whose rule text contains
      // the matched pattern token; fallback = first runtime lock, packet_level.
      const byToken = runtimeLocks.find(l =>
        l.rule.toLowerCase().includes(fp.pattern));
      const lock = byToken ?? runtimeLocks[0];
      if (!lock) continue; // no runtime locks declared — nothing enforces

      events.push({
        task_id: action.task_id,
        lock_id: lock.id,
        lock_rule: lock.rule,
        lock_type: lock.type,
        attribution: byToken ? 'rule_token' : 'packet_level',
        matched_pattern: fp.pattern,
        pattern_source: fp.source,
        matched_target: target,
        action_kind: action.kind,
        action_description: action.description,
        severity: 'error',
      });
    }
  }

  return { blocked: events.length > 0, events };
}

// ============================================================
// Topological sort (Kahn) — defensive; validator already checked
// ============================================================

function topoSort(tasks: Task[]): Task[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const t of tasks) {
    indegree.set(t.id, 0);
  }
  for (const t of tasks) {
    for (const dep of t.depends_on) {
      if (!dep) continue;
      if (!byId.has(dep)) {
        throw new GovernanceError('UNKNOWN_DEPENDENCY',
          `Task ${t.id} depends_on "${dep}" which does not exist`);
      }
      indegree.set(t.id, (indegree.get(t.id) ?? 0) + 1);
      const list = dependents.get(dep) ?? [];
      list.push(t.id);
      dependents.set(dep, list);
    }
  }

  // stable: process ready tasks in declaration order
  const order: Task[] = [];
  const ready = tasks.filter(t => (indegree.get(t.id) ?? 0) === 0).map(t => t.id);
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(byId.get(id)!);
    for (const dep of dependents.get(id) ?? []) {
      const d = (indegree.get(dep) ?? 0) - 1;
      indegree.set(dep, d);
      if (d === 0) ready.push(dep);
    }
  }

  if (order.length !== tasks.length) {
    throw new GovernanceError('DEPENDENCY_CYCLE',
      'Dependency cycle detected in execution plan');
  }
  return order;
}

// ============================================================
// Gate evaluation
// ============================================================

const TASK_ID_RE = /TASK_\d{3}/g;

function evaluateGates(
  packet: ParsedPacket,
  statusOf: Map<string, TaskResult>,
): GateResult[] {
  return packet.gates.map(g => {
    // Human gates require an approval record (v1.5.2 REC_019 applied at runtime).
    if (g.evaluator === 'human') {
      // v0.1: ParsedPacket carries no approval records — a human gate without
      // proof is a failed gate.
      const pass = false;
      return {
        gate_id: g.id,
        condition: g.condition,
        result: (pass ? 'PASS' : 'FAIL') as EvalResult,
        method: 'approval_record' as const,
        on_fail: g.on_fail,
        halted_run: !pass && g.on_fail === 'HALT',
      };
    }

    // Dependency-shaped conditions: condition mentions >= 2 task IDs.
    const mentioned = unique(g.condition.match(TASK_ID_RE) ?? []);
    if (g.evaluator === 'agent' && mentioned.length >= 2) {
      const known = mentioned.filter(id => statusOf.has(id));
      // Topological execution guarantees ordering; the mechanical check is
      // that every mentioned task was processed and the first-listed
      // dependency completed.
      const allProcessed = known.length === mentioned.length && known.length > 0;
      const firstOk = known.length > 0 &&
        statusOf.get(known[0])!.status === 'COMPLETE';
      const pass = allProcessed && firstOk;
      return {
        gate_id: g.id,
        condition: g.condition,
        result: (pass ? 'PASS' : 'FAIL') as EvalResult,
        method: 'dependency_order' as const,
        on_fail: g.on_fail,
        halted_run: !pass && g.on_fail === 'HALT',
      };
    }

    // Everything else: honestly unevaluated.
    return {
      gate_id: g.id,
      condition: g.condition,
      result: 'UNEVALUATED' as EvalResult,
      method: 'unevaluated' as const,
      on_fail: g.on_fail,
      halted_run: false,
    };
  });
}

// ============================================================
// Acceptance test evaluation — one built-in checker: scope_containment
// ============================================================

const CONTAINMENT_RE = /outside\s+(\S+)/i;

function evaluateAcceptanceTests(
  packet: ParsedPacket,
  taskResults: TaskResult[],
): AcceptanceTestResult[] {
  const tests = packet.acceptanceTests?.tests ?? [];
  return tests.map(at => {
    const m = at.pass_condition.match(CONTAINMENT_RE) ??
              at.check.match(CONTAINMENT_RE);
    if (m) {
      const root = normalize(m[1].replace(/[.,;]+$/, '')).replace(/\/+$/, '');
      // Every write-kind action that was NOT blocked must have all targets
      // within the allowed root.
      const escapes: string[] = [];
      for (const tr of taskResults) {
        if (tr.action.kind !== 'write') continue;
        if (tr.status === 'BLOCKED') continue; // blocked writes never happened
        for (const target of tr.action.targets) {
          const nt = normalize(target);
          if (!nt.startsWith(root)) {
            escapes.push(`${tr.task_id}: ${target}`);
          }
        }
      }
      const pass = escapes.length === 0;
      return {
        at_id: at.id,
        name: at.name,
        result: (pass ? 'PASS' : 'FAIL') as EvalResult,
        method: 'scope_containment' as const,
        detail: pass
          ? `All unblocked write targets within ${root}/`
          : `Escapes: ${escapes.join(', ')}`,
      };
    }
    return {
      at_id: at.id,
      name: at.name,
      result: 'UNEVALUATED' as EvalResult,
      method: 'unevaluated' as const,
      detail: 'No mechanical checker applies in v0.1',
    };
  });
}

// ============================================================
// Behavioral lock reports
// ============================================================

function buildBehavioralReports(
  packet: ParsedPacket,
  gateResults: GateResult[],
  atResults: AcceptanceTestResult[],
): BehavioralLockReport[] {
  const atById = new Map(atResults.map(a => [a.at_id, a]));
  const gateById = new Map(gateResults.map(g => [g.gate_id, g]));

  return packet.locks
    .filter(l => l.type === 'behavioral')
    .map(lock => {
      for (const ref of lock.paired_with ?? []) {
        const at = atById.get(ref);
        if (at && at.result !== 'UNEVALUATED') {
          return {
            lock_id: lock.id, rule: lock.rule,
            paired_with: lock.paired_with ?? [],
            verified_by: 'acceptance_test' as const,
            result: at.result,
          };
        }
        const gate = gateById.get(ref);
        if (gate && gate.result !== 'UNEVALUATED') {
          return {
            lock_id: lock.id, rule: lock.rule,
            paired_with: lock.paired_with ?? [],
            verified_by: 'gate' as const,
            result: gate.result,
          };
        }
      }
      return {
        lock_id: lock.id, rule: lock.rule,
        paired_with: lock.paired_with ?? [],
        verified_by: 'unevaluated' as const,
        result: 'UNEVALUATED' as EvalResult,
      };
    });
}

// ============================================================
// Main orchestration
// ============================================================

function compactTimestamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Governed execution of a parsed packet (v0.1: simulation mode).
 *
 * PROMISES:
 * - Pure wrt the filesystem: reads nothing, writes nothing.
 * - Deterministic given (packet, options.actions, options.now).
 * - Every task appears in exactly one TaskResult.
 * - Every runtime_enforced pattern match appears as a BlockEvent.
 * - receipt.hashes computed per XAS-CANON-1.
 *
 * PRECONDITION: caller has run validate() with valid:true. govern() does NOT
 * re-validate and must not import validator.ts.
 *
 * THROWS GovernanceError: NO_META, NO_EXECUTION_PLAN, DEPENDENCY_CYCLE,
 * UNKNOWN_DEPENDENCY.
 */
export function govern(packet: ParsedPacket, options?: GovernOptions): GovernanceResult {
  if (!packet.meta) {
    throw new GovernanceError('NO_META', 'Packet has no asl::META block');
  }
  if (!packet.executionPlan || packet.executionPlan.tasks.length === 0) {
    throw new GovernanceError('NO_EXECUTION_PLAN', 'Packet has no execution plan');
  }

  const now = options?.now ?? (() => new Date());
  const startedAt = now();
  const warnings: string[] = [];

  const forbidden = buildForbiddenSet(packet);
  const actionList = options?.actions ?? deriveActions(packet);
  const actionByTask = new Map(actionList.map(a => [a.task_id, a]));

  const ordered = topoSort(packet.executionPlan.tasks);

  // ── Phase 1: task simulation ──────────────────────────────
  const taskResults: TaskResult[] = [];
  const resultById = new Map<string, TaskResult>();
  const blockEvents: BlockEvent[] = [];

  for (const task of ordered) {
    const action: Action = actionByTask.get(task.id) ?? {
      task_id: task.id, kind: 'assert', targets: [],
      description: task.description, source: 'extracted',
    };

    // 1.1 dependency check
    const failedDep = task.depends_on.find(dep => {
      const r = resultById.get(dep);
      return !r || r.status !== 'COMPLETE';
    });

    let result: TaskResult;
    if (failedDep) {
      if (task.on_dependency_fail === 'SKIP') {
        result = {
          task_id: task.id, status: 'SKIPPED', required: task.required,
          action, evidence_type: task.evidence_type, evidence_mode: 'simulated',
          blocked_by: [],
          note: `skipped: dependency ${failedDep} not COMPLETE`,
        };
      } else {
        // HALT, or RETRY (deps can't change in simulation → exhausted → HALT)
        result = {
          task_id: task.id, status: 'BLOCKED', required: task.required,
          action, evidence_type: task.evidence_type, evidence_mode: 'simulated',
          blocked_by: [],
          note: task.on_dependency_fail === 'RETRY'
            ? `blocked: dependency ${failedDep} not COMPLETE (retries exhausted in simulation)`
            : `blocked: dependency ${failedDep} not COMPLETE`,
        };
      }
    } else {
      // 1.2 lock check
      const evaluation = evaluateAction(action, forbidden, packet.locks);
      if (evaluation.blocked) {
        const ts = now().toISOString();
        for (const e of evaluation.events) {
          blockEvents.push({ ...e, timestamp: ts });
          if (e.attribution === 'packet_level') {
            warnings.push(
              `Block on ${e.task_id} attributed packet-level (no lock rule names "${e.matched_pattern}")`);
          }
        }
        const lockIds = unique(evaluation.events.map(e => e.lock_id));
        result = {
          task_id: task.id, status: 'BLOCKED', required: task.required,
          action, evidence_type: task.evidence_type, evidence_mode: 'simulated',
          blocked_by: lockIds,
          note: `${lockIds.join(', ')} fired: ${evaluation.events[0].matched_target} matched "${evaluation.events[0].matched_pattern}"`,
        };
      } else {
        // 1.3 simulated complete
        result = {
          task_id: task.id, status: 'COMPLETE', required: task.required,
          action, evidence_type: task.evidence_type, evidence_mode: 'simulated',
          blocked_by: [],
          note: task.expected_result || 'simulated complete',
        };
      }
    }
    taskResults.push(result);
    resultById.set(task.id, result);
  }

  // ── Phase 2: gates ────────────────────────────────────────
  const gateResults = evaluateGates(packet, resultById);
  for (const g of gateResults) {
    if (g.result === 'UNEVALUATED') {
      warnings.push(`${g.gate_id} UNEVALUATED: condition not mechanically checkable in v0.1`);
    }
  }

  // ── Phase 3: acceptance tests ─────────────────────────────
  const atResults = evaluateAcceptanceTests(packet, taskResults);
  for (const a of atResults) {
    if (a.result === 'UNEVALUATED') {
      warnings.push(`${a.at_id} UNEVALUATED: no mechanical checker applies in v0.1`);
    }
  }

  // ── Phase 4: behavioral lock reports ──────────────────────
  const behavioralReports = buildBehavioralReports(packet, gateResults, atResults);

  // ── Phase 5: verdict ──────────────────────────────────────
  const requiredBad = taskResults.some(t =>
    t.required && (t.status === 'BLOCKED' || t.status === 'FAILED' || t.status === 'SKIPPED'));
  const gateHalt = gateResults.some(g => g.result === 'FAIL' && g.on_fail === 'HALT');
  const atFail = atResults.some(a => a.result === 'FAIL');

  // ── Phase 6: ledger cross-check ───────────────────────────
  const declared = packet.verificationLedger ?? null;
  const observed = {
    task_count: taskResults.length,
    gate_count: gateResults.length,
    lock_count: packet.locks.length,
    acceptance_test_count: atResults.length,
    receipt_count: 1 as const,
  };
  const ledgerMatches = declared !== null &&
    declared.required_task_count === observed.task_count &&
    declared.required_gate_count === observed.gate_count &&
    declared.required_lock_count === observed.lock_count &&
    declared.required_acceptance_test_count === observed.acceptance_test_count &&
    declared.required_receipt_count === observed.receipt_count;
  const ledgerCrosscheck: LedgerCrossCheck = {
    declared, observed, matches: ledgerMatches,
  };

  const verdict: GovernanceVerdict =
    (requiredBad || gateHalt || atFail || !ledgerMatches) ? 'FAIL' : 'PASS';

  const hasWarnSignals = blockEvents.length > 0 || warnings.length > 0;
  const receiptVerdict: GovernanceReceipt['verdict'] =
    verdict === 'FAIL' ? 'blocked' : hasWarnSignals ? 'warned' : 'allowed';

  // ── Phase 7: receipt assembly ─────────────────────────────
  const finishedAt = now();
  const receipt: GovernanceReceipt = {
    receipt_version: 'signet-receipt-v1',
    receipt_id: `rcpt_${packet.meta.id}_${compactTimestamp(startedAt)}`,
    parent_receipt_id: options?.parent_receipt_id ?? null,
    packet: {
      id: packet.meta.id,
      sha256: sha256text(packet.raw),
      tier: packet.meta.packet_tier,
      type: packet.meta.type,
    },
    action: 'governed_execution',
    verdict: receiptVerdict,
    outcome: verdict === 'PASS' ? 'passed' : 'failed',
    summary: {
      tasks_total: taskResults.length,
      tasks_complete: taskResults.filter(t => t.status === 'COMPLETE').length,
      tasks_blocked: taskResults.filter(t => t.status === 'BLOCKED').length,
      tasks_skipped: taskResults.filter(t => t.status === 'SKIPPED').length,
      tasks_failed: taskResults.filter(t => t.status === 'FAILED').length,
      blocks_recorded: blockEvents.length,
      gates_passed: gateResults.filter(g => g.result === 'PASS').length,
      gates_failed: gateResults.filter(g => g.result === 'FAIL').length,
      gates_unevaluated: gateResults.filter(g => g.result === 'UNEVALUATED').length,
      ats_passed: atResults.filter(a => a.result === 'PASS').length,
      ats_failed: atResults.filter(a => a.result === 'FAIL').length,
      ats_unevaluated: atResults.filter(a => a.result === 'UNEVALUATED').length,
    },
    task_results: taskResults,
    block_events: blockEvents,
    gate_results: gateResults,
    behavioral_reports: behavioralReports,
    acceptance_results: atResults,
    ledger_crosscheck: ledgerCrosscheck,
    timestamps: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
    },
    canon: 'XAS-CANON-1',
    hashes: { sha256: '', h10: '' },
    signature: null,
  };

  receipt.hashes = {
    sha256: receiptSha256(receipt),
    h10: h10(receipt),
  };

  return { verdict, packet_id: packet.meta.id, receipt, warnings };
}
