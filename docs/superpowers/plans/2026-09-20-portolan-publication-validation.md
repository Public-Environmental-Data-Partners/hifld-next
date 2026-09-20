# Portolan Publication Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate each complete candidate STAC release before the pointer advances, preserving core STAC for records with documented missing-producer exceptions without falsely declaring Portolan conformance.

**Architecture:** Normalize verifiable legacy `publisher` providers in a local candidate bundle, record missing-producer exceptions, and validate every Catalog/Collection in that bundle offline. Only a validated bundle may be uploaded and selected by `_catalog/current.json`. The same metadata gate runs on the local in-place path and release-pointer path.

**Tech Stack:** Python 3.12, Dagster, `rashid` 0.1.8 offline STAC structural validator, `jsonschema` Draft 7, unittest, local/GCS storage resources.

---

### Task 1: Producer normalization and explicit exceptions

**Files:**
- Create: `src/dagster_hifld/portolan/validation.py`
- Modify: `src/dagster_hifld/portolan/catalog.py`
- Test: `tests/test_portolan_validation.py`

- [ ] **Step 1: Write failing tests** with a freshly rendered Collection for each case: known source `publisher` produces `roles:["producer"]`; a retained legacy `providers:[{"name":"Census Bureau"}]` gains the producer role; host-only metadata does not gain a producer role, drops the Portolan profile URI on that Collection, and appears once in `_catalog/validation-exceptions.json` with `version_path`, `reason:"missing_source_producer"`, and `source_evidence:"not_present"`.
- [ ] **Step 2: Run** `uv run python -m unittest tests.test_portolan_validation`; confirm the missing module/functionality causes the failure.
- [ ] **Step 3: Add** typed helpers in `validation.py` for local candidate documents. Normalize only a non-host provider whose existing authored field identifies it as publisher/producer; preserve names and URLs. For a host-only Collection, remove just `https://schemas.portolan-sdi.org/portolan/v0.2.0/schema.json` from its `stac_extensions`, and write a stable, sorted exception report. Do not use a generic validation bypass or invent a source organization. Make `catalog.py` render a host-only Collection without that extension from the outset; the bundle normalizer handles retained legacy JSON.
- [ ] **Step 4: Run** the targeted tests and `uv run python -m unittest tests.test_portolan_catalog`.
- [ ] **Step 5: Commit** the helpers and tests in the datasets repository worktree.

### Task 2: Offline structural and profile gate

**Files:**
- Modify: `pyproject.toml`, `uv.lock` (add pinned `rashid==0.1.8` and direct `jsonschema` dependency)
- Create: `src/dagster_hifld/portolan/schemas/portolan-v0.2.0.json` (the exact immutable published schema, with its `$id` intact)
- Modify: `src/dagster_hifld/portolan/validation.py`
- Test: `tests/test_portolan_validation.py`

- [ ] **Step 1: Write failing tests** asserting a valid two-Collection tree passes; a malformed Catalog, malformed Collection, broken same-release `child` link, and non-exempt Portolan profile failure each report the document path and raise before publication. Assert the missing-producer exception Collection still passes core STAC validation and only that Collection skips the Portolan profile.
- [ ] **Step 2: Run** the targeted test and confirm each new invalid case is incorrectly accepted before implementation.
- [ ] **Step 3: Add** offline validation: call `rashid.validate(root, rules=(), structural=True, schema=False, data=False)` and reject any structural errors or unavailable-pass warning; load the vendored profile with `jsonschema.Draft7Validator` and apply it to every Catalog/Collection that declares its exact URI; verify every local or same-release `child`/`parent`/`root`/`self` link resolves within the candidate tree. Collect bounded, path-specific error messages. Do not fetch remote data assets or use network schema resolution.
- [ ] **Step 4: Run** the targeted tests and the existing Portolan catalog tests.
- [ ] **Step 5: Commit** the dependency, schema, gate, and tests.

### Task 3: Wire the gate before pointer selection

**Files:**
- Modify: `src/dagster_hifld/portolan/workflow.py`
- Test: `tests/test_portolan_workflow.py`

- [ ] **Step 1: Write failing tests** for both `_publish_catalog` and `_publish_release_catalog`: monkeypatch candidate validation to reject the bundle and assert the local SQLite publication unit or GCS release pointer is unchanged; assert an accepted candidate writes the deterministic exception report before the pointer.
- [ ] **Step 2: Run** `uv run python -m unittest tests.test_portolan_workflow`; confirm the pointer or SQLite is currently changed despite rejection.
- [ ] **Step 3: Call** the normalization/report helper after rendering and rebasing the complete candidate tree, then call the offline validator before writing any release objects or pointer. On the in-place path, validate before overwriting any existing tree object. Keep all storage writes through `PublishedStorageResource`; no GCS-only path or external database dependency.
- [ ] **Step 4: Run** targeted workflow and validation tests. Run `uv run python -m unittest discover tests`, plus configured lint/type checks if present. Exercise one local SeaweedFS candidate and verify the release pointer is unchanged on an intentionally invalid candidate.
- [ ] **Step 5: Commit** workflow wiring and tests.

## Review

Confirm that every candidate document is checked, existing data/asset hrefs stay unchanged, exceptions are only for missing source producers, unknown schema failures still fail closed, and the previous release remains selected after a failed candidate.
