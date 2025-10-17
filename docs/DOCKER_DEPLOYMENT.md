# Docker Deployment Guide

Deploy ServiceNow MCP Server using Docker for easy, consistent, and portable deployment.

## 🚀 Quick Start

### Option 1: Docker Hub (Recommended)

```bash
# Pull the latest image
docker pull nczitzer/mcp-servicenow-nodejs:latest

# Run with environment variables (single instance)
docker run -d \
  -p 3000:3000 \
  -e SERVICENOW_INSTANCE_URL=https://dev123456.service-now.com \
  -e SERVICENOW_USERNAME=admin \
  -e SERVICENOW_PASSWORD=your-password \
  --name servicenow-mcp-server \
  nczitzer/mcp-servicenow-nodejs:latest
```

### Option 2: Docker Compose

```bash
# Create .env file
cat > .env <<EOF
SERVICENOW_INSTANCE_URL=https://dev123456.service-now.com
SERVICENOW_USERNAME=admin
SERVICENOW_PASSWORD=your-password
SERVICENOW_AUTH_TYPE=basic
EOF

# Start with docker-compose
docker-compose up -d
```

### Option 3: Build Locally

```bash
# Build the image
docker build -t servicenow-mcp-server .

# Run the container
docker run -d -p 3000:3000 \
  -e SERVICENOW_INSTANCE_URL=https://dev123456.service-now.com \
  -e SERVICENOW_USERNAME=admin \
  -e SERVICENOW_PASSWORD=your-password \
  servicenow-mcp-server
```

## 🌐 Multi-Instance Configuration

For multi-instance support, mount your config file:

```bash
# Create config file
cp config/servicenow-instances.example.json config/servicenow-instances.json
# Edit with your instances

# Run with mounted config
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/config/servicenow-instances.json:/app/config/servicenow-instances.json:ro \
  --name servicenow-mcp-server \
  nczitzer/mcp-servicenow-nodejs:latest
```

Or use docker-compose:

```yaml
services:
  servicenow-mcp-server:
    image: nczitzer/mcp-servicenow-nodejs:latest
    ports:
      - "3000:3000"
    volumes:
      - ./config/servicenow-instances.json:/app/config/servicenow-instances.json:ro
```

## 🔍 Health Check

The container includes a health check endpoint:

```bash
# Check container health
docker ps

# Test health endpoint
curl http://localhost:3000/health

# Check logs
docker logs servicenow-mcp-server
```

## 🛠️ Environment Variables

### Single Instance Mode

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SERVICENOW_INSTANCE_URL` | Yes | - | ServiceNow instance URL |
| `SERVICENOW_USERNAME` | Yes | - | ServiceNow username |
| `SERVICENOW_PASSWORD` | Yes | - | ServiceNow password |
| `SERVICENOW_AUTH_TYPE` | No | `basic` | Authentication type |

### Multi-Instance Mode

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SERVICENOW_INSTANCE` | No | `default` | Instance name from config file |

## 📊 Resource Requirements

**Minimum:**
- CPU: 0.5 cores
- Memory: 256MB
- Disk: 500MB

**Recommended:**
- CPU: 1 core
- Memory: 512MB
- Disk: 1GB

## 🔒 Security Best Practices

### 1. Use Docker Secrets (Production)

```bash
# Create secrets
echo "your-password" | docker secret create servicenow_password -

# Run with secrets
docker service create \
  --name servicenow-mcp-server \
  --secret servicenow_password \
  -e SERVICENOW_INSTANCE_URL=https://prod.service-now.com \
  -e SERVICENOW_USERNAME=admin \
  nczitzer/mcp-servicenow-nodejs:latest
```

### 2. Use Read-Only Config Mount

```bash
docker run -d \
  -v $(pwd)/config/servicenow-instances.json:/app/config/servicenow-instances.json:ro \
  nczitzer/mcp-servicenow-nodejs:latest
```

### 3. Network Isolation

```bash
# Create isolated network
docker network create mcp-network

# Run in isolated network
docker run -d \
  --network mcp-network \
  -p 3000:3000 \
  nczitzer/mcp-servicenow-nodejs:latest
```

## 🔄 Updates & Maintenance

### Update to Latest Version

```bash
# Pull latest image
docker pull nczitzer/mcp-servicenow-nodejs:latest

# Stop and remove old container
docker stop servicenow-mcp-server
docker rm servicenow-mcp-server

# Start new container
docker run -d -p 3000:3000 \
  -e SERVICENOW_INSTANCE_URL=... \
  --name servicenow-mcp-server \
  nczitzer/mcp-servicenow-nodejs:latest
```

### View Logs

```bash
# Follow logs
docker logs -f servicenow-mcp-server

# Last 100 lines
docker logs --tail 100 servicenow-mcp-server
```

### Restart Container

```bash
docker restart servicenow-mcp-server
```

## 🚀 Production Deployment

### Kubernetes (k8s)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: servicenow-mcp-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: servicenow-mcp-server
  template:
    metadata:
      labels:
        app: servicenow-mcp-server
    spec:
      containers:
      - name: servicenow-mcp-server
        image: nczitzer/mcp-servicenow-nodejs:latest
        ports:
        - containerPort: 3000
        env:
        - name: SERVICENOW_INSTANCE_URL
          valueFrom:
            secretKeyRef:
              name: servicenow-credentials
              key: instance-url
        - name: SERVICENOW_USERNAME
          valueFrom:
            secretKeyRef:
              name: servicenow-credentials
              key: username
        - name: SERVICENOW_PASSWORD
          valueFrom:
            secretKeyRef:
              name: servicenow-credentials
              key: password
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
---
apiVersion: v1
kind: Service
metadata:
  name: servicenow-mcp-server
spec:
  selector:
    app: servicenow-mcp-server
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

### Docker Swarm

```bash
# Initialize swarm
docker swarm init

# Deploy stack
docker stack deploy -c docker-compose.yml servicenow-mcp
```

## 🐛 Troubleshooting

### Container Won't Start

```bash
# Check logs
docker logs servicenow-mcp-server

# Check environment variables
docker exec servicenow-mcp-server env

# Run interactively
docker run -it --rm \
  -e SERVICENOW_INSTANCE_URL=... \
  nczitzer/mcp-servicenow-nodejs:latest \
  sh
```

### Health Check Failing

```bash
# Test health endpoint manually
docker exec servicenow-mcp-server curl http://localhost:3000/health

# Check if server is running
docker exec servicenow-mcp-server ps aux
```

### Connection Issues

```bash
# Verify port mapping
docker port servicenow-mcp-server

# Test from host
curl http://localhost:3000/health

# Test from inside container
docker exec servicenow-mcp-server curl http://localhost:3000/health
```

## 📦 Available Tags

- `latest` - Latest stable release
- `2.1.1` - Specific version
- `2.1` - Minor version (auto-updates patch releases)
- `2` - Major version (auto-updates minor/patch releases)

## 🔗 Links

- **Docker Hub:** https://hub.docker.com/r/nczitzer/mcp-servicenow-nodejs
- **GitHub:** https://github.com/Happy-Technologies-LLC/mcp-servicenow-nodejs
- **npm:** https://www.npmjs.com/package/servicenow-mcp-server
- **MCP Registry:** https://registry.modelcontextprotocol.io/servers/io.github.nickzitzer/servicenow-nodejs

## 📄 License

MIT License - Copyright © 2025 Happy Technologies LLC
