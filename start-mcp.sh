#!/usr/bin/env bash
set -euo pipefail

: "${SERVICENOW_INSTANCE_URL:?Set SERVICENOW_INSTANCE_URL before starting the MCP server}"
: "${SERVICENOW_USERNAME:?Set SERVICENOW_USERNAME before starting the MCP server}"
: "${SERVICENOW_PASSWORD:?Set SERVICENOW_PASSWORD before starting the MCP server}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$script_dir/src/stdio-server.js"
