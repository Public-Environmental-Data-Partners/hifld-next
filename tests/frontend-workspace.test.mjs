import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readProjectFile(path) {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

async function pathExists(path) {
  try {
    await access(resolve(repositoryRoot, path));
    return true;
  } catch {
    return false;
  }
}

test("root workspace owns every frontend consumer and shared package", async () => {
  const manifest = JSON.parse(await readProjectFile("package.json"));

  assert.deepEqual(manifest.workspaces, [
    "dataset-mcp/ui",
    "packages/map-core",
    "packages/map-ui",
    "webapp",
  ]);
});

test("the root lockfile is the only frontend lockfile", async () => {
  for (const path of [
    "dataset-mcp/ui/package-lock.json",
    "packages/map-core/package-lock.json",
    "packages/map-ui/package-lock.json",
    "webapp/package-lock.json",
  ]) {
    assert.equal(await pathExists(path), false, `${path} must be removed`);
  }
});

test("consumer images install from the root workspace lockfile", async () => {
  for (const dockerfile of ["dataset-mcp/Dockerfile", "webapp/Dockerfile"]) {
    const source = await readProjectFile(dockerfile);
    assert.match(source, /COPY package\.json package-lock\.json \.\//);
    assert.match(source, /RUN npm ci\n/);
    assert.doesNotMatch(source, /npm ci --workspace/);
    assert.doesNotMatch(source, /package-lock\.json \.\/packages\//);
  }
});

test("frontend test tooling stays compatible with webapp's Vite 7 build", async () => {
  const mcpUi = JSON.parse(await readProjectFile("dataset-mcp/ui/package.json"));
  const mapCore = JSON.parse(await readProjectFile("packages/map-core/package.json"));
  const mapUi = JSON.parse(await readProjectFile("packages/map-ui/package.json"));

  assert.equal(mcpUi.devDependencies.vite, "^7.1.7");
  assert.equal(mcpUi.devDependencies.vitest, "^3.0.5");
  assert.equal(mapCore.devDependencies.vitest, "^3.0.5");
  assert.equal(mapUi.devDependencies.vitest, "^3.0.5");
  assert.equal(mapCore.devDependencies["@types/node"], "^22.19.3");
  assert.equal(mapUi.devDependencies["@types/node"], "^22.19.3");
});

test("image publishing runs for deployable chart changes", async () => {
  const workflow = await readProjectFile(".github/workflows/publish-images.yml");

  for (const path of [
    "charts/dataset-mcp/**",
    "charts/feature-server/**",
    "charts/webapp/**",
  ]) {
    assert.ok(workflow.includes(`- "${path}"`));
  }
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /build-only:/);
  assert.match(workflow, /needs: build-only/);
  assert.match(workflow, /docker buildx imagetools create/);
});

test("retired catalog services and migration writers cannot be started or published", async () => {
  for (const path of [
    "dataset-api",
    "charts/dataset-api",
    "charts/dataset-discovery",
    "scripts/setup-geoserver.sh",
    "scripts/portolan_gcp_copy.py",
    "scripts/portolan_gcp_spike.py",
    "scripts/portolan_gcp_upload_catalog.py",
    "scripts/portolan_prod_baseline.py",
    "scripts/portolan_catalog_parity.py",
  ]) {
    assert.equal(await pathExists(path), false, `${path} is retired`);
  }
  for (const path of [".github/workflows/publish-images.yml", "docker-compose.yaml", ".env.example"]) {
    const source = await readProjectFile(path);
    assert.doesNotMatch(source, /dataset-api|dataset_api|dataset-discovery|discover-job|geoserver/i);
  }
  assert.ok(await pathExists("scripts/portolan_acceptance.py"));
  assert.match(await readProjectFile("docker-compose.yaml"), /seaweedfs-filer:/);
});

test("MCP asset copying resolves MapLibre from the workspace dependency graph", async () => {
  const script = await readProjectFile(
    "dataset-mcp/ui/scripts/copy-maplibre-assets.mjs",
  );

  assert.match(script, /createRequire/);
  assert.match(script, /resolve\("maplibre-gl\/package\.json"\)/);
  assert.doesNotMatch(script, /node_modules\/maplibre-gl\/dist/);
});

test("MCP catalog egress uses the webapp pod port, not the retired API port", async () => {
  const policy = await readProjectFile("charts/dataset-mcp/templates/networkpolicy.yaml");
  const values = await readProjectFile("charts/dataset-mcp/values.yaml");
  assert.match(policy, /port: \{\{ \.Values\.networkPolicy\.catalogPort \}\}/);
  assert.match(values, /catalogPort: 8080/);
});

test("the dataset MCP Python gate builds UI assets from the repository root", async () => {
  const workflow = await readProjectFile(".github/workflows/dataset-mcp-quality.yml");

  assert.match(
    workflow,
    /- run: npm ci\n\s+working-directory: \./,
  );
  assert.match(
    workflow,
    /- run: npm run --workspace @hifld\/dataset-mcp-ui build\n\s+working-directory: \./,
  );
});
