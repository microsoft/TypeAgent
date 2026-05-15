# TypeAgent Development Container

This devcontainer provides a fully configured development environment for TypeAgent with all required tools and dependencies.

## Prerequisites

### Windows

- **Docker Desktop** with WSL 2 backend enabled
- **VS Code** with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
- Recommended: Run `ts/tools/scripts/setup-devcontainer.ps1` to verify prerequisites

### macOS / Linux

- **Docker Desktop** or Docker Engine
- **VS Code** with the Dev Containers extension

### GitHub Codespaces

No local prerequisites - works directly in browser or VS Code.

## Quick Start

1. Open the TypeAgent folder in VS Code
2. When prompted "Reopen in Container", click **Reopen in Container**
   - Or use Command Palette: `Dev Containers: Reopen in Container`
3. Wait for the container to build (first time takes 5-10 minutes)
4. Once ready, open a terminal and run:
   ```bash
   cd ts
   pnpm run build
   ```

## Container Configurations

### Standard (`devcontainer.json`)

Default configuration for most development work. Includes:

- Node.js 22, Python 3.12, .NET 8.0
- pnpm package manager
- Azure CLI, GitHub CLI
- Claude Code

**Note:** The Electron shell requires GUI support. To use the shell with devcontainer, you need to start teh agent-server in the container and run the shell on your host machine. The agent server port is forwarded to the host, so the shell will connect correctly:

```bash
# In container - start the backend
pnpm run server

# On host machine - run the Electron shell
cd ts && pnpm run shell
```

## Working with the Container

### Common Commands

```bash
cd ts                    # Navigate to TypeScript workspace
pnpm run build           # Build all packages
pnpm run cli             # Run the CLI
pnpm run test:local      # Run unit tests
pnpm run start:agent-server          # Start agent server
```

## Using with AI Agents

### Claude Code

Claude Code is pre-installed in the container:

```bash
claude                   # Start interactive session
claude "your prompt"     # Run with a prompt
```

### Parallel Agent Development with Worktrees

Run multiple AI agents in parallel using git worktrees:

```bash
# Create a worktree for an agent
../scripts/agent-worktree.sh feature-name

# This creates:
#   ../agent-feature-name/     - isolated working directory
#   ../agent-feature-name/ts/  - TypeScript workspace

# Clean up when done
../scripts/agent-worktree.sh --cleanup feature-name
```

Each worktree shares the git history but has independent:

- Working directory and file changes
- Node modules (via pnpm's content-addressable store)
- Branch state

## Forwarded Ports

| Port | Service                         |
| ---- | ------------------------------- |
| 3000 | API Server (HTTP)               |
| 3443 | API Server (HTTPS)              |
| 8999 | Agent Server (WebSocket)        |
| 8081 | Browser Agent (WebSocket)       |
| 8082 | Code Agent (WebSocket)          |
| 6080 | noVNC Desktop (VNC config only) |

## Troubleshooting

### Container fails to start

1. Ensure Docker Desktop is running
2. Try rebuilding: `Dev Containers: Rebuild Container`
3. Check Docker has sufficient resources (4 CPU, 8GB RAM minimum)

### pnpm install fails

```bash
# Clear pnpm cache and retry
pnpm store prune
pnpm install
```

### `EACCES` / permission denied on `ts/node_modules` during `pnpm install`

The devcontainer mounts a Docker named volume at `ts/node_modules` (and at the pnpm
global store). Docker creates these mount points owned by `root:root`, but the
container runs as the non-root `codespace` user, which causes `pnpm install` to
fail with permission errors on a fresh container.

The `post-create.sh` script automatically `chown`s these paths to `codespace`
on first launch. If you hit this manually, run:

```bash
sudo chown -R codespace:codespace \
    /workspaces/TypeAgent/ts/node_modules \
    /home/codespace/.local/share/pnpm \
    /home/codespace/.claude
cd /workspaces/TypeAgent/ts && pnpm install
```

### Permission errors

The container runs as the `codespace` user. If you encounter permission issues:

```bash
sudo chown -R codespace:codespace /workspaces/TypeAgent
```

### Line ending issues (Windows)

If scripts fail with `\r': command not found`, the repository may have CRLF line endings. Fix with:

```bash
git config core.autocrlf input
git rm --cached -r .
git reset --hard
```

## Rebuilding the Container

To rebuild with fresh state:

1. Command Palette: `Dev Containers: Rebuild Container`

To rebuild without cache:

1. Command Palette: `Dev Containers: Rebuild Container Without Cache`

## Resources

- [VS Code Dev Containers](https://code.visualstudio.com/docs/devcontainers/containers)
- [GitHub Codespaces](https://docs.github.com/en/codespaces)
- [TypeAgent Documentation](../ts/README.md)
