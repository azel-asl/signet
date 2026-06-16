# Invalid Ledger — Count Drift (Phase 3 regression fixture)
#
# Packet declares: required_gate_count=7, required_acceptance_test_count=12
# Ledger reports:  required_gate_count=0, required_acceptance_test_count=3
# Expected errors: LED_013 (gate count), LED_015 (AT count)

[TASK_001: COMPLETE | evidence_type: file_write | evidence_ref: path: src/index.ts | diff_summary: Created project structure]
[TASK_002: COMPLETE | evidence_type: file_write | evidence_ref: path: src/index.ts | diff_summary: Implemented core logic]
[TASK_003: COMPLETE | evidence_type: command_output | evidence_ref: command: npm test | exit_code: 0 | summary: Tests passing]

::VERIFICATION_LEDGER
required_task_count = 3
required_gate_count = 0
required_lock_count = 2
required_acceptance_test_count = 3
required_receipt_count = 1
ledger_status = "COMPLETE"
::END
