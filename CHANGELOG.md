# Changelog

## 3.3.0 - 2026-07-16

### Security

- HTTP transport now listens on loopback by default. A non-loopback `HAPPY_MCP_BIND_HOST` requires `HAPPY_MCP_API_TOKEN`.
- Each SSE connection now receives its own ServiceNow client, preventing instance and credential state from crossing sessions.

### Fixed

- ServiceNow REST failures now include the response body's message and detail.

### Dependencies

- Updated `express` to `5.2.1`, `form-data` to `4.0.6`, and `hono` to `4.12.30`.

### Contributors

- Thanks to [@OlmsteadNick](https://github.com/OlmsteadNick) for diagnosing and proposing the REST error detail improvement in #39 and PR #42.
- Thanks to [@dependabot](https://github.com/dependabot) for the dependency update alerts in PR #37 and PR #38.

## 3.2.3 - 2026-05-14

- Added env-only OAuth `client_credentials` support through `SERVICENOW_OAUTH_GRANT_TYPE`.
- Updated transitive dependencies: `hono` to `4.12.18` and `fast-uri` to `3.1.2`.
- Thanks to [@davidkarlsen](https://github.com/davidkarlsen) for contributing the OAuth grant-type support in PR #32.

