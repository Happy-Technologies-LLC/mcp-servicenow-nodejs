import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ServiceNowClient } from './servicenow-client.js';
import { createMcpServer } from './mcp-server-consolidated.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export function validateHttpTransportSecurity({ host = '127.0.0.1', apiToken } = {}) {
  if (!LOOPBACK_HOSTS.has(host) && !apiToken) {
    throw new Error('HAPPY_MCP_API_TOKEN is required when HAPPY_MCP_BIND_HOST is not loopback');
  }
}

function createDefaultClient(instance) {
  const client = new ServiceNowClient(
    instance.url,
    instance.username,
    instance.password,
    {
      authType: instance.authType || 'basic',
      clientId: instance.clientId,
      clientSecret: instance.clientSecret,
      grantType: instance.grantType,
      scope: instance.scope
    }
  );
  client.currentInstanceName = instance.name;
  return client;
}

export function createHttpApp({
  defaultInstance,
  apiToken,
  keepaliveIntervalMs = 15000,
  listInstances = () => [{
    name: defaultInstance.name,
    url: defaultInstance.url,
    default: true,
    description: defaultInstance.description || ''
  }],
  createServiceNowClient = createDefaultClient,
  createMcpServer: createServer = createMcpServer,
  SSEServerTransport: Transport = SSEServerTransport
} = {}) {
  const app = express();
  const sessions = new Map();
  app.use(express.json());

  if (apiToken) {
    const expectedToken = Buffer.from(apiToken);
    app.use((req, res, next) => {
      const match = /^Bearer (.+)$/.exec(req.get('authorization') || '');
      const suppliedToken = match ? Buffer.from(match[1]) : null;
      if (!suppliedToken || suppliedToken.length !== expectedToken.length ||
        !timingSafeEqual(suppliedToken, expectedToken)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      next();
    });
  }

  app.get('/mcp', async (req, res) => {
    let keepaliveInterval;
    try {
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Connection', 'keep-alive');
      req.setTimeout(0);
      res.setTimeout(0);

      const transport = new Transport('/mcp', res);
      const serviceNowClient = createServiceNowClient(defaultInstance);
      const server = await createServer(serviceNowClient);
      const cleanup = () => {
        clearInterval(keepaliveInterval);
        sessions.delete(transport.sessionId);
      };

      keepaliveInterval = setInterval(() => {
        res.write(': keepalive\n\n');
      }, keepaliveIntervalMs);
      transport.onclose = cleanup;
      req.on('close', cleanup);
      req.on('error', cleanup);

      sessions.set(transport.sessionId, { server, transport });
      await server.connect(transport);
    } catch (error) {
      console.error('Error establishing SSE connection:', error.message);
      clearInterval(keepaliveInterval);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to establish SSE connection' });
      }
    }
  });

  app.post('/mcp', async (req, res) => {
    try {
      const session = sessions.get(req.query.sessionId);
      if (!session) {
        return res.status(400).json({ error: 'Invalid or missing session ID' });
      }
      await session.transport.handlePostMessage(req, res, req.body);
    } catch (error) {
      console.error('Error handling POST message:', error.message);
      res.status(500).json({ error: 'Failed to process message' });
    }
  });

  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      servicenow_instance: defaultInstance.url,
      instance_name: defaultInstance.name,
      timestamp: new Date().toISOString()
    });
  });

  app.get('/instances', (req, res) => {
    res.json({ instances: listInstances() });
  });

  return app;
}
