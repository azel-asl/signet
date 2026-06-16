# Tier 1 Valid — Review Packet

asl::META
id = "tier1-valid-review-001"
version = "ASL Lite + GCL Packet Standard v1.5.1"
packet_tier = 1
type = "review"
owner = "ASL Labs"
status = "active"
::END

asl::ROLE
name = "Code Reviewer"
description = "Review a pull request for correctness."
::END

asl::SCOPE
included = [
  "diff review",
  "bug detection"
]

excluded = [
  "auto-merging",
  "deployment"
]
::END

::AUTHORITY
runtime_mode = "governed_review"
receipt_required = true
::END

::PERMISSIONS

allow:
  - action = "read_project_files"
    scope = "project root only"
    enforced_by = "agent_receipt"

deny:
  - action = "write_production_files"
    scope = "all"
    enforced_by = "agent_receipt"
    enforcement = "hard_block"

::END
