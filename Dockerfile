# ServiceNow MCP Server - Docker Image
# Author: nczitzer
# Part of Happy Technologies composable service ecosystem

# Stage 1: Dependencies
FROM node:24-alpine AS dependencies

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm install && \
    npm cache clean --force

# Stage 2: Production
FROM node:24-alpine AS production

# Set working directory
WORKDIR /app

# Security: Update Alpine packages to patch vulnerabilities
RUN apk update && \
    apk upgrade --no-cache && \
    rm -rf /var/cache/apk/*

# Copy package.json only (not package-lock to avoid dev dependency references)
COPY package.json ./

# Install only production dependencies and generate clean lockfile
RUN npm install --package-lock-only --omit=dev && \
    npm ci --omit=dev && \
    npm cache clean --force

# Runtime doesn't need package managers; remove them to reduce attack surface
RUN rm -rf /usr/local/lib/node_modules/npm && \
    rm -f /usr/local/bin/npm /usr/local/bin/npx

# Copy application source
COPY src/ ./src/
COPY config/ ./config/
COPY docs/ ./docs/
COPY LICENSE ./
COPY README.md ./

# Create directory for config
RUN mkdir -p /app/config

# Expose HTTP server port (for SSE transport)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Default to HTTP server (SSE transport)
# Use stdio-server.js for Claude Desktop integration
CMD ["node", "src/server.js"]
