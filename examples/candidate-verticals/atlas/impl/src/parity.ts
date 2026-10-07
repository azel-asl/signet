// Expected-vs-actual comparison with first-differing-path reporting.
// A mismatch is reported as data, never hidden behind a generic failure.
export interface Diff {
  path: string;
  kind: 'missing_expected' | 'missing_actual' | 'value_mismatch' | 'length_mismatch' | 'type_mismatch';
  expected?: unknown;
  actual?: unknown;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function summarize(v: unknown): unknown {
  if (typeof v === 'string' && v.length > 120) return v.slice(0, 120) + '…';
  if (isObj(v)) return `{object with keys: ${Object.keys(v).join(',')}}`;
  if (Array.isArray(v)) return `[array length ${v.length}]`;
  return v;
}

export function diffObjects(expected: unknown, actual: unknown, path = '$', diffs: Diff[] = [], max = 25): Diff[] {
  if (diffs.length >= max) return diffs;
  if (expected === actual) return diffs;
  if (typeof expected === 'number' && typeof actual === 'number' && Number.isNaN(expected) && Number.isNaN(actual)) {
    return diffs;
  }
  if (isObj(expected) && isObj(actual)) {
    for (const k of Object.keys(expected)) {
      if (!(k in actual)) {
        diffs.push({ path: `${path}.${k}`, kind: 'missing_actual', expected: summarize(expected[k]) });
      } else {
        diffObjects(expected[k], actual[k], `${path}.${k}`, diffs, max);
      }
      if (diffs.length >= max) return diffs;
    }
    for (const k of Object.keys(actual)) {
      if (!(k in expected)) {
        diffs.push({ path: `${path}.${k}`, kind: 'missing_expected', actual: summarize(actual[k]) });
        if (diffs.length >= max) return diffs;
      }
    }
    return diffs;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      diffs.push({ path, kind: 'length_mismatch', expected: expected.length, actual: actual.length });
      // still compare the shared prefix so the first differing element is visible
    }
    const n = Math.min(expected.length, actual.length);
    for (let i = 0; i < n; i++) {
      diffObjects(expected[i], actual[i], `${path}[${i}]`, diffs, max);
      if (diffs.length >= max) return diffs;
    }
    return diffs;
  }
  if (typeof expected !== typeof actual) {
    diffs.push({ path, kind: 'type_mismatch', expected: summarize(expected), actual: summarize(actual) });
    return diffs;
  }
  diffs.push({ path, kind: 'value_mismatch', expected: summarize(expected), actual: summarize(actual) });
  return diffs;
}

export interface SnapshotComparison {
  match: boolean;
  expectedHash: string;
  actualHash: string;
  hashMatch: boolean;
  diffs: Diff[];
  sections: Record<string, { match: boolean; diffs: Diff[] }>;
}

/** Compare an expected fixture snapshot against a runtime-built snapshot. */
export function compareSnapshots(expected: Record<string, any>, actual: Record<string, any>): SnapshotComparison {
  const sections: Record<string, { match: boolean; diffs: Diff[] }> = {};
  for (const key of ['state', 'metrics', 'diagnosis', 'evidence_refs']) {
    const d = diffObjects(expected[key], actual[key], `$${key === 'state' ? '' : '.'}${key}`);
    sections[key] = { match: d.length === 0, diffs: d };
  }
  const expectedHash = expected.state_hash as string;
  const actualHash = actual.state_hash as string;
  const hashMatch = expectedHash === actualHash;
  const allDiffs = Object.values(sections).flatMap((s) => s.diffs);
  return {
    match: hashMatch && allDiffs.length === 0,
    expectedHash,
    actualHash,
    hashMatch,
    diffs: allDiffs,
    sections,
  };
}
