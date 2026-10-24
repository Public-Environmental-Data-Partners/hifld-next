# Security scanning and dependency updates

Goal: Enable automatic dependency update PRs and recurring security checks, and patch known vulnerable dependencies in hifld-next.

- [x] Enable GitHub Dependabot alerts and security update PRs.
- [x] Add weekly Dependabot updates for the root npm workspace, both uv projects, Dockerfiles, ClickHouse requirements, and GitHub Actions. Keep merges manual.
- [x] Add CodeQL for JavaScript/TypeScript, Python, and Actions, plus npm/pip dependency audits and scans of all four built containers on PRs, main, and a daily schedule. Preserve reports for investigation.
- [x] Update vulnerable npm and Python dependencies, including the webapp MapLibre major upgrade, and pin Node container images to the patched 22.23.4 release.
- [x] Run workspace lint/type/tests/builds, Python quality gates, dependency audits, and workflow validation. Fix compatibility problems found by those checks.
- [ ] Review the diff, push the isolated branch, open a PR, and inspect GitHub checks. Document any remaining findings or validation limitations in the PR.

Configuration and generated lockfiles are validated through their consumers and existing suites; avoid tests that only match configuration text. No deployment or automatic merging is part of this change.
