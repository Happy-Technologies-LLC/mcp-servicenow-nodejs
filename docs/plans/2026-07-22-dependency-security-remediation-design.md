# Dependency Security Remediation Design

**Date:** 2026-07-22  
**Status:** Approved

## Problem

The `Test` GitHub Actions workflow for PR #49 fails its `security-audit` job. The initial `npm audit` reports seven vulnerable dependency nodes: four high, two moderate, and one low severity.

Six nodes have compatible patched releases. The seventh is `@hono/node-server`, introduced transitively by `@modelcontextprotocol/sdk` 1.25.0 and later. Downgrading the SDK to 1.24.3 removes Hono but exposes two high-severity SDK advisories: cross-client data leakage through 1.25.3 and ReDoS through 1.25.1. No official SDK release has a clean declared dependency graph: SDK 1.29.0 fixes its own advisories but still declares vulnerable `@hono/node-server` 1.x.

## Decision

Use the audited Node 20 dependency graph:

- Pin `@modelcontextprotocol/sdk` exactly to `1.29.0`, which fixes the SDK data-leak and ReDoS advisories.
- Pin Axios to `1.18.1`.
- Override only the SDK's transitive `@hono/node-server` dependency to exact version `2.0.11`.
- Refresh compatible transitive resolutions for `@babel/core`, `brace-expansion`, `fast-uri`, and `js-yaml` through npm's lockfile resolver.
- Require Node.js 20 or later because Hono 2.x does not support Node 18.
- Do not add audit suppressions or custom forks.

## Compatibility

No application source or MCP interface changes are planned. Existing stdio, SSE, OAuth, documentation, and per-call instance-routing behavior must remain unchanged.

Hono 2.0.11 preserves the `serve` and `getRequestListener` exports and signatures used by the SDK. The project's production paths do not import the SDK's packaged Hono example, but the override keeps that example resolvable. Raising the documented runtime minimum from Node 18 to Node 20 aligns the public contract with the repository's existing Node 20 and Node 22 test matrix.

## Verification

The remediation is accepted only when all of the following hold:

1. `npm audit --audit-level=low` reports zero vulnerabilities.
2. The full Jest suite passes.
3. Existing HTTP/SSE and stdio transport coverage passes.
4. The package tree contains `@modelcontextprotocol/sdk@1.29.0`, `@hono/node-server@2.0.11`, and Axios 1.18.1.
5. GitHub's Node 20, Node 22, dependency-audit, and CodeQL checks pass on PR #49.

## Documentation

Add an Unreleased security entry to `CHANGELOG.md` naming the remediated dependency classes without publishing exploit instructions. Keep the remediation in PR #49 so the blocked audit check validates the final feature branch.