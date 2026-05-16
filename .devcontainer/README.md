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

**Note:** The Electron shell requires GUI support. To use the shell with devcontainer, you need to start the agent-server in the container and run the shell on your host machine. The agent server port is forwarded to the host, so the shell will connect correctly:

```bash
# In container - start the backend
pnpm run server

# On host machine - run the Electron shell
cd ts && pnpm run shell
```

## Working with the Container

### SSH Access

The universal devcontainer image includes an SSH server. To set up key-based
access from your host machine, run:

```bash
.devcontainer/scripts/setup-ssh-access.sh
```

The script will:

- create `~/.ssh/typeagent-devcontainer` if it does not already exist
- find the running TypeAgent devcontainer from Docker labels
- add the public key to `~/.ssh/authorized_keys` for the `codespace` user in the container
- add or update an SSH config entry named `typeagent-devcontainer`
- enforce key-only SSH auth in both client config and container sshd settings
- use `StrictHostKeyChecking accept-new` by default
- when run in WSL, also detect your Windows `%USERPROFILE%/.ssh` directory
- copy the same keypair into Windows `~/.ssh` so Windows OpenSSH can use it directly
- add or update the same `typeagent-devcontainer` host entry in Windows SSH config
- use Windows-native paths for the copied key and `known_hosts` entry in that Windows config

By default, generated SSH config uses `StrictHostKeyChecking accept-new`.
For local-only workflows where you intentionally want host key checks disabled,
use:

```bash
.devcontainer/scripts/setup-ssh-access.sh --insecure-local
```

After it completes, connect with:

```bash
ssh typeagent-devcontainer
```

If you use a non-default devcontainer config, pass it explicitly:

```bash
.devcontainer/scripts/setup-ssh-access.sh --config .devcontainer/vnc/devcontainer.json
```

### One-Command Start (and Optional SSH Setup)

Use this wrapper to start the devcontainer from the command line. If your
VS Code agent window only supports tunnel/SSH connections, pass `--ssh` to
also configure host SSH access in the same step:

```bash
.devcontainer/scripts/start-devcontainer.sh         # start only
.devcontainer/scripts/start-devcontainer.sh --ssh   # start + configure SSH
```

Useful options:

```bash
# Recreate container first
.devcontainer/scripts/start-devcontainer.sh --remove-existing-container --ssh

# Use alternate devcontainer config
.devcontainer/scripts/start-devcontainer.sh --config .devcontainer/vnc/devcontainer.json

# Local-only mode with host key checks disabled (implies --ssh)
.devcontainer/scripts/start-devcontainer.sh --insecure-local
```

After it completes with `--ssh`:

```bash
ssh typeagent-devcontainer
```

### Common Commands

```bash
cd ts                    # Navigate to TypeScript workspace
pnpm run build           # Build all packages
pnpm run cli             # Run the CLI
pnpm run test:local      # Run unit tests
pnpm run start:agent-server          # Start agent server
```

### Git Configuration

During container creation, the post-create script keeps any existing container
Git identity, or sets `user.name` and `user.email` from the
`LOCAL_GIT_USER_NAME` and `LOCAL_GIT_USER_EMAIL` environment variables when
those values are provided. The devcontainer configs pass those host-side
environment variables through with `${localEnv:...}`, and the
`start-devcontainer.sh` wrapper fills them from your host `~/.gitconfig`
using `git config --global` before calling `devcontainer up`.

After rebuilding the container, you can verify with:

```bash
git config --global --list
git config user.name
git config user.email
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

Standard config (`devcontainer.json`):

| Port | Service                                         |
| ---- | ----------------------------------------------- |
| 2222 | Dev Container SSH (host-published on 127.0.0.1) |
| 3000 | API Server (HTTP)                               |
| 3443 | API Server (HTTPS)                              |
| 8999 | Agent Server (WebSocket)                        |
| 8081 | Browser Agent (WebSocket)                       |
| 8082 | Code Agent (WebSocket)                          |

VNC config (`vnc/devcontainer.json`) adds:

| Port | Service           |
| ---- | ----------------- |
| 6080 | noVNC Web Desktop |
| 5901 | VNC Client        |

## Container User

The container runs as `codespace` with UID/GID 1001 (matches the Codespaces
convention and the previous universal base image). All workspace and cache
paths are accessed via Docker named volumes, not host bind mounts of source
files, so this UID does not need to match your host user. If you add a host
bind mount later and your host user shares UID 1001, be aware of the implicit
file-ownership overlap.

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

### Agent window cannot create `/workspaces/*.worktrees` (access denied)

Agent windows may create sibling worktree folders such as
`/workspaces/TypeAgent3.worktrees`.
If this path is root-owned, worktree creation fails with access denied.

Run:

```bash
sudo mkdir -p /workspaces/TypeAgent3.worktrees
sudo chown codespace:codespace /workspaces/TypeAgent3.worktrees
```

Then retry creating the worktree.

This is also handled automatically on fresh container creation by
`.devcontainer/scripts/post-create.sh`.

The standard and VNC devcontainer configs now mount a dedicated Docker
named volume at `/workspaces/<repo>.worktrees` so agent-window worktrees
have a stable writable location across container restarts and rebuilds.

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
