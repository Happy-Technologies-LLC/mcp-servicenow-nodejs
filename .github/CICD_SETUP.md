# CI/CD Setup Guide

This project uses GitHub Actions for automated publishing to npm and Docker Hub.

## Required Secrets

Configure the following secrets in your GitHub repository settings:

### npm Publishing
1. **NPM_TOKEN**
   - Go to https://www.npmjs.com/settings/YOUR_USERNAME/tokens
   - Create a new "Automation" token
   - Copy the token and add it to GitHub Secrets as `NPM_TOKEN`

### Docker Hub Publishing
1. **DOCKERHUB_USERNAME**
   - Your Docker Hub username
   - Add to GitHub Secrets

2. **DOCKERHUB_TOKEN**
   - Go to https://hub.docker.com/settings/security
   - Create a new access token with "Read, Write, Delete" permissions
   - Copy the token and add it to GitHub Secrets as `DOCKERHUB_TOKEN`

## Workflows

### 1. Publish Workflow (`publish.yml`)

**Triggers:**
- Push to `main` branch when:
  - `package.json` changes
  - Files in `src/` change
  - `Dockerfile` changes
- Manual dispatch via GitHub Actions UI

**Behavior:**
- Only publishes when `package.json` version number changes
- Runs tests before publishing
- Performs security audit
- Publishes to npm with provenance
- Publishes to Docker Hub (multi-platform: amd64, arm64)
- Creates GitHub Release with tag
- Updates Docker Hub repository description

**Version Strategy:**
- Automatically detects version from `package.json`
- Creates tags: `v2.1.5`, `2.1`, `2`, `latest`
- Only publishes if version number increased

### 2. Security Patch Workflow (`security-patch.yml`)

**Triggers:**
- Push to `main` branch when `package-lock.json` changes
- Merged PRs with "security" in the title

**Behavior:**
- Checks for vulnerabilities using `npm audit`
- Automatically applies `npm audit fix` if vulnerabilities found
- Bumps patch version
- Runs tests to ensure nothing breaks
- Creates a pull request for review

## Publishing a New Version

### Automated (Recommended for patches)

For security patches, the system auto-detects and can auto-patch:

1. Vulnerabilities are detected
2. Security workflow creates a PR with fixes
3. Review and merge the PR
4. Version is auto-bumped
5. Publish workflow triggers on merge to main

### Manual Version Bump

1. Update the version in `package.json`:
   ```bash
   npm version patch  # 2.1.5 -> 2.1.6
   npm version minor  # 2.1.5 -> 2.2.0
   npm version major  # 2.1.5 -> 3.0.0
   ```

2. Commit and push to `main`:
   ```bash
   git add package.json package-lock.json
   git commit -m "chore: bump version to X.Y.Z"
   git push origin main
   ```

3. GitHub Actions automatically:
   - Runs tests
   - Publishes to npm
   - Builds and pushes Docker images
   - Creates GitHub release

## Docker Image Tags

The Docker image is published with multiple tags:

- `latest` - Always points to the newest version
- `2.1.5` - Full semantic version
- `2.1` - Minor version (gets updated on patches)
- `2` - Major version (gets updated on minor/patch)

Example usage:
```bash
# Always get the latest
docker pull USERNAME/servicenow-mcp-server:latest

# Pin to specific version
docker pull USERNAME/servicenow-mcp-server:2.1.5

# Pin to minor version (receives patches)
docker pull USERNAME/servicenow-mcp-server:2.1
```

## Setting Up Secrets

### Via GitHub UI
1. Go to repository Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Add each secret from the list above

### Via GitHub CLI
```bash
# Set npm token
gh secret set NPM_TOKEN

# Set Docker Hub credentials
gh secret set DOCKERHUB_USERNAME
gh secret set DOCKERHUB_TOKEN
```

## Workflow Status

Check workflow status:
```bash
# List recent workflow runs
gh run list

# View specific run
gh run view RUN_ID

# Watch a running workflow
gh run watch
```

## Troubleshooting

### npm Publish Fails
- Verify `NPM_TOKEN` is set and valid
- Ensure version number increased
- Check package name is available on npm
- Verify you have publish permissions

### Docker Push Fails
- Verify `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` are set
- Ensure Docker Hub repository exists
- Check token has Read, Write, Delete permissions
- Verify repository name matches in workflow

### Tests Fail
- Workflows will not publish if tests fail
- Fix tests locally first
- Push fix to main

### Version Not Detected
- Ensure `package.json` version field changed
- Git diff must show version change
- Use `npm version` command to ensure consistency

## Security Best Practices

1. **Use Automation Tokens**: Use dedicated automation tokens, not personal access tokens
2. **Rotate Tokens**: Rotate tokens every 90 days
3. **Minimal Permissions**: Grant only necessary permissions
4. **Monitor Runs**: Regularly check workflow run logs
5. **Security Scanning**: Workflows include automated security audits

## Multi-Platform Docker Builds

The workflow builds for both amd64 and arm64 architectures:
- Works on Intel/AMD servers
- Works on Apple Silicon (M1/M2/M3)
- Works on ARM servers

Build cache is enabled for faster builds.

## Future Enhancements

Potential additions:
- [ ] Automated dependency updates via Dependabot
- [ ] Integration tests in CI
- [ ] Performance benchmarking
- [ ] Automated changelog generation
- [ ] Slack/Discord notifications on publish
- [ ] Rollback mechanism for failed deploys
