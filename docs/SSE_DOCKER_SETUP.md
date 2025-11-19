# SSE (Server-Sent Events) Setup Guide for Docker

**Problem:** SSE connections dropping in Docker environments
**Solution:** Keepalive heartbeat + proper configuration
**Version:** 2.1.4+

---

## 🔍 Root Cause

SSE connections drop in Docker due to:

1. **Proxy/Load Balancer Timeouts** - nginx, HAProxy, etc. timeout idle connections
2. **Docker Network Timeouts** - Docker networking kills idle connections
3. **Missing Keepalive** - No heartbeat to keep connection alive
4. **Buffering Issues** - Proxies buffer SSE events, breaking the stream

---

## ✅ Fixed in v2.1.4

The ServiceNow MCP Server now includes:

- ✅ **Automatic keepalive heartbeat** (every 15 seconds by default)
- ✅ **Disabled timeouts** for SSE endpoint (infinite connection)
- ✅ **Proxy-friendly headers** (`X-Accel-Buffering: no`)
- ✅ **Connection monitoring** with automatic cleanup
- ✅ **Configurable keepalive interval** via environment variable

---

## 🚀 Quick Start (Docker)

### 1. Basic Docker Run

```bash
docker run -d \
  --name servicenow-mcp \
  -p 3000:3000 \
  -e SERVICENOW_INSTANCE_URL=https://dev12345.service-now.com \
  -e SERVICENOW_USERNAME=admin \
  -e SERVICENOW_PASSWORD=password \
  -e SSE_KEEPALIVE_INTERVAL=15000 \
  nczitzer/mcp-servicenow-nodejs:latest
```

### 2. Docker Compose

```yaml
version: '3.8'

services:
  servicenow-mcp-server:
    image: nczitzer/mcp-servicenow-nodejs:latest
    container_name: servicenow-mcp-server
    ports:
      - "3000:3000"
    environment:
      - SERVICENOW_INSTANCE_URL=${SERVICENOW_INSTANCE_URL}
      - SERVICENOW_USERNAME=${SERVICENOW_USERNAME}
      - SERVICENOW_PASSWORD=${SERVICENOW_PASSWORD}

      # SSE Configuration (optional)
      - SSE_KEEPALIVE_INTERVAL=15000  # 15 seconds (default)

    volumes:
      - ./config/servicenow-instances.json:/app/config/servicenow-instances.json:ro
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
```

### 3. Test the Connection

```bash
# Terminal 1: Start server
docker-compose up

# Terminal 2: Test SSE connection
curl -N http://localhost:3000/mcp

# You should see keepalive comments every 15 seconds:
# : keepalive
#
# : keepalive
#
```

---

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `SSE_KEEPALIVE_INTERVAL` | Keepalive interval in milliseconds | `15000` | `10000` |
| `PORT` | HTTP server port | `3000` | `8080` |
| `DEBUG` | Enable debug logging | `false` | `true` |

### Recommended Settings

**Default (15 seconds)** - Works for most environments:
```bash
SSE_KEEPALIVE_INTERVAL=15000
```

**Behind aggressive proxies (10 seconds):**
```bash
SSE_KEEPALIVE_INTERVAL=10000
```

**Low-latency networks (30 seconds):**
```bash
SSE_KEEPALIVE_INTERVAL=30000
```

**⚠️ DO NOT set below 5 seconds** - Creates unnecessary network traffic

---

## 🔧 Reverse Proxy Configuration

### nginx

**Problem:** nginx buffers responses by default, breaking SSE

