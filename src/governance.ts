// ASL Packet Validator — Governance Enforcement (v1.5.2)
// Receipt-time enforcement for forbidden outputs and human-gate approvals.
// Reads produced artifacts; does NOT execute packets.

import { existsSync, readFileSync } from 'fs';
import type { ParsedPacket, DriftMarker, ValidationIssue, ApprovalRecord } from './types.js';
import { SECRET_PATTERNS } from './schemas.js';

function issue(
  severity: 'error' | 'warning' | 'info',
  code: string,
  message: string,
  location?: string
): ValidationIssue {
  return { severity, code, message, location };
}

function parseRefFields(raw: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const part of raw.split('|').map(p => p.trim())) {
    const idx = part.indexOf(':');
    if (idx !== -1) fields[part.slice(0, idx).trim().toLowerCase()] = part.slice(idx + 1).trim();
  }
  return fields;
}

// ── REC_018: Forbidden output enforcement ────────────────────
//
// Two checks, both against REAL produced artifacts (file_write/file_read
// evidence whose file exists at validation time):
//   1. Secret/credential content scan (always on — secrets are universally forbidden).
//   2. Forbidden-path scan — when forbidden_outputs declares path-like entries
//      (e.g. "credentials", "./secrets", "files outside ./output"), flag evidence
//      whose path matches.
//
// Returns true if clean.

export function scanForbiddenOutputs(
  packet: ParsedPacket,
  markers: DriftMarker[],
  issues: ValidationIssue[]
): boolean {
  let clean = true;
  const forbidden = packet.outputContract?.forbidden_outputs ?? [];

  // Path-like forbidden entries (anything that looks like a path fragment, not a prose category)
  const forbiddenPathFragments = forbidden
    .filter(f => /[\/.]/.test(f) || /^[a-z0-9_\-]+$/i.test(f))
    .map(f => f.toLowerCase());

  for (const m of markers) {
    if (m.evidence_type !== 'file_write' && m.evidence_type !== 'file_read') continue;
    if (!m.evidence_ref.includes(':')) continue;
    const path = parseRefFields(m.evidence_ref)['path'];
    if (!path) continue;

    // 1. Forbidden-path match
    const lowerPath = path.toLowerCase();
    for (const frag of forbiddenPathFragments) {
      // match obvious credential/secret keywords or declared path fragments
      if (
        (frag.includes('/') || frag.includes('.')) ? lowerPath.includes(frag)
        : /\b(credential|credentials|secret|secrets|token|tokens|key|keys|password)\b/.test(frag) &&
          new RegExp(`(^|[\\/_.-])${frag}([\\/_.-]|$)`).test(lowerPath)
      ) {
        issues.push(issue('error', 'REC_018',
          `Forbidden output: marker ${m.task_id} writes to "${path}", which matches declared ` +
          `forbidden_outputs entry "${frag}".`,
          m.task_id));
        clean = false;
      }
    }

    // 2. Secret content scan on existing produced files
    if (m.evidence_type === 'file_write' && existsSync(path)) {
      let content = '';
      try { content = readFileSync(path, 'utf-8'); } catch { continue; }
      for (const { name, re } of SECRET_PATTERNS) {
        if (re.test(content)) {
          issues.push(issue('error', 'REC_018',
            `Forbidden output: marker ${m.task_id} produced file "${path}" containing a ${name}. ` +
            `Secrets must never be written to produced artifacts.`,
            m.task_id));
          clean = false;
          break; // one hit per file is enough
        }
      }
    }
  }

  return clean;
}

// ── REC_019: Human-gate approval enforcement ─────────────────
//
// Replaces v1.5.1 free-text "Drift Report" grep. Every packet gate with
// evaluator = "human" must declare an approval_id (enforced at packet level by
// GATE_005). At receipt time, that approval_id must be backed by a SIGNED
// approval record:
//   [APPROVAL: <id> | approver: NAME | timestamp: TS | signature: SIG]
//
// Returns true if all human gates are properly approved.

export function checkHumanGateApprovals(
  packet: ParsedPacket,
  approvals: ApprovalRecord[],
  issues: ValidationIssue[]
): boolean {
  let ok = true;
  const humanGates = packet.gates.filter(g => (g.evaluator || '').trim().toLowerCase() === 'human');
  if (humanGates.length === 0) return true;

  const byId = new Map(approvals.map(a => [a.approval_id, a]));

  for (const g of humanGates) {
    const id = (g.approval_id || '').trim();
    if (!id) {
      // Packet-level GATE_005 already errored; restate at receipt time for completeness.
      issues.push(issue('error', 'REC_019',
        `Human gate ${g.id} has no approval_id — cannot verify approval. ` +
        `Free-text approval is not accepted.`,
        g.id));
      ok = false;
      continue;
    }
    const rec = byId.get(id);
    if (!rec) {
      issues.push(issue('error', 'REC_019',
        `Human gate ${g.id} requires approval_id "${id}" but no matching signed approval record ` +
        `was found in the receipt. Expected: [APPROVAL: ${id} | approver: ... | timestamp: ... | signature: ...].`,
        g.id));
      ok = false;
      continue;
    }
    if (!rec.signature || !rec.approver) {
      issues.push(issue('error', 'REC_019',
        `Human gate ${g.id}: approval record "${id}" is missing a signature/approver — ` +
        `unsigned approvals are rejected.`,
        g.id));
      ok = false;
    }
  }
  return ok;
}
