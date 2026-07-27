/**
 * Happy MCP Server - Express HTTP Server
 *
 * Copyright (c) 2025 Happy Technologies LLC
 * Licensed under the MIT License - see LICENSE file for details
 */

import dotenv from 'dotenv';
import { configManager } from './config-manager.js';
import { createHttpApp, validateHttpTransportSecurity } from './http-server.js';
import { InstanceCredentialStore } from './instance-credential-store.js';

dotenv.config();

const port = Number(process.env.PORT || 3000);
const host = process.env.HAPPY_MCP_BIND_HOST || '127.0.0.1';
const apiToken = process.env.HAPPY_MCP_API_TOKEN;
const credentialStore = new InstanceCredentialStore();
const keepaliveIntervalMs = Number(process.env.SSE_KEEPALIVE_INTERVAL || 15000);

validateHttpTransportSecurity({ host, apiToken });

const defaultInstance = configManager.getDefaultInstance();
console.log(`Default ServiceNow instance: ${defaultInstance.name} (${defaultInstance.url})`);

const app = createHttpApp({
  defaultInstance,
  apiToken,
  configManager,
  instanceRegistry: configManager.registry,
  credentialStore,
  keepaliveIntervalMs,
  listInstances: () => configManager.listInstances()
});

app.listen(port, host, () => {
  console.log(`Happy MCP Server listening on http://${host}:${port}`);
  console.log(`Health check: http://${host}:${port}/health`);
  console.log(`MCP SSE endpoint: http://${host}:${port}/mcp`);
  console.log(`Available instances: http://${host}:${port}/instances`);

  if (process.env.DEBUG === 'true') {
    console.log(`Active ServiceNow instance: ${defaultInstance.name} - ${defaultInstance.url}`);
  }
});
