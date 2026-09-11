# Tile cancellation and dismissible map errors

**Goal:** Release abandoned tile work promptly without adding frontend debounce;
make map errors dismissible at the standard top-left inset.

**Architecture:** Monitor HTTP disconnects only for GET tile routes, inside the
existing concurrency admission boundary. Cancel and await the application task
so worker cleanup finishes before capacity is released. Leave POST request bodies
and non-tile routes untouched. Keep banner dismissal separate from layer status.

**Stack:** ASGI/asyncio, FastAPI, React, MapLibre, pytest, Vitest, Playwright.

## Backend

- [ ] Reproduce a disconnected tile continuing with an ASGI receive queue and a
  blocked application; test all three tile URL forms.
- [ ] Add a small disconnect helper used by ConcurrencyLimiter for tile GETs.
  Race application completion against http.disconnect, cancel/await both tasks
  on cleanup, and preserve application exceptions.
- [ ] Verify normal completion, outer cancellation, queue cancellation, and
  POST body preservation. Existing worker cancellation tests must pass.
- [ ] Run MCP Ruff lint/format, Pyright, BasedPyright, and full pytest.

## Banner

- [ ] Add failing UI tests for accessible dismissal, suppression of identical
  repeated messages, distinct new messages, and reset on a new map.
- [ ] Add an accessible close control; retain dismissed messages for the map
  lifecycle, leaving agent status untouched. Reset on a new map/retry.
- [ ] Align to 0.75rem top/left and avoid overlap with selection feedback by
  stacking notices in one top-left container. Preserve narrow-screen wrapping.
- [ ] Run UI lint/typecheck/tests/build and browser tests; inspect screenshots
  showing the error banner before and after dismissal.

## Delivery

- [ ] Review diff, open PR, require green CI, merge, publish images, dispatch
  hifld-next-iac deploy-containers.yml pinned to the merge SHA.
- [ ] Verify public MCP and real map rendering after rollout. Report any
  proxy/network limitation on browser-abort propagation explicitly.
