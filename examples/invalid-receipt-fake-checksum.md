# Invalid Receipt — Fake Checksum on Missing File
#
# This fixture demonstrates STRICT mode: checksum: reviewed-for-gap on a
# non-existent file path is REC_009 ERROR (not LED_009 warning in ledger mode).
# This is the Phase 4 TASK_016 pattern that Phase 5 detects.

[TASK_001: COMPLETE | evidence_type: file_write | evidence_ref: path: /nonexistent/output.ts | diff_summary: Created output | checksum: reviewed-for-gap]
[TASK_002: COMPLETE | evidence_type: file_write | evidence_ref: path: /nonexistent/index.ts | diff_summary: Implemented logic | checksum: updated]
[TASK_003: COMPLETE | evidence_type: command_output | evidence_ref: command: npm test | exit_code: 0 | key_result: all tests passing]

::VERIFICATION_LEDGER
required_task_count = 3
required_gate_count = 2
required_lock_count = 2
required_acceptance_test_count = 1
required_receipt_count = 1
ledger_status = "COMPLETE"
::END
