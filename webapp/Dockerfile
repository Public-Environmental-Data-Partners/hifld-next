# Multi-stage build for webapp
FROM node:20-slim AS builder

# Set working directory
WORKDIR /app

# Accept build arguments for environment variables
ARG NODE_ENV=production

# Set environment variables at build time (before compilation)
# These will be available during the build process
ENV NODE_ENV=${NODE_ENV}

# Copy package files first (for better layer caching)
COPY package.json ./
COPY package-lock.json* ./

# Install dependencies
# Using npm install for better compatibility across platforms
# npm ci can fail if lock file was generated on different platform/Node version
RUN npm install

# Copy source code
COPY . .

# Build the application (NODE_ENV and PUBLIC_DATASET_API_URL are now available)
RUN npm run build

# Production stage
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy built output from builder
# Nitro outputs to .output directory
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/package.json ./

# Set port environment variable (Cloud Run uses PORT env var)
ENV PORT=8080
ENV NODE_ENV=production

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s \
    CMD node -e "require('http').get('http://localhost:8080/', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run the Nitro server
# Nitro reads PUBLIC_DATASET_API_URL from Cloud Run environment at runtime
CMD ["node", ".output/server/index.mjs"]

