// Normalized event ledger: load, validate, order (04, 05).
import { readFile } from 'node:fs/promises';
import { createValidator, loadJsonFile, ValidationIssue } from './schema.js';
import type { AtlasEvent, BranchId } from './types.js';

export class LedgerLoadError extends Error {
  readonly issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super(`ledger rejected: ${issues.length} issue(s); first at line ${issues[0]?.pointer}: ${issues[0]?.message}`);
    this.name = 'LedgerLoadError';
    this.issues = issues;
  }
}

/** Reduction-order rank per 04-time.md. */
export const TYPE_RANK: Record<string, number> = {
  EQUIPMENT_STATE_CHANGED: 0,
  MEASUREMENT_RECORDED: 0,
  EMPLOYEE_CLOCKED_IN: 1,
  ASSIGNMENT_CHANGED: 1,
  HUMAN_REPORT: 2,
  WORK_COMPLETED: 3,
  ORDER_READY: 4,
  ORDER_COMPLETED: 5,
  ORDER_CREATED: 6,
  WORK_QUEUED: 7,
  WORK_STARTED: 8,
};

export type OrderKey = [number, number, string, string];

/** Total order within a branch: (t, rank(type), subject, data.work_id ?? ''). */
export function reductionKey(e: Pick<AtlasEvent, 't' | 'type' | 'subject' | 'data'>): OrderKey {
  const rank = TYPE_RANK[e.type];
  if (rank === undefined) throw new Error(`unknown event type '${e.type}' in reduction order`);
  return [e.t, rank, e.subject, (e.data.work_id as string | undefined) ?? ''];
}

export function compareKeys(a: OrderKey, b: OrderKey): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

export function sortByReductionOrder(events: AtlasEvent[]): AtlasEvent[] {
  return [...events].sort((a, b) => compareKeys(reductionKey(a), reductionKey(b)));
}

export interface Ledger {
  branch: BranchId;
  events: AtlasEvent[]; // in reduction order
  inputOrderMatched: boolean; // committed file order already equaled reduction order
  count: number;
}

export interface LedgerHeader {
  atlas_schema: string;
  world_sha256?: string;
  [k: string]: unknown;
}

function isHeaderLine(obj: unknown): obj is LedgerHeader {
  return (
    typeof obj === 'object' && obj !== null &&
    (obj as Record<string, unknown>).atlas_schema === 'atlas-ledger/0.1' &&
    !('seq' in (obj as Record<string, unknown>))
  );
}

export async function loadLedger(ledgerPath: string, schemaPath: string): Promise<Ledger> {
  const text = await readFile(ledgerPath, 'utf8');
  const rawLines = text.split('\n');
  const lines = rawLines.filter((l) => l.trim().length > 0);
  const schemaDoc = await loadJsonFile(schemaPath);
  const validate = createValidator(schemaDoc as Record<string, any>).validate;

  const issues: ValidationIssue[] = [];
  const fail = (line: number, message: string) => issues.push({ pointer: `line ${line}`, message });

  let header: LedgerHeader | null = null;
  const events: AtlasEvent[] = [];
  let lineNo = 0;
  for (const line of lines) {
    lineNo++;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      fail(lineNo, 'line is not valid JSON');
      continue;
    }
    if (isHeaderLine(obj)) {
      if (header) fail(lineNo, 'duplicate ledger header line');
      header = obj;
      continue;
    }
    const lineIssues = validate(obj);
    for (const i of lineIssues) fail(lineNo, `${i.pointer || '(root)'}: ${i.message}`);
    if (lineIssues.length === 0) events.push(obj as AtlasEvent);
  }

  // seq discipline: starts at 1, increments by 1, in file order
  for (let i = 0; i < events.length; i++) {
    if (events[i].seq !== i + 1) {
      fail(i + 1, `seq out of order: expected ${i + 1}, found ${events[i].seq}`);
    }
  }
  // single branch per ledger file
  const branches = new Set(events.map((e) => e.branch));
  if (branches.size > 1) fail(0, `ledger mixes branches: ${[...branches].join(', ')}`);
  const branch = branches.size === 1 ? [...branches][0] : 'history:unknown';

  // claim-class rules (05): history ledgers carry no simulated events;
  // derived/inferred claims require derived_from.
  events.forEach((e, i) => {
    const cc = e.provenance.claim_class;
    if (branch.startsWith('history:') && cc === 'simulated') {
      fail(i + 1, `history ledger contains simulated event ${e.event_id}`);
    }
    if ((cc === 'derived' || cc === 'inferred') && !e.provenance.derived_from?.length) {
      fail(i + 1, `event ${e.event_id} with claim_class '${cc}' is missing derived_from`);
    }
  });

  if (issues.length > 0) throw new LedgerLoadError(issues);

  // reduction order: the reducer sorts by key, never by seq (04). Record whether
  // the committed file order already matched.
  const sorted = sortByReductionOrder(events);
  const inputOrderMatched = sorted.every((e, i) => e.seq === events[i].seq);

  return { branch, events: sorted, inputOrderMatched, count: sorted.length };
}

/** Map provenance.record_id -> event, for derived_from / evidence resolution. */
export function indexByRecordId(events: AtlasEvent[]): Map<string, AtlasEvent> {
  const m = new Map<string, AtlasEvent>();
  for (const e of events) m.set(e.provenance.record_id, e);
  return m;
}

export function indexByEventId(events: AtlasEvent[]): Map<string, AtlasEvent> {
  const m = new Map<string, AtlasEvent>();
  for (const e of events) m.set(e.event_id, e);
  return m;
}
