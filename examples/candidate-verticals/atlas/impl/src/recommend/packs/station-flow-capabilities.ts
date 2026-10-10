// ATLAS M5: station-flow pack capability declarations.
// Domain knowledge (station skill convention, rule kinds) lives here and in
// the world, never in impl/src/recommend/core. The capability fires on typed
// M4 diagnosis claims; it names no entity ids, station names, or rule-id
// literals. Rule references resolve by rule KIND (19 §C, §Y).

export interface PackCapability {
  id: string; // cap:<name>
  // The typed diagnosis condition this capability fires on.
  firesOn: {
    claimKind: 'capacity_limit';
    claimClass: 'STAFF' | 'EQUIPMENT' | 'CO_BINDING' | 'DEMAND';
    register: 'observed';
  };
  interventionKind: 'reassign_resource';
}

export const STATION_FLOW_CAPABILITIES: PackCapability[] = [
  {
    id: 'cap:reassign_to_staff_bound_station',
    firesOn: { claimKind: 'capacity_limit', claimClass: 'STAFF', register: 'observed' },
    interventionKind: 'reassign_resource',
  },
];

export const STATION_FLOW_PACK_ID = 'station-flow';
export const STATION_FLOW_PACK_VERSION = '0.1';

// Rule kinds the pack resolves by kind (never by literal rule id).
export const RULE_KINDS = {
  capacityCheck: 'capacity_check',
  overload: 'overload',
  staffing: 'staffing',
} as const;
