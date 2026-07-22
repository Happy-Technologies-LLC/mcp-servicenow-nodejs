# Dependency Security Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make PR #49's dependency audit pass with zero known vulnerabilities while preserving all current MCP transports and per-call instance routing.

**Architecture:** Retain the repository's npm dependency model. Exact-pin the supported MCP SDK release before its vulnerable Hono dependency was introduced, upgrade Axios to its patched release, and let npm refresh compatible patched transitive packages. Do not use overrides, audit suppressions, or application-source changes.

**Tech Stack:** Node.js, npm lockfile v3, Jest, GitHub Actions.

---

### Task 1: Update the supported dependency graph

**Files:**
- Modify: `package.json:24-31`
- Modify: `package-lock.json`

**Step 1: Confirm the failing security baseline**

Run:

```bash
npm audit --audit-level=low
```

Expected: exit 1 with seven vulnerable nodes, including `@hono/node-server`, Axios, Babel, brace-expansion, fast-uri, and js-yaml.

**Step 2: Install the approved direct versions**

Run:

```bash
npm install --save-exact @modelcontextprotocol/sdk@1.24.3 axios@1.18.1
```

Expected: `package.json` contains exact versions `1.24.3` and `1.18.1`; npm updates the lockfile.

**Step 3: Refresh compatible patched transitive packages**

Run:

```bash
npm audit fix
```

Expected: npm upgrades compatible transitive resolutions without adding overrides or changing application source.

**Step 4: Inspect the dependency diff**

Run:

```bash
git diff -- package.json package-lock.json
```

Expected: only dependency version and lockfile resolution changes; no scripts, metadata, or unrelated package changes.

**Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "fix(security): remediate npm advisories"
```

### Task 2: Prove the dependency graph is clean

**Files:**
- Verify: `package.json`
- Verify: `package-lock.json`

**Step 1: Run the strict audit**

Run:

```bash
npm audit --audit-level=low
```

Expected: exit 0 and zero vulnerabilities.

**Step 2: Verify the resolved packages**

Run:

```bash
npm ls @modelcontextprotocol/sdk @hono/node-server axios @babel/core brace-expansion fast-uri js-yaml
```

Expected: MCP SDK resolves to `1.24.3`, Axios resolves to `1.18.1`, no `@hono/node-server` is installed, and all remaining listed transitive packages resolve to patched versions.

### Task 3: Verify transport and feature compatibility

**Files:**
- Verify: `tests/http-server.test.js`
- Verify: `tests/mcp-instance-routing.test.js`
- Verify: existing project test suite

**Step 1: Run focused transport and routing coverage**

Run:

```bash
npm test -- tests/http-server.test.js tests/mcp-instance-routing.test.js --runInBand
```

Expected: all HTTP/SSE and per-call routing tests pass.

**Step 2: Run the full test suite**

Run:

```bash
npm test -- --runInBand
```

Expected: all suites pass with no regression in stdio, SSE, OAuth, resource, documentation, or routing behavior.

**Step 3: Review the final implementation diff**

Run:

```bash
git diff main...HEAD -- package.json package-lock.json src tests
```

Expected: the security-remediation commits modify only dependency manifests; the earlier routing source and tests remain unchanged.

**Step 4: Push PR #49 and verify GitHub checks**

Run:

```bash
git push origin feat/per-call-instance-routing
```

Expected: Node 20, Node 22, dependency audit, and CodeQL checks pass on PR #49. Any failure must be investigated before merge.