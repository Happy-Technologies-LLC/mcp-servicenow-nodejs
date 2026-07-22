# Changelog

## Unreleased

### Added

- Optional per-call `instance` routing for every live ServiceNow operation except `SN-Set-Instance`, `SN-Get-Current-Instance`, and `SN-Docs-*`. Named routes use clients cached by instance name, preventing cross-instance and session-switch races without changing the session client's implicit target.

## 4.0.0 - 2026-07-16

### Breaking changes

- HTTP/SSE deployments on a non-loopback `HAPPY_MCP_BIND_HOST` must set `HAPPY_MCP_API_TOKEN`; clients must send it in `Authorization: Bearer <token>`.

### Added

- Per-user OAuth `authorization_code` authentication with PKCE and a loopback callback. Refresh tokens are stored in the operating system keychain under the current OS user and instance name.

### Contributors

- Thanks to [@cbonitz8](https://github.com/cbonitz8) for the authorization-code OAuth implementation in PR #43.

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

