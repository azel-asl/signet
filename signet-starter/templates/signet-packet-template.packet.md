# Signet Packet Template
#
# Copy this and fill it in. Delete blocks you don't need for Tier 1.
# Tier 1 (review): keep META, ROLE, SCOPE, AUTHORITY, PERMISSIONS.
# Tier 2 (build) / Tier 3 (deploy): keep everything; Tier 3 needs a human GATE.
# Validate with: signet validate your-file.packet.md

asl::META
id = "your-packet-id"
version = "ASL Lite + GCL Packet Standard v1.5.1"
packet_tier = 1            # 1 review | 2 build | 3 deploy
type = "review"            # review | build | deploy
owner = "Your Name"
status = "active"
::END

asl::ROLE
name = "Role Name"
description = "One sentence: what this agent does and does not do."
::END

asl::SCOPE
included = ["what is in scope"]
excluded = ["what is forbidden"]
::END

::AUTHORITY
runtime_mode = "governed_review"   # governed_review | governed_build | governed_execution
receipt_required = true
# approval_required = true         # required for Tier 3
::END

::PERMISSIONS
allow:
  - action = "read_something"
    scope = "narrow scope"
    enforced_by = "agent_receipt"
deny:
  - action = "do_forbidden_thing"
    scope = "all"
    enforced_by = "agent_receipt"
    enforcement = "hard_block"
::END

# ─────────────────────────────────────────────────────────────
# Everything below is required for Tier 2 and Tier 3. Delete for Tier 1.
# See examples/db-migration.packet.md and examples/phi-transfer.packet.md
# for complete, validated Tier 3 packets.
# ─────────────────────────────────────────────────────────────

# asl::PURPOSE … ::END
# asl::INPUTS … ::END
# asl::PROCESS … ::END
# asl::OUTPUT_CONTRACT (required_outputs, forbidden_outputs, completion_phrase) … ::END
# asl::FAILURE_MODES … ::END
# asl::RECEIPT (enabled, receipt_required, ledger_required, receipt_seals) … ::END
# asl::EXECUTION_PLAN (task_count + TASK_001…) … ::END
# ::LOCKS (LOCK_001…) … ::END
# ::LOCK_CHECK_RULES … ::END
# ::GATES (GATE_001…, human gate for Tier 3) … ::END
# ::ACCEPTANCE_TESTS (count + AT_001…) … ::END
# ::EVIDENCE_POLICY … ::END
# ::EVIDENCE_TEMPLATES … ::END
# ::DRIFT … ::END
# ::ESCALATION … ::END
# ::COMPLETION (complete_only_if, completion_invalid_if) … ::END
# ::VERIFICATION_LEDGER (counts must match actual block counts) … ::END
