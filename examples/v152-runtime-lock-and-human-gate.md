# ASL Lite + GCL v1.5.2 — Tier 1 example
# Demonstrates the four hardened mechanisms:
#   - honest enforced_by terminology (GOV_001 clean)
#   - runtime_enforced lock backed by external evidence (LOCK_007/008 clean)
#   - human gate with approval_id (GATE_005 clean)
#   - forbidden_outputs declared (enforced at receipt time, REC_018)

asl::META
id = "v152-example"
version = "ASL Lite + GCL Packet Standard v1.5.2"
packet_tier = 1
type = "review"
owner = "ASL Labs"
status = "active"
::END

asl::ROLE
name = "Config Reviewer"
description = "Review a config directory and report findings. Read-only."
::END

asl::SCOPE
included = ["./config"]
excluded = ["./secrets", "production", "external APIs"]
::END

asl::OUTPUT_CONTRACT
required_outputs = ["./report.md"]
forbidden_outputs = ["credentials", "secrets", "tokens", "files outside ./report.md"]
completion_phrase = "Config review complete."
::END

::AUTHORITY
runtime_mode = "governed_review"
receipt_required = true
::END

::PERMISSIONS
allow:
  - action = "read_config"
    scope = "./config"
    enforced_by = "structurally_validated"
deny:
  - action = "write_secrets"
    scope = "all"
    enforced_by = "requires_external_evidence"
::END

::LOCKS
LOCK_001:
  rule = "Do not write any file except ./report.md"
  type = "behavioral"
  enforced_by = "attested_by"
  paired_with = ["AT_001"]

LOCK_002:
  rule = "Do not call external network services"
  type = "runtime_enforced"
  enforced_by = "runtime_enforced_external"
  evidence_type = "command_output"
::END

::GATES
GATE_001:
  condition = "Human confirmation before publishing the report"
  evaluator = "human"
  evidence_type = "human_confirmation"
  on_fail = "HALT"
  approval_id = "APR_001"
::END

::ACCEPTANCE_TESTS
count = 1

AT_001:
  name = "No files written outside report"
  check = "Only ./report.md was created"
  pass_condition = "no files created outside ./report.md"
  evaluator = "agent"
  evidence_type = "acceptance_test"
  on_fail = "HALT"
::END
