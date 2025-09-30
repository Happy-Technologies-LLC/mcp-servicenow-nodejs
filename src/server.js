import express from 'express';
import dotenv from 'dotenv';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ServiceNowClient } from './servicenow-client.js';
import { createMcpServer } from './mcp-server-consolidated.js';
import { configManager } from './config-manager.js';

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());

// In-memory session store (sessionId -> {server, transport})
const sessions = {};

// Get default instance configuration
const defaultInstance = configManager.getDefaultInstance();
console.log(`🔗 Default ServiceNow instance: ${defaultInstance.name} (${defaultInstance.url})`);
console.log(`💡 Use SN-Set-Instance tool to switch instances during session`);

// Create ServiceNow client with default instance
const serviceNowClient = new ServiceNowClient(
  defaultInstance.url,
  defaultInstance.username,
  defaultInstance.password
);
serviceNowClient.currentInstanceName = defaultInstance.name;

/**
 * GET /mcp - Establish SSE connection
 */
app.get('/mcp', async (req, res) => {
  try {
    // Create transport and start SSE connection
    const transport = new SSEServerTransport('/mcp', res);

    // Create and configure new MCP server instance
    const server = await createMcpServer(serviceNowClient);

    // Set up transport cleanup
    transport.onclose = () => {
      if (sessions[transport.sessionId]) {
        delete sessions[transport.sessionId];
        console.log(`🧹 Cleaned up session ${transport.sessionId}`);
      }
    };

    // Store the session
    sessions[transport.sessionId] = { server, transport };
    console.log(`🔗 New session established: ${transport.sessionId}`);

    // Connect server to transport and start SSE
    await server.connect(transport);
    await transport.start();

  } catch (error) {
    console.error('❌ Error establishing SSE connection:', error);
    res.status(500).json({ error: 'Failed to establish SSE connection' });
  }
});

/**
 * POST /mcp - Handle JSON-RPC messages
 */
app.post('/mcp', async (req, res) => {
  try {
    const sessionId = req.query.sessionId;

    if (!sessionId || !sessions[sessionId]) {
      return res.status(400).json({
        error: 'Invalid or missing session ID'
      });
    }

    const { transport } = sessions[sessionId];
    await transport.handlePostMessage(req, res);

  } catch (error) {
    console.error('❌ Error handling POST message:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    servicenow_instance: defaultInstance.url,
    instance_name: defaultInstance.name,
    timestamp: new Date().toISOString()
  });
});

// List available instances endpoint
app.get('/instances', (req, res) => {
  try {
    const instances = configManager.listInstances();
    res.json({ instances });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ServiceNow MCP Server listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);

  console.log(`Available instances: http://localhost:${PORT}/instances`);

  if (process.env.DEBUG === 'true') {
    console.log('Debug mode enabled');
    console.log(`Active ServiceNow instance: ${defaultInstance.name} - ${defaultInstance.url}`);
  }
});