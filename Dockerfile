# ServiceNow MCP Server - Docker Image
# Part of Happy Technologies composable service ecosystem

FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (production only)
RUN npm install --omit=dev

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
