// ATLAS M4 DIAGNOSE: temporal onset scanning per 18 §G.
// Onset: scan sample points over the branch log up to t, using the settled
// state at the end of each instant with events (CCR-004 rule), and take the
// last instant the condition became true without an exit since.
import type { AtlasEvent, World } from '../types.js';

/**
 * Find the onset time of a condition.
 * @param world The world definition.
 * @param ledger The branch ledger (sorted by t).
 * @param t The diagnosis time.
 * @param isActiveAt Function that returns true if the condition holds at a given time.
 * @returns The onset t, or null if the condition was active from the start or never.
 */
export function findOnset(
  ledger: AtlasEvent[],
  t: number,
  isActiveAt: (sampleT: number) => boolean,
): number | null {
  // Collect sample points: end of each instant with events, up to t.
  const instants: number[] = [];
  for (const e of ledger) {
    if (e.t > t) break;
    if (instants.length === 0 || instants[instants.length - 1] !== e.t) {
      instants.push(e.t);
    }
  }

  // Scan backwards from t to find when the condition became true.
  let onset: number | null = null;
  let wasActive = isActiveAt(t);

  if (!wasActive) return null;

  // Walk backwards to find the last transition from inactive to active.
  for (let i = instants.length - 1; i >= 0; i--) {
    const sampleT = instants[i];
    if (sampleT > t) continue;
    const active = isActiveAt(sampleT);
    if (!active) {
      // Found the transition: onset is the next instant after this one.
      onset = instants[i + 1] ?? sampleT;
      break;
    }
    onset = sampleT;
  }

  return onset;
}

/**
 * Check if onset falls in the parent prefix (before branch point).
 * CCR-005 C5: true iff onset_t < tB, or onset_t = tB and the condition already
 * holds in the parent-only state at tB. Otherwise false.
 * @param onsetT The onset time.
 * @param branchPointT The branch point time (null for observed).
 * @param holdsInParentAtTB Whether the condition holds in the parent-only state at tB.
 */
export function isOnsetInParent(
  onsetT: number | null,
  branchPointT: number | null,
  holdsInParentAtTB: boolean = false,
): boolean {
  if (onsetT === null || branchPointT === null) return false;
  if (onsetT < branchPointT) return true;
  if (onsetT === branchPointT && holdsInParentAtTB) return true;
  return false;
}
