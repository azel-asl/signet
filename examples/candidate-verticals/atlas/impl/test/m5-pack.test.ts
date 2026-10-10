// ATLAS M5 T-PACK: pack has no entity ids, station names, or rule-id literals;
// rule lookup by kind.
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { STATION_FLOW_CAPABILITIES, RULE_KINDS } from '../src/recommend/packs/station-flow-capabilities.js';

describe('T-PACK', () => {
  it('capability declares no entity ids or station names', async () => {
    const src = await readFile(new URL('../src/recommend/packs/station-flow-capabilities.ts', import.meta.url), 'utf8');
    // No emp_*, st_*, or station names.
    expect(src).not.toMatch(/emp_\d/);
    expect(src).not.toMatch(/st_fry|st_prep|st_grill|st_pass/);
    expect(src).not.toMatch(/['"]Fry['"]|['"]Prep['"]/);
    // No rule-id literals R01..R99.
    expect(src).not.toMatch(/\bR\d{2}\b/);
  });

  it('capability fires on typed claim (kind + class), not on ids', () => {
    const cap = STATION_FLOW_CAPABILITIES[0];
    expect(cap.id).toBe('cap:reassign_to_staff_bound_station');
    expect(cap.firesOn.claimKind).toBe('capacity_limit');
    expect(cap.firesOn.claimClass).toBe('STAFF');
    expect(cap.firesOn.register).toBe('observed');
  });

  it('rule kinds are kind-based, not literal ids', () => {
    expect(Object.values(RULE_KINDS).every((k) => !/^R\d{2}$/.test(k))).toBe(true);
  });
});
