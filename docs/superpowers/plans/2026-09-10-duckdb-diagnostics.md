# DuckDB diagnostics implementation plan

**Goal:** Return DuckDB's diagnostic text without invented remediation or sensitive execution details.

**Architecture:** Sanitize DuckDB exceptions at the worker boundary; retain existing failure codes and transport fields. Unexpected Python errors remain private. Both map and paginated queries use this boundary.

**Tech stack:** Python, DuckDB, pytest.

- [x] Add runtime regressions for missing columns, function/type errors, map errors and redaction; run them against the existing catch-all and observe failure.
- [x] Add `query_worker/diagnostics.py`: redact known credentials, source locations, generated identifiers, URLs and local paths; omit generated SQL excerpts and bound output length. Preserve DuckDB wording and candidate bindings.
- [x] Use the sanitizer for DuckDB exceptions in `runtime.py`, preserving memory/storage error codes. Keep Python exceptions generic.
- [x] Run targeted runtime/service/tile tests, then Ruff, both type checkers and the full MCP test suite.
- [x] Inspect the diff and report local results; no deployment in this task.

Verification: Ruff and formatting clean; Pyright and BasedPyright report zero errors; full MCP suite 307 passed, 5 skipped (two dependency deprecation warnings).
