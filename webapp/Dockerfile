# Multi-stage build for webapp
FROM node:20-slim AS builder

# Set working directory
WORKDIR /app

# Copy package files first (for better layer caching)
COPY package.json ./
COPY package-lock.json* ./

# Install ALL dependencies (dev + prod). ARG/ENV NODE_ENV must NOT be set to production
# before this step — npm skips devDependencies when NODE_ENV=production, which breaks
# the build because vite.config.ts imports @tanstack/devtools-vite (a devDependency).
RUN npm install

# Declare build-time args AFTER install so they don't affect the npm install environment.
ARG NODE_ENV=production

ENV NODE_ENV=${NODE_ENV}

# Copy source code
COPY . .

RUN npm run build

# Production stage
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy built output from builder
# Nitro outputs to .output directory
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/package.json ./

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
