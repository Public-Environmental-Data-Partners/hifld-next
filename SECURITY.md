# Security maintenance

Dependabot opens weekly dependency update pull requests for the npm workspace,
both uv projects, ClickHouse Python requirements, Docker base images, and GitHub
Actions. GitHub Dependabot alerts and security update PRs are enabled separately
in repository settings. Updates require review and the normal quality checks;
they are not automatically merged or deployed.

The Security scans workflow runs on pull requests, pushes to main, daily, and
manually. It audits the npm lockfile, exports and audits both locked Python runtime
environments, and builds and scans all four container images with Grype. npm
and container checks fail on high or critical vulnerabilities; pip-audit fails
on any known vulnerability. Container findings are uploaded to GitHub code
scanning and saved as workflow artifacts, including when the scanner fails.
CodeQL checks JavaScript/TypeScript, Python, and GitHub Actions on the same events.

Check Actions and the repository Security tab for findings and update PRs. A
dependency update only protects production after the resulting images are built
and deployed. Daily container scans check newly built images from the default
branch; they do not inspect the image digests currently running in production.
Dependabot does not update dependencies in the separate infrastructure or dataset
pipeline repositories through this configuration.

Scanners detect published vulnerabilities and supported code patterns. They do
not establish the absence of undisclosed vulnerabilities or prove exploitability.

The webapp stays on the patched TanStack Start 1.168 patch line because later
minor releases require Vite 8. A move to that line should upgrade the build stack
together. MapLibre 6 and Vitest 4 are included for their security fixes.
