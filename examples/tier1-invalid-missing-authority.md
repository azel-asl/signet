# Tier 1 Invalid — Missing AUTHORITY block

# EXPECTED VALIDATION RESULT: FAIL
# Expected errors:
#   BLOCK_002 — Missing required GCL block: ::AUTHORITY

asl::META
id = "tier1-invalid-missing-authority-001"
version = "ASL Lite + GCL Packet Standard v1.5.1"
packet_tier = 1
type = "review"
owner = "ASL Labs"
status = "active"
::END

asl::ROLE
name = "Code Reviewer"
description = "Review a pull request."
::END

asl::SCOPE
included = ["diff review"]
excluded = ["auto-merging"]
::END

# NOTE: ::AUTHORITY block is intentionally absent to trigger BLOCK_002 error

::PERMISSIONS

allow:
  - action = "read_project_files"
    scope = "project root only"
    enforced_by = "agent_receipt"

::END
