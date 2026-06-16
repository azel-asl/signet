# Invalid Receipt — Count Mismatch
#
# Packet declares gate_count=2, acceptance_test_count=1
# Receipt reports gate_count=0, acceptance_test_count=5
# Expected: REC_013 + REC_015

[TASK_001: COMPLETE | evidence_type: file_write | evidence_ref: path: src/index.ts | diff_summary: Created project]
[TASK_002: COMPLETE | evidence_type: file_write | evidence_ref: path: src/index.ts | diff_summary: Implemented logic]
[TASK_003: COMPLETE | evidence_type: command_output | evidence_ref: command: npm test | exit_code: 0 | key_result: tests passing]

::VERIFICATION_LEDGER
required_task_count = 3
required_gate_count = 0
required_lock_count = 2
required_acceptance_test_count = 5
required_receipt_count = 1
ledger_status = "COMPLETE"
::END
