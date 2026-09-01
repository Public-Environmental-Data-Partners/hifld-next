# Dataset MCP Production Routing Design

## Goal

Deploy the dataset MCP server in the existing `hifld-next` GKE cluster and expose its browser-facing endpoints through the existing `hifld.publicenvirodata.org` external Application Load Balancer.

## Architecture

The dataset MCP server runs as an internal Kubernetes Service named `dataset-mcp`. Its catalog client uses the cluster-local dataset API URL `http://dataset-api.hifld-next.svc.cluster.local`; the dataset API is not exposed directly for this integration.

The dataset MCP Service publishes a standalone GKE NEG named `dataset-mcp-prod`. The existing load balancer gets a second backend service for this NEG while retaining the webapp as its default backend and GCS as the `/storage/*` backend.

The dataset MCP public origin is `https://hifld.publicenvirodata.org`. The URL map sends these paths directly to the dataset MCP backend without rewriting them:

- `/mcp` and `/mcp/*`
- `/api/queries` and `/api/queries/*`
- `/tiles/*`
- `/assets/maplibre-gl-worker.mjs`

All other paths continue to the webapp. The webapp's MCP and query proxy routes remain available for local development but are bypassed by production load-balancer routing.

## Runtime Configuration

The dataset MCP deployment receives:

- `DATASET_MCP_CATALOG_BASE_URL=http://dataset-api.hifld-next.svc.cluster.local`
- `DATASET_MCP_PUBLIC_ORIGIN=https://hifld.publicenvirodata.org`
- `DATASET_MCP_WEBAPP_ORIGINS=https://hifld.publicenvirodata.org`
- `DATASET_MCP_QUERY_TOKEN_SECRET` from a Terraform-managed Kubernetes Secret

The webapp receives:

- `DATASET_MCP_QUERY_API_URL=http://dataset-mcp.hifld-next.svc.cluster.local`

The token secret is a generated 64-character value kept in Terraform state and the Kubernetes Secret. It is not exposed to the webapp or browser runtime.

## Network And Security

The dataset MCP backend uses the existing Cloud Armor policy. Load-balancer health checks target `/healthz` on the serving port. The cluster firewall permits Google health-check ranges to reach both the webapp port `8080` and dataset MCP port `8000`.

The dataset MCP NetworkPolicy keeps DNS and dataset API egress constrained. Production storage egress permits TCP 443 to `0.0.0.0/0` because native Kubernetes NetworkPolicy cannot express GCS hostnames and Google storage addresses are not a stable application-owned CIDR. Query sources remain constrained by catalog resolution and server-side SQL policy.

## Bootstrap Sequence

GKE standalone NEGs are created by the Kubernetes Service controller, so Terraform cannot attach the dataset MCP NEG before the first Helm deployment. A `dataset_mcp_lb_enabled` Terraform variable controls only the public backend and path rules.

1. Apply Terraform with `dataset_mcp_lb_enabled=false` to create the Kubernetes ServiceAccount and query-token Secret.
2. Run the container deployment workflow to install dataset MCP and create `dataset-mcp-prod` NEGs.
3. Set `DATASET_MCP_LB_ENABLED=true` and apply Terraform again to attach the NEG backend and public path rules.

Subsequent deploys retain the NEG and use the normal workflow.

## Verification

- Render and lint the generic dataset MCP chart.
- Render the GCP wrapper chart and assert its Service, NEG, environment, Secret, resources, and NetworkPolicy values.
- Test the deployment workflow includes all four application releases at one resolved image SHA.
- Test the Terraform source includes the generated Secret, ServiceAccount, conditional NEG backend, health check, and URL-map paths.
- Run Terraform formatting and validation.
- After deployment, verify `/healthz`, MCP initialization through `/mcp`, query creation, query paging, and an authenticated MVT tile request through the public hostname.
