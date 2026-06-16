# Contract Review — Vendor Payment Risk (sample, fictional)
#
# Intent: "Review this vendor contract, flag payment risks, do not provide
# legal advice, and create a receipt."
#
# This is a SIMPLE Tier 1 review packet. Note how the plain-English intent
# maps onto real ASL Lite + GCL blocks:
#   - "review the contract"      -> ROLE + SCOPE.included
#   - "flag payment risks"       -> ROLE.description + SCOPE.included
#   - "do NOT give legal advice" -> SCOPE.excluded + a deny PERMISSION (hard_block)
#   - "create a receipt"         -> AUTHORITY.receipt_required = true

asl::META
id = "contract-review-001"
version = "ASL Lite + GCL Packet Standard v1.5.1"
packet_tier = 1
type = "review"
owner = "Erwin Layaoen"
status = "active"
::END

asl::ROLE
name = "Contract Reviewer"
description = "Review a vendor contract and flag payment-term risks. Does not provide legal advice."
::END

asl::SCOPE
included = [
  "contract text review",
  "payment-term risk flagging"
]

excluded = [
  "legal advice",
  "signing the contract",
  "negotiating on the user's behalf"
]
::END

::AUTHORITY
runtime_mode = "governed_review"
receipt_required = true
::END

::PERMISSIONS

allow:
  - action = "read_provided_document"
    scope = "the contract text supplied by the user"
    enforced_by = "agent_receipt"

deny:
  - action = "provide_legal_advice"
    scope = "all"
    enforced_by = "agent_receipt"
    enforcement = "hard_block"

::END
