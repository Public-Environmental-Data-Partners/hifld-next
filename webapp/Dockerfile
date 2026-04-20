# Multi-stage build for webapp
FROM node:20-slim AS builder

# Set working directory
WORKDIR /app

# Build-time args (do not set NODE_ENV=production before npm install — npm would skip
# devDependencies, but vite.config.ts imports @tanstack/devtools-vite and Vite lives in devDependencies.)
ARG NODE_ENV=production

# Client-side environment variables (VITE_PUBLIC_*), embedded at `vite build`
ARG VITE_PUBLIC_DATASET_API_URL=""
ARG VITE_PUBLIC_POSTHOG_KEY=""
ARG VITE_PUBLIC_POSTHOG_HOST="https://us.i.posthog.com"

# Copy package files first (for better layer caching)
COPY package.json ./
COPY package-lock.json* ./

# Install dependencies (includes devDependencies: vite, @tanstack/devtools-vite, etc.)
RUN npm install

ENV NODE_ENV=${NODE_ENV}
ENV VITE_PUBLIC_DATASET_API_URL=${VITE_PUBLIC_DATASET_API_URL}
ENV VITE_PUBLIC_POSTHOG_KEY=${VITE_PUBLIC_POSTHOG_KEY}
ENV VITE_PUBLIC_POSTHOG_HOST=${VITE_PUBLIC_POSTHOG_HOST}

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

# Set port environment variable (Cloud Run uses PORT env var)
ENV PORT=8080
ENV NODE_ENV=production

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s \
    CMD node -e "require('http').get('http://localhost:8080/', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run the Nitro server
# Nitro reads DATASET_API_URL from Cloud Run environment at runtime
CMD ["node", ".output/server/index.mjs"]

