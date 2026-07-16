# Project Funding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make company-directed Buy Me a Coffee and GitHub Sponsors links discoverable from the GitHub repository and npm package metadata.

> **Implementation note:** GitHub Sponsors was not configured for `Happy-Technologies-LLC`: its sponsor URL redirected to the organization profile on 2026-07-16. The shipped configuration therefore exposes only the verified Buy Me a Coffee route; add GitHub Sponsors only after the organization completes enrollment.

**Architecture:** GitHub reads `.github/FUNDING.yml` on the default branch to render its native Sponsor button. npm reads `package.json` funding metadata. The README contains one plain-text support link in its existing navigation, avoiding sponsor badges or duplicated calls to action.

**Tech Stack:** GitHub repository metadata, npm package metadata, Markdown.

---

### Task 1: Add canonical funding metadata

**Files:**
- Create: `.github/FUNDING.yml`
- Modify: `package.json:40-61`

**Step 1: Define the expected funding contract**

The repository must expose a GitHub funding entry for `Happy-Technologies-LLC` and a Buy Me a Coffee entry for `nickzitzer`. The npm package must expose the same two support URLs through its `funding` field.

**Step 2: Add GitHub funding configuration**

Create `.github/FUNDING.yml`:

```yaml
github: [Happy-Technologies-LLC]
buy_me_a_coffee: nickzitzer
```

**Step 3: Add npm funding metadata**

Insert after the `homepage` property in `package.json`:

```json
"funding": [
  {
    "type": "github",
    "url": "https://github.com/sponsors/Happy-Technologies-LLC"
  },
  {
    "type": "buy_me_a_coffee",
    "url": "https://buymeacoffee.com/nickzitzer"
  }
],
```

**Step 4: Validate the metadata**

Run:

```bash
node -e "const p = require('./package.json'); if (p.funding?.[1]?.url !== 'https://buymeacoffee.com/nickzitzer') process.exit(1)"
python3 -c "import yaml; d=yaml.safe_load(open('.github/FUNDING.yml')); assert d['github'] == ['Happy-Technologies-LLC']; assert d['buy_me_a_coffee'] == 'nickzitzer'"
```

Expected: both commands exit `0`.

**Step 5: Commit**

```bash
git add .github/FUNDING.yml package.json
git commit -m "feat: add project funding links"
```

### Task 2: Add an unobtrusive README support path

**Files:**
- Modify: `README.md:20-26`

**Step 1: Define the expected user-visible behavior**

The top navigation must link to the repository support section. The support section must identify the project as open source, direct contributors to the two official funding pages, and state that contributions support Happy Technologies LLC.

**Step 2: Add the navigation link**

Add `Support` after the existing `Contributing` link, separated by the existing pipe convention.

**Step 3: Add the support section**

Add this section immediately after the migration notice and before `## Features`:

```md
## Support

Happy MCP Server is open source. If it helps your team, support continued maintenance through [GitHub Sponsors](https://github.com/sponsors/Happy-Technologies-LLC) or [Buy Me a Coffee](https://buymeacoffee.com/nickzitzer). Contributions support Happy Technologies LLC.
```

**Step 4: Validate rendered-link inputs**

Run:

```bash
node -e "const fs = require('fs'); const r = fs.readFileSync('README.md', 'utf8'); for (const u of ['#support', 'https://github.com/sponsors/Happy-Technologies-LLC', 'https://buymeacoffee.com/nickzitzer']) if (!r.includes(u)) process.exit(1)"
```

Expected: exit `0`.

**Step 5: Commit**

```bash
git add README.md
git commit -m "docs: link project funding options"
```

### Task 3: Verify the release-facing metadata

**Files:**
- Verify: `.github/FUNDING.yml`, `package.json`, `README.md`

**Step 1: Validate package lock coherence**

Run:

```bash
npm install --package-lock-only --ignore-scripts
```

Expected: package lock remains unchanged because funding metadata does not affect dependency resolution.

**Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: all existing tests pass.

**Step 3: Inspect the final diff and push for review**

Run:

```bash
git diff origin/main...HEAD -- .github/FUNDING.yml package.json README.md
git push -u origin feat/project-funding
```

Expected: the diff contains only project-funding metadata and the concise README support path.
