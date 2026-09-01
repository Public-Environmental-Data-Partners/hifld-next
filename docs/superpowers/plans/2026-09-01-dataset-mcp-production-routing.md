# Dataset MCP Production Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy dataset MCP in the production GKE cluster and route its public MCP, query, tile, and worker endpoints through the existing HIFLD load balancer.

**Architecture:** The application chart provides a deterministic `dataset-mcp` Service. A GCP wrapper chart configures the internal dataset API URL, public origin, query-token Secret, GKE standalone NEG, and storage egress. Terraform provisions the runtime Secret and ServiceAccount, then conditionally attaches the NEG to the existing ALB after the first Helm deployment.

**Tech Stack:** Helm 3, Kubernetes, GKE standalone NEGs, Google Cloud external Application Load Balancer, Terraform 1.9, GitHub Actions, Python `unittest`.

---

### Task 1: Make the generic dataset MCP Service name deterministic

**Files:**
- Modify: `charts/dataset-mcp/values.yaml`
- Modify: `charts/dataset-mcp/templates/_helpers.tpl`
- Test: `dataset-mcp/tests/test_chart.py`

- [ ] Write a test that renders release `dataset-mcp` and expects the Service and Deployment names to be `dataset-mcp`.
- [ ] Run `uv run pytest tests/test_chart.py -v` from `dataset-mcp/` and confirm it fails because the current name is `dataset-mcp-dataset-mcp`.
- [ ] Add standard `nameOverride` and `fullnameOverride` helpers and default values.
- [ ] Re-run the targeted test and `helm lint charts/dataset-mcp`.

### Task 2: Add the production GCP wrapper chart

**Files:**
- Create: `../hifld-next-iac/charts/dataset-mcp-gcp/Chart.yaml`
- Create: `../hifld-next-iac/charts/dataset-mcp-gcp/values.yaml`
- Modify: `../hifld-next-iac/tests/test_app_gcp_charts.py`

- [ ] Extend the chart test to render `dataset-mcp-gcp` and assert the `dataset-mcp` Service name, `dataset-mcp-prod` NEG, internal catalog URL, public origin, webapp origin, token Secret, resource limits, and HTTPS storage egress.
- [ ] Run the targeted test and confirm it fails because the wrapper chart does not exist.
- [ ] Create the wrapper chart using the app-owned `charts/dataset-mcp` dependency and the approved production values.
- [ ] Build the dependency, lint the chart, and rerun the targeted test.

### Task 3: Provision dataset MCP Kubernetes prerequisites

**Files:**
- Create: `../hifld-next-iac/environments/prod/dataset_mcp.tf`
- Create: `../hifld-next-iac/tests/test_dataset_mcp_infrastructure.py`

- [ ] Add source-shape tests for the `dataset-mcp` ServiceAccount, generated 64-character token, Kubernetes Secret key `query-token-secret`, and internal service output.
- [ ] Run the targeted test and confirm it fails because `dataset_mcp.tf` does not exist.
- [ ] Add the Terraform resources and output without adding unnecessary GCP IAM for the public GCS source.
- [ ] Re-run the targeted test and Terraform formatting.

### Task 4: Attach dataset MCP to the existing load balancer

**Files:**
- Modify: `../hifld-next-iac/environments/prod/main.tf`
- Modify: `../hifld-next-iac/environments/prod/gke.tf`
- Modify: `../hifld-next-iac/.github/workflows/terraform.yml`
- Modify: `../hifld-next-iac/tests/test_dataset_mcp_infrastructure.py`
- Modify: `../hifld-next-iac/tests/test_prod_gke_firewall.py`

- [ ] Add failing tests for the opt-in NEG lookup/backend, `/healthz` health check, public MCP/query/tile/worker paths, and health-check access to port `8000`.
- [ ] Add `dataset_mcp_lb_enabled` and `dataset_mcp_gke_neg_zones`, using the existing webapp zones by default.
- [ ] Add the conditional NEG lookup, backend health check, backend service, and URL-map path rule with no rewrite.
- [ ] Extend the health-check firewall to ports `8000` and `8080` and wire the new variables into the Terraform workflow.
- [ ] Run the targeted tests, `terraform fmt -check -recursive`, and `terraform validate`.

### Task 5: Deploy dataset MCP with the other application releases

**Files:**
- Modify: `../hifld-next-iac/.github/workflows/deploy-containers.yml`
- Modify: `../hifld-next-iac/charts/webapp-gcp/values.yaml`
- Modify: `../hifld-next-iac/tests/test_app_gcp_charts.py`
- Modify: `../hifld-next-iac/tests/test_database_backend_wiring.py`

- [ ] Add failing assertions for the webapp internal MCP URL and a fourth unconditional dataset MCP Helm upgrade using the resolved application SHA.
- [ ] Configure `DATASET_MCP_QUERY_API_URL` on the webapp wrapper.
- [ ] Add the dataset MCP image repository and Helm deployment step.
- [ ] Re-run chart and workflow tests.

### Task 6: Document and verify the rollout

**Files:**
- Modify: `../hifld-next-iac/README.md`

- [ ] Document the four releases, same-origin routing, internal URLs, bootstrap sequence, and post-deployment smoke requests.
- [ ] Run the complete IaC unit-test suite, Helm lint/render checks, Terraform formatting, `terraform init -backend=false`, and `terraform validate`.
- [ ] Run the complete `dataset-mcp` quality gate required by `AGENTS.md` and confirm the app repository worktree is clean except for these intended changes.
