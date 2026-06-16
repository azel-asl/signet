import { describe, it, expect } from 'vitest';
import { parseDriftMarkers, parsePacket } from '../src/parser.js';
import { validate } from '../src/validator.js';
import { validateDrift } from '../src/drift.js';

// ── AT_007: Drift marker validation ─────────────────────────

describe('drift marker validation (AT_007)', () => {
  it('parses valid COMPLETE markers', () => {
    const raw = '[TASK_001: COMPLETE | evidence_type: file_write | evidence_ref: src/index.ts created]\n';
    const markers = parseDriftMarkers(raw);
    expect(markers).toHaveLength(1);
    expect(markers[0].status).toBe('COMPLETE');
    expect(markers[0].evidence_type).toBe('file_write');
  });

  it('rejects invalid status in marker', () => {
    const raw = `
asl::META
id = "drift-test"
version = "v1"
packet_tier = 1
type = "review"
owner = "Test"
status = "active"
::END
asl::ROLE
name = "R"
description = "D"
::END
asl::SCOPE
included = []
excluded = []
::END
::AUTHORITY
runtime_mode = "x"
::END
::PERMISSIONS
allow:
  - action = "read"
    scope = "all"
    enforced_by = "agent_receipt"
::END

[TASK_001: INVALID_STATUS | evidence_type: file_write | evidence_ref: test]
`;
    const packet = parsePacket(raw);
    const result = validate(packet);
    validateDrift(packet, result);
    expect(result.issues.some(i => i.code === 'DRIFT_003')).toBe(true);
  });

  it('rejects COMPLETE marker with empty evidence_ref', () => {
    const raw = `
asl::META
id = "drift-test-2"
version = "v1"
packet_tier = 1
type = "review"
owner = "Test"
status = "active"
::END
asl::ROLE
name = "R"
description = "D"
::END
asl::SCOPE
included = []
excluded = []
::END
::AUTHORITY
runtime_mode = "x"
::END
::PERMISSIONS
allow:
  - action = "read"
    scope = "all"
    enforced_by = "agent_receipt"
::END

[TASK_001: COMPLETE | evidence_type: file_write | evidence_ref: ]
`;
    const packet = parsePacket(raw);
    const result = validate(packet);
    validateDrift(packet, result);
    expect(result.issues.some(i => i.code === 'DRIFT_005')).toBe(true);
  });

  it('rejects invalid evidence_type in marker', () => {
    const raw = `
asl::META
id = "drift-test-3"
version = "v1"
packet_tier = 1
type = "review"
owner = "Test"
status = "active"
::END
asl::ROLE
name = "R"
description = "D"
::END
asl::SCOPE
included = []
excluded = []
::END
::AUTHORITY
runtime_mode = "x"
::END
::PERMISSIONS
allow:
  - action = "read"
    scope = "all"
    enforced_by = "agent_receipt"
::END

[TASK_001: COMPLETE | evidence_type: invalid_type | evidence_ref: some ref]
`;
    const packet = parsePacket(raw);
    const result = validate(packet);
    validateDrift(packet, result);
    expect(result.issues.some(i => i.code === 'DRIFT_004')).toBe(true);
  });

  it('warns on agent_assertion markers (must be in drift report)', () => {
    const raw = `
asl::META
id = "drift-test-4"
version = "v1"
packet_tier = 1
type = "review"
owner = "Test"
status = "active"
::END
asl::ROLE
name = "R"
description = "D"
::END
asl::SCOPE
included = []
excluded = []
::END
::AUTHORITY
runtime_mode = "x"
::END
::PERMISSIONS
allow:
  - action = "read"
    scope = "all"
    enforced_by = "agent_receipt"
::END

[TASK_001: COMPLETE | evidence_type: agent_assertion | evidence_ref: Claim: done | Reason: tested]
`;
    const packet = parsePacket(raw);
    const result = validate(packet);
    validateDrift(packet, result);
    const warning = result.issues.find(i => i.code === 'DRIFT_010');
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
  });

  it('detects duplicate drift marker IDs', () => {
    const raw = `
asl::META
id = "drift-test-5"
version = "v1"
packet_tier = 1
type = "review"
owner = "Test"
status = "active"
::END
asl::ROLE
name = "R"
description = "D"
::END
asl::SCOPE
included = []
excluded = []
::END
::AUTHORITY
runtime_mode = "x"
::END
::PERMISSIONS
allow:
  - action = "read"
    scope = "all"
    enforced_by = "agent_receipt"
::END

[TASK_001: COMPLETE | evidence_type: file_write | evidence_ref: first]
[TASK_001: COMPLETE | evidence_type: file_write | evidence_ref: duplicate]
`;
    const packet = parsePacket(raw);
    const result = validate(packet);
    validateDrift(packet, result);
    expect(result.issues.some(i => i.code === 'DRIFT_002')).toBe(true);
  });
});
