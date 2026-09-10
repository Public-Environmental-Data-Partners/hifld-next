# Temporary MCP argument diagnostics

Approved scope: observe argument types without decoding stringified arguments,
changing validation, or deploying to production.

- [x] Isolate from ongoing Portolan work on a branch from main.
- [x] Reproduce successful array and rejected string requests over real MCP HTTP
  transport; require correlated diagnostic records in a failing regression test.
- [x] Add a bounded, pass-through ASGI body observer and a FastMCP tool-dispatch
  observer. Record generated request ID, map tool name, revision, and argument
  types only. Use the public middleware hook before tool-specific validation.
- [x] Test chunk preservation, malformed and oversized bodies, and missing/null
  parameters. Do not change their existing handling.
- [x] Run MCP tests, Ruff, both Python type checkers, and Helm template validation.
  Result: 275 passed, 5 skipped; two pre-existing dependency deprecation warnings.
  Ruff, Pyright, BasedPyright, Helm lint/template, and MCP UI build passed.
- [ ] Review the diff and prepare a PR; do not trigger deployment.
