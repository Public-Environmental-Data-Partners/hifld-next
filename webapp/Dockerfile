# Multi-stage build for webapp
FROM node:22-slim AS builder

WORKDIR /workspace

# Copy package files first (for better layer caching)
COPY package.json package-lock.json ./
COPY packages/map-core/package.json ./packages/map-core/
COPY packages/map-ui/package.json ./packages/map-ui/
COPY dataset-mcp/ui/package.json ./dataset-mcp/ui/
COPY webapp/package.json ./webapp/

# Install ALL dependencies (dev + prod). ARG/ENV NODE_ENV must NOT be set to production
# before this step — npm skips devDependencies when NODE_ENV=production, which breaks
# the build because vite.config.ts imports @tanstack/devtools-vite (a devDependency).
RUN npm ci

# Declare build-time args AFTER install so they don't affect the npm install environment.
ARG NODE_ENV=production

ENV NODE_ENV=${NODE_ENV}

# Copy source code after the cached dependency layer.
COPY packages/map-core ./packages/map-core
COPY packages/map-ui ./packages/map-ui
COPY webapp/ ./webapp

RUN npm run --workspace webapp build

# Production stage
FROM node:22-slim

# Set working directory
WORKDIR /app

# Copy built output from builder
# Nitro outputs to .output directory
COPY --from=builder /workspace/webapp/.output ./.output
COPY --from=builder /workspace/webapp/package.json ./

# Set port environment variable
ENV PORT=8080
ENV NODE_ENV=production

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s \
    CMD node -e "require('http').get('http://localhost:8080/', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run the Nitro server
# Nitro reads deployment configuration from the runtime environment.
CMD ["node", ".output/server/index.mjs"]
