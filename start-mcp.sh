#!/bin/bash
cd /Users/nczitzer/WebstormProjects/mcp-servicenow-nodejs
export SERVICENOW_INSTANCE_URL=https://dev276360.service-now.com
export SERVICENOW_USERNAME=admin
export SERVICENOW_PASSWORD='$h4fG+9nAGeU'
export SERVICENOW_AUTH_TYPE=basic
node src/stdio-server.js