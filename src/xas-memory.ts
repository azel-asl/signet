// Signet v0.2 — XAS-MEM (minimal local run memory)
// OPEN MODULE — Apache 2.0.
//
// Records every `signet run` in a small local SQLite database so past
// runs become queryable context for future ones. This is deliberately
// minimal: 7 fields, no authority signing, no receipt chains, no
// compression, no lineage. Those belong to a future version.
//
// Imports: node:sqlite (built into Node >= 22.5), node:fs, node:path.
// Zero npm dependencies — consistent with the rest of the open core.
// node:sqlite is loaded via process.getBuiltinModule so bundlers/test
// runners that predate the builtin can still transform this file.

import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync as DatabaseSyncT } from 'node:sqlite';
import type { GovernanceReceipt } from './types.js';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

// ── Schema: exactly 7 fields (LOCK_005 of signet-v02-build-001) ──

export interface XasMemRow {
  handle: string;           // <packet_id>-<YYYYMMDD>-<4 chars>
  packet_id: string;
  receipt_path: string;
  verdict: string;          // receipt verdict: allowed | warned | blocked
  alignment_score: number;  // 0–10, see scoreFromReceipt()
  lessons: string;          // blocks fired, UNEVALUATED counts, drift notes
  created_at: string;       // ISO 8601
}

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS xas_mem (
    handle          TEXT PRIMARY KEY,
    packet_id       TEXT NOT NULL,
    receipt_path    TEXT NOT NULL,
    verdict         TEXT NOT NULL,
    alignment_score REAL NOT NULL,
    lessons         TEXT NOT NULL,
    created_at      TEXT NOT NULL
  );
`;

/** Data directory: SIGNET_DATA_DIR env override, else ./data under cwd. */
function dataDir(): string {
  return process.env['SIGNET_DATA_DIR'] ?? join(process.cwd(), 'data');
}

function openDb(): DatabaseSyncT {
  const dir = dataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'xas_mem.db'));
  db.exec(CREATE_SQL);
  return db;
}

function generateHandle(packetId: string): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const shortId = Math.random().toString(36).slice(2, 6);
  return `${packetId}-${date}-${shortId}`;
}

// ── Alignment score ──────────────────────────────────────────
// Per packet contract: (gates passed + ATs passed) / (total gates + ATs) × 10.
// UNEVALUATED items count toward the denominator — a low score honestly
// reflects that simulation could not mechanically evaluate the packet's
// checks, which is itself useful dogfood signal.

export function scoreFromReceipt(receipt: GovernanceReceipt): number {
  const gates = receipt.gate_results ?? [];
  const ats = receipt.acceptance_results ?? [];
  const total = gates.length + ats.length;
  if (total === 0) return receipt.verdict === 'allowed' ? 10 : 0;
  const passed =
    gates.filter(g => g.result === 'PASS').length +
    ats.filter(a => a.result === 'PASS').length;
  return Math.round((passed / total) * 100) / 10; // one decimal place
}

/** Extract honest lessons from the receipt: blocks, unevaluated checks. */
export function lessonsFromReceipt(receipt: GovernanceReceipt): string {
  const parts: string[] = [];
  const blocks = receipt.block_events ?? [];
  if (blocks.length > 0) {
    const locks = [...new Set(blocks.map(b => `${b.lock_id} ("${b.matched_pattern}")`))];
    parts.push(`${blocks.length} block(s) fired: ${locks.join(', ')}`);
  }
  const uneval =
    (receipt.gate_results ?? []).filter(g => g.result === 'UNEVALUATED').length +
    (receipt.acceptance_results ?? []).filter(a => a.result === 'UNEVALUATED').length;
  if (uneval > 0) {
    parts.push(`${uneval} check(s) UNEVALUATED in simulation — consider mechanically checkable conditions`);
  }
  const blocked = (receipt.task_results ?? []).filter(t => t.status === 'BLOCKED');
  if (blocked.length > 0) {
    parts.push(`blocked tasks: ${blocked.map(t => t.task_id).join(', ')}`);
  }
  return parts.length > 0 ? parts.join('; ') : 'clean run — no blocks, all checks evaluated';
}

// ── Record / query ───────────────────────────────────────────

export function recordRun(receipt: GovernanceReceipt, receiptPath: string): XasMemRow {
  const row: XasMemRow = {
    handle: generateHandle(receipt.packet.id),
    packet_id: receipt.packet.id,
    receipt_path: receiptPath,
    verdict: receipt.verdict,
    alignment_score: scoreFromReceipt(receipt),
    lessons: lessonsFromReceipt(receipt),
    created_at: new Date().toISOString(),
  };
  const db = openDb();
  try {
    db.prepare(`
      INSERT OR REPLACE INTO xas_mem
        (handle, packet_id, receipt_path, verdict, alignment_score, lessons, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(row.handle, row.packet_id, row.receipt_path, row.verdict,
           row.alignment_score, row.lessons, row.created_at);
  } finally {
    db.close();
  }
  return row;
}

/** Prior runs of the same packet, newest first. */
export function priorRuns(packetId: string, limit = 3): XasMemRow[] {
  const db = openDb();
  try {
    return db.prepare(`
      SELECT handle, packet_id, receipt_path, verdict, alignment_score, lessons, created_at
      FROM xas_mem WHERE packet_id = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(packetId, limit) as unknown as XasMemRow[];
  } finally {
    db.close();
  }
}

/** Most recent runs across all packets, newest first. */
export function recentRuns(limit = 10): XasMemRow[] {
  const db = openDb();
  try {
    return db.prepare(`
      SELECT handle, packet_id, receipt_path, verdict, alignment_score, lessons, created_at
      FROM xas_mem ORDER BY created_at DESC LIMIT ?
    `).all(limit) as unknown as XasMemRow[];
  } finally {
    db.close();
  }
}

// ── SIGNET-USAGE.md auto-append ──────────────────────────────
// The markdown log is the human-readable twin of xas_mem. Both are
// written by the CLI after every run.

export function usageEntry(row: XasMemRow, opts?: { significance?: string; timeSpent?: string; notes?: string }): string {
  const date = row.created_at.slice(0, 10);
  return [
    `### ${date} — ${row.packet_id}`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| Date | ${date} |`,
    `| Packet name | ${row.packet_id} |`,
    `| Action | governed run (simulation) |`,
    `| Result | ${row.verdict} |`,
    `| Alignment score | ${row.alignment_score}/10 |`,
    `| Significance | ${opts?.significance ?? '_fill in: why this run mattered_'} |`,
    `| Time spent | ${opts?.timeSpent ?? 'simulation (<1s governance pass)'} |`,
    `| Receipt path | ${row.receipt_path} |`,
    `| Notes / drift / blockers | ${opts?.notes ?? row.lessons} |`,
    ``,
  ].join('\n');
}