**Solution:** Disable buffering for `/mcp` endpoint

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location /mcp {
        proxy_pass http://servicenow-mcp:3000;

        # SSE-specific settings
        proxy_buffering off;              # Disable buffering
        proxy_cache off;                  # Disable caching
        proxy_read_timeout 86400s;        # 24 hours
        proxy_connect_timeout 60s;

        # Required headers
        proxy_set_header Connection '';
        proxy_set_header Cache-Control 'no-cache';
        proxy_set_header X-Accel-Buffering 'no';

        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # HTTP/1.1 for SSE
        proxy_http_version 1.1;
    }

    # Health check endpoint (buffered is OK)
    location /health {
        proxy_pass http://servicenow-mcp:3000;
    }
}
```

### Traefik

```yaml
http:
  routers:
    servicenow-mcp:
      rule: "Host(`your-domain.com`)"
      service: servicenow-mcp

  services:
    servicenow-mcp:
      loadBalancer:
        servers:
          - url: "http://servicenow-mcp:3000"
        # Disable buffering
        responseForwarding:
          flushInterval: "1s"
```

### HAProxy

```conf
frontend http_front
    bind *:80
    default_backend servicenow_mcp

backend servicenow_mcp
    server mcp1 servicenow-mcp:3000 check

    # SSE configuration
    timeout server 86400s
    timeout tunnel 86400s
    option http-server-close
    option forwardfor
```

---

## 🐛 Troubleshooting

### Connection Still Dropping?

**1. Check keepalive logs:**
```bash
docker logs servicenow-mcp-server

# Look for:
# 🔗 New session established: <session-id>
# 💓 SSE keepalive interval: 15000ms
```

**2. Monitor connection:**
```bash
# Watch SSE stream
curl -N http://localhost:3000/mcp

# You should see keepalive comments every 15 seconds
```

**3. Test with shorter interval:**
```bash
docker run -e SSE_KEEPALIVE_INTERVAL=5000 ...
```

**4. Check proxy timeouts:**
```bash
# nginx
grep timeout /etc/nginx/nginx.conf

# Look for:
# proxy_read_timeout 60s;  # INCREASE THIS
```

### Common Issues

**Problem:** Connection drops after exactly 60 seconds
**Cause:** nginx default `proxy_read_timeout 60s`
**Solution:** Set `proxy_read_timeout 86400s;` in nginx config

**Problem:** Connection drops after 2 minutes
**Cause:** Docker network idle timeout
**Solution:** Reduce `SSE_KEEPALIVE_INTERVAL` to 10 seconds

**Problem:** No data received, connection hangs
**Cause:** Proxy buffering enabled
**Solution:** Add `proxy_buffering off;` to nginx config

**Problem:** Works locally, fails in production
**Cause:** Load balancer timeout
**Solution:** Configure load balancer timeout > keepalive interval

---

## 📊 Connection Monitoring

### Server-Side Logs

```bash
# Watch connection events
docker logs -f servicenow-mcp-server

# Output:
🔗 New session established: abc123
💓 SSE keepalive interval: 15000ms
🔌 Client disconnected: abc123
🧹 Cleaned up session abc123
```

### Client-Side Testing

**Test script (test-sse.js):**
```javascript
const EventSource = require('eventsource');

const url = 'http://localhost:3000/mcp';
const es = new EventSource(url);

let keepaliveCount = 0;

es.onopen = () => {
  console.log('✅ Connected to SSE');
};

es.onerror = (error) => {
  console.error('❌ SSE Error:', error);
};

es.onmessage = (event) => {
  if (event.data === 'keepalive') {
    keepaliveCount++;
    console.log(`💓 Keepalive received (${keepaliveCount})`);
  } else {
    console.log('📨 Message:', event.data);
  }
};

// Exit after 2 minutes
setTimeout(() => {
  console.log(`\n📊 Total keepalives: ${keepaliveCount}`);
  console.log('✅ Connection stable!');
  es.close();
  process.exit(0);
}, 120000);
```

**Run test:**
```bash
npm install eventsource
node test-sse.js

# Expected output:
# ✅ Connected to SSE
# 💓 Keepalive received (1)
# 💓 Keepalive received (2)
# ...
# 📊 Total keepalives: 8
# ✅ Connection stable!
```

---

## 🔍 Advanced Configuration

### Multiple Instances Behind Load Balancer

```yaml
version: '3.8'

