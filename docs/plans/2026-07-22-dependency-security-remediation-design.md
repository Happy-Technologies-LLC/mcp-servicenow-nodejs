# Dependency Security Remediation Design

**Date:** 2026-07-22  
**Status:** Approved

## Problem

The `Test` GitHub Actions workflow for PR #49 fails its `security-audit` job. `npm audit` reports seven vulnerable dependency nodes: four high, two moderate, and one low severity.

Six nodes have compatible patched releases. The seventh is `@hono/node-server`, introduced transitively by `@modelcontextprotocol/sdk` 1.25.0 and later. The MCP SDK's latest release, 1.29.0, still declares vulnerable `@hono/node-server` 1.x. Forcing Hono 2.x would violate the SDK's declared dependency range.

## Decision

Use the supported dependency graph:

- Pin `@modelcontextprotocol/sdk` exactly to `1.24.3`, the last release before the vulnerable Hono dependency was introduced.
- Upgrade Axios to `1.18.1`.
- Refresh compatible transitive resolutions for `@babel/core`, `brace-expansion`, `fast-uri`, and `js-yaml` through npm's lockfile resolver.
- Do not add npm overrides, audit suppressions, or custom forks.

## Compatibility

No application source or MCP interface changes are planned. Existing stdio, SSE, OAuth, documentation, and per-call instance-routing behavior must remain unchanged.

The SDK pin is exact so a future install cannot silently resolve to an affected 1.25.0-or-later release. A later SDK upgrade is appropriate only after its supported dependency graph no longer contains the affected Hono line.

## Verification

The remediation is accepted only when all of the following hold:

1. `npm audit --audit-level=low` reports zero vulnerabilities.
2. The full Jest suite passes.
3. Existing HTTP/SSE and stdio transport coverage passes.
4. The package tree contains `@modelcontextprotocol/sdk@1.24.3` and no `@hono/node-server` package.
5. GitHub's Node 20, Node 22, and CodeQL checks pass on PR #49.

## Documentation

Add an Unreleased security entry to `CHANGELOG.md` naming the remediated dependency classes without publishing exploit instructions. Keep the remediation in PR #49 so the blocked audit check validates the final feature branch.