# Agent Instructions

These instructions apply to the whole repository. Follow them before making changes and before handing work back.

## Quality Gates

For any change touching `dataset-api`, run these from `dataset-api/` before claiming the work is complete:

```bash
uv run ruff check .
uv run ruff format --check .
uv run pyright
uv run basedpyright
uv run pytest
```

For narrower changes, also run the targeted tests for the touched subsystem first, then the full gate above.

For any change touching `webapp`, run these from `webapp/` before claiming the work is complete:

```bash
npm run check
npm run typecheck
npm test
```

Run `npm run build` as well for routing, bundling, environment, or deployment-facing changes.

## Python Type Safety

- Do not use `Any`, `dict[str, Any]`, `list[Any]`, or `cast(Any, ...)` in application code.
- Do not use `object` as a convenience escape hatch. It is acceptable only at true external boundaries such as JSON validation, Pydantic validators, SQLAlchemy hooks, pandas dtype inspection, or similar APIs that genuinely accept unknown input.
- Prefer explicit dataclasses, Pydantic models, `TypedDict`, type aliases, or narrow unions over broad dynamic typing.
- Use native Ruff, Pyright, and BasedPyright checks. Do not add custom type-check scripts to compensate for weak typing.
- In TypeScript application code, do not use `any`, `unknown`, `object`, `@ts-ignore`, or non-null assertions as escape hatches. Parse external data into explicit zod schemas, interfaces, or narrow unions at the boundary.

## Ruff And Formatting

- Keep Ruff clean without broad project-wide ignores.
- Prefer fixing findings over adding `noqa`.
- If a `noqa` is necessary, make it narrow and include the specific rule code.
- Preserve Black-style formatting through `uv run ruff format .`.

## Refactoring Rules

- Preserve public API routes, response fields, CLI arguments, environment variables, and storage paths unless the user explicitly asks to change them.
- Keep SeaweedFS as the supported local storage backend.
- Keep startup database initialization as the supported application startup pattern.
- Treat GeoServer as legacy; do not add new GeoServer coupling.
- Prefer small focused modules and typed helper functions over large mixed-responsibility files.

## Verification Discipline

- Reproduce bugs directly before fixing them.
- Add or update a regression test when a bug can reasonably be covered.
- After refactors, run import/type/lint checks because stale imports are the common failure mode.
- If a command fails, report the exact remaining failure rather than saying the work is done.