services:
  servicenow-mcp-1:
    image: nczitzer/mcp-servicenow-nodejs:latest
    environment:
      - SSE_KEEPALIVE_INTERVAL=10000

  servicenow-mcp-2:
    image: nczitzer/mcp-servicenow-nodejs:latest
    environment:
      - SSE_KEEPALIVE_INTERVAL=10000

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - servicenow-mcp-1
      - servicenow-mcp-2
```

**nginx.conf for load balancing:**
```nginx
upstream servicenow_mcp {
    # Sticky sessions for SSE (hash by IP)
    ip_hash;

    server servicenow-mcp-1:3000;
    server servicenow-mcp-2:3000;
}

server {
    listen 80;

    location /mcp {
        proxy_pass http://servicenow_mcp;
        proxy_buffering off;
        proxy_read_timeout 86400s;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
    }
}
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: servicenow-mcp
spec:
  replicas: 2
  selector:
    matchLabels:
      app: servicenow-mcp
  template:
    metadata:
      labels:
        app: servicenow-mcp
    spec:
      containers:
      - name: servicenow-mcp
        image: nczitzer/mcp-servicenow-nodejs:latest
        ports:
        - containerPort: 3000
        env:
        - name: SSE_KEEPALIVE_INTERVAL
          value: "10000"
        - name: SERVICENOW_INSTANCE_URL
          valueFrom:
            secretKeyRef:
              name: servicenow-creds
              key: instance-url
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: servicenow-mcp
spec:
  selector:
    app: servicenow-mcp
  ports:
  - port: 3000
    targetPort: 3000
  sessionAffinity: ClientIP  # Important for SSE!
```

---

## 📚 Technical Details

### SSE Keepalive Implementation

The server sends SSE comments (lines starting with `:`) at regular intervals:

```
: keepalive

: keepalive

: keepalive
```

These comments:
- ✅ Keep TCP connection alive
- ✅ Prevent proxy timeouts
- ✅ Don't trigger client events (invisible to app)
- ✅ Follow SSE specification (RFC 6202)

### Connection Lifecycle

1. **Client connects** → `GET /mcp`
2. **Server responds** → Sets SSE headers, disables timeouts
3. **Transport starts** → MCP server connects to SSE transport
4. **Keepalive begins** → Interval sends comments every N seconds
5. **Client disconnects** → Cleanup interval, delete session

### Performance Impact

**Network overhead:**
- Default (15s): ~4 keepalives/minute = ~240 bytes/min
- Aggressive (5s): ~12 keepalives/minute = ~720 bytes/min

**Recommendation:** Use default 15 seconds unless experiencing drops

---

## ✅ Best Practices

1. **Use default 15-second keepalive** unless you have specific timeout issues
2. **Configure proxy timeouts** > keepalive interval (e.g., 86400s for 24 hours)
3. **Enable session affinity** (sticky sessions) for load balancers
4. **Monitor connection logs** to detect issues early
5. **Test with curl** before deploying production clients
6. **Use Docker health checks** to verify server availability

---

## 🆘 Getting Help

**Connection issues?**
1. Check server logs: `docker logs servicenow-mcp-server`
2. Test with curl: `curl -N http://localhost:3000/mcp`
3. Verify keepalive: Look for `: keepalive` comments
4. Check proxy config: Ensure buffering disabled

**Still having problems?**
- GitHub Issues: https://github.com/Happy-Technologies-LLC/mcp-servicenow-nodejs/issues
- Include: Server logs, proxy config, keepalive interval

---

## 📖 References

- **SSE Specification:** https://html.spec.whatwg.org/multipage/server-sent-events.html
- **MCP SSE Transport:** https://spec.modelcontextprotocol.io/specification/basic/transports/#server-sent-events-sse
- **nginx SSE Guide:** https://www.nginx.com/blog/event-driven-data-management-nginx/

---

**Version:** 2.1.4
**Updated:** 2025-11-19
**Author:** Happy Technologies LLC
