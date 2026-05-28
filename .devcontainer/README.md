# TypeAgent Development Container

A fully configured Linux development environment for TypeAgent: Node.js 22,
Python 3.12, .NET 8.0, pnpm, Azure CLI, GitHub CLI, and Claude Code, in a
container you can run locally or in GitHub Codespaces.

## Pick a variant

| Variant    | Config file                             | Use when                                                |
| ---------- | --------------------------------------- | ------------------------------------------------------- |
| `standard` | `.devcontainer/devcontainer.json`       | Codespaces, or local dev without GUI/agent worktrees    |
| `vnc`      | `.devcontainer/vnc/devcontainer.json`   | You need the Electron shell GUI inside the container    |
| `agent`    | `.devcontainer/agent/devcontainer.json` | Local only: VS Code agent windows that create worktrees |

Quick decision aid:

- Codespaces or just want to build? → **standard**
- Need the Electron shell GUI? → **vnc**
- Running VS Code agent windows that auto-create git worktrees? → **agent**

See [Variants in detail](#variants-in-detail) below for what each one
changes and why.

## Prerequisites

### Local (Linux / macOS / Windows)

- **Docker Desktop** (Windows / macOS) or **Docker Engine** (Linux)
- **VS Code** with the
  [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
- Windows only: WSL 2 backend enabled in Docker Desktop. You can run
  `ts/tools/scripts/setup-devcontainer.ps1` to verify.

### GitHub Codespaces

No local prerequisites. Only the `standard` variant works in Codespaces;
`vnc` and `agent` require host-side resources that Codespaces does not
provide.

## Quick start

### From VS Code (Reopen in Container)

1. Open the TypeAgent folder in VS Code.
2. When prompted "Reopen in Container", click **Reopen in Container**, or use
   the Command Palette: `Dev Containers: Reopen in Container`.
3. To pick a non-default variant, use `Dev Containers: Reopen in Container
Using a Different Configuration File…` and select `vnc/` or `agent/`.
4. First build takes 5-10 minutes. When it finishes:
   ```bash
   cd ts
   pnpm run build
   ```

### From the CLI (`start-devcontainer.sh`)

Use this wrapper when you want a single command that also forwards your host
git identity and (optionally) sets up SSH access. `--config` accepts a short
name (`vnc`, `agent`) or an explicit path.

```bash
.devcontainer/scripts/start-devcontainer.sh                 # standard
.devcontainer/scripts/start-devcontainer.sh --config vnc
.devcontainer/scripts/start-devcontainer.sh --config agent
.devcontainer/scripts/start-devcontainer.sh --ssh           # also wire host SSH
```

Lifecycle flags:

| Flag         | Effect                                                 |
| ------------ | ------------------------------------------------------ |
| `--recreate` | Recreate the container (keep image, keep volumes)      |
| `--rebuild`  | Rebuild the image without cache (implies `--recreate`) |
| `--clean`    | Recreate the container and remove its Docker volumes   |
| `--reset`    | `--rebuild` plus `--clean` (full fresh start)          |

For local-only workflows where you want SSH set up with host-key checks
disabled, pass `--insecure-local` (implies `--ssh`):

```bash
.devcontainer/scripts/start-devcontainer.sh --insecure-local
```

## Variants in detail

### `standard` - `.devcontainer/devcontainer.json`

The default. Works in Codespaces and locally. Source tree is bind-mounted
under `/workspaces/<repo>/`, and `ts/node_modules` lives on a Docker named
volume so native modules stay container-local.

Does not support VS Code agent windows that auto-create git worktrees: a
separate host VS Code window cannot open a worktree path that exists only
inside the container. Use the `agent` variant for that workflow. (In
Codespaces the agent worktree feature does work natively, because every
attached VS Code window sees the same `/workspaces/...` paths in the same
Codespace VM.)

### `vnc` - `.devcontainer/vnc/devcontainer.json`

Same as `standard` plus the `desktop-lite` feature for a noVNC web desktop
on port 6080. Use this when you need to run Electron (the TypeAgent shell)
inside the container. Heavier resource requirements (4 CPU, 16 GB RAM).

The `desktop-lite` feature is amd64-only, so on Apple Silicon this variant
may require Rosetta / QEMU emulation.

### `agent` - `.devcontainer/agent/devcontainer.json` (local only)

Variant designed for VS Code agent windows that auto-create git worktrees.
VS Code's Copilot CLI agent writes worktrees to a hardcoded
`<dirname(repo)>/<basename(repo)>.worktrees`, which is not configurable. To
make those worktrees usable from both host and container, this variant:

- Bind-mounts the repo at its **host absolute path** (rather than
  `/workspaces/<repo>`) so `${localWorkspaceFolder}` resolves the same on
  both sides.
- Adds a second bind for `<repo>.worktrees` at the matching host path
  (created on the host by `initializeCommand` if missing).
- Sets `updateRemoteUserUID: true` so the in-container `codespace` user is
  re-chowned to your host UID and can write through the bind mount.
- Keeps `ts/node_modules` on a named volume - do **not** share native
  module builds with the host.

Worktrees created by an agent window are visible at the same path on the
host, so a separate host VS Code window can open them directly. This does
not work in Codespaces (no host path).

## Working inside the container

### Common commands

```bash
cd ts
pnpm run build              # build all packages
pnpm run cli                # run the CLI
pnpm run test:local         # run unit tests
pnpm run start:agent-server # start the agent server
```

### Electron shell (hybrid)

For variants without the VNC desktop, run the backend in the container and
the Electron shell on your host - the agent server port is forwarded:

```bash
# In container
pnpm run server

# On host
cd ts && pnpm run shell
```

### Git identity

How your git identity ends up inside the container depends on how you
started it:

- **VS Code "Reopen in Container"**: the Dev Containers extension
  automatically projects your host `~/.gitconfig` into the container
  (controlled by the `dev.containers.copyGitConfig` user setting, on by
  default). Your `user.name` / `user.email` are already present.
- **`start-devcontainer.sh`**: the wrapper does **not** copy
  `~/.gitconfig`. It only forwards `user.name` and `user.email` via the
  `LOCAL_GIT_USER_NAME` / `LOCAL_GIT_USER_EMAIL` env vars, which
  `post-create.sh` writes into the container's global git config if no
  identity is already set.
- **Codespaces**: identity is provisioned from your GitHub account.

Verify with:

```bash
git config --global --list
```

If you are using the container for untrusted / agent work, you almost
certainly want to disable the automatic `~/.gitconfig` projection - see
[Hardening for untrusted / agent use](#hardening-for-untrusted--agent-use).

### Parallel agents via worktrees

```bash
../scripts/agent-worktree.sh feature-name        # create
../scripts/agent-worktree.sh --cleanup feature-name
```

Each worktree shares git history but has independent working tree, branch
state, and (via pnpm's content-addressable store) effective `node_modules`.

## SSH access

The base image includes an SSH server. To configure key-based access from
the host:

```bash
.devcontainer/scripts/setup-ssh-access.sh
```

The script:

- generates `~/.ssh/typeagent-devcontainer` if missing,
- finds the running TypeAgent container via Docker labels,
- installs the public key in the container's `authorized_keys` for
  `codespace`,
- writes an SSH config entry named `typeagent-devcontainer`,
- enforces key-only auth in both client and container sshd config,
- defaults to `StrictHostKeyChecking accept-new`,
- in WSL, also mirrors the keypair and config into Windows
  `%USERPROFILE%/.ssh`.

For local-only workflows where you intentionally want host-key checking
off:

```bash
.devcontainer/scripts/setup-ssh-access.sh --insecure-local
```

When using a non-default variant, pass it through:

```bash
.devcontainer/scripts/setup-ssh-access.sh --config vnc
.devcontainer/scripts/setup-ssh-access.sh --config agent
```

Connect:

```bash
ssh typeagent-devcontainer
```

## AI agents

### Claude Code

Pre-installed:

```bash
claude                   # interactive session
claude "your prompt"     # one-shot
```

### Hardening for untrusted / agent use

When you plan to give a coding agent broad shell access in the container,
assume any credential reachable from the container is reachable by the
agent (and by anything that prompt-injects it). Lock down what the host
wires in.

**1. Disable VS Code's automatic credential / SSH wiring.**

The Dev Containers extension by default copies your host `~/.gitconfig`,
installs a git credential helper that proxies back to the host, and
forwards SSH and GPG agent sockets. Turn those off in your **User**
`settings.json` (not the repo's devcontainer config):

```jsonc
{
  "dev.containers.copyGitConfig": false,
  "dev.containers.gitCredentialHelperConfigLocation": "none",
  "dev.containers.forwardSSH": false,
  "dev.containers.forwardGPG": false,
}
```

Older VS Code versions use the `remote.containers.*` prefix.

`start-devcontainer.sh` does not copy `~/.gitconfig`; it only forwards
`user.name` / `user.email` via `LOCAL_GIT_USER_*` env vars. No host
credential helpers or SSH agents are wired in by the wrapper.

**2. Verify inside the container.**

```bash
git config --global --get credential.helper   # should be empty
ls -la ~/.gitconfig                           # only the identity from post-create
echo "$SSH_AUTH_SOCK"                         # should be empty
```

**3. If the agent needs to push, use a scoped bot credential.**

Preferred, in order:

- **Fine-grained GitHub PAT** scoped to "Only select repositories" with the
  minimum permissions (typically `Contents: RW`, `Pull requests: RW`,
  `Metadata: R`) and a short expiration. In the container:
  ```bash
  echo "$GH_BOT_TOKEN" | gh auth login --with-token --hostname github.com
  gh auth setup-git
  ```
- **Per-repo SSH deploy key** generated _inside_ the container and added to
  the target repo's Settings → Deploy keys.
- **GitHub App installation token** for shared/org bots.

Avoid: forwarding your personal SSH agent, bind-mounting
`~/.git-credentials`, or running `gh auth login` with your personal
account.

**4. Extra isolation.**

- Run the agent in a dedicated worktree so it only sees one branch's tree.
- Restrict the bot identity to an `agent/*` branch namespace and require a
  PR into `main`.
- Revoke the bot token / deploy key after the session.

## Reference

### Forwarded ports

| Port | Service                                         | Variants |
| ---- | ----------------------------------------------- | -------- |
| 2222 | Dev container SSH (host-published on 127.0.0.1) | all      |
| 3000 | API server (HTTP)                               | all      |
| 3443 | API server (HTTPS)                              | all      |
| 8081 | Browser agent (WebSocket)                       | all      |
| 8082 | Code agent (WebSocket)                          | all      |
| 8999 | Agent server (WebSocket)                        | all      |
| 5901 | VNC client                                      | `vnc`    |
| 6080 | noVNC web desktop                               | `vnc`    |

### Container user

Runs as `codespace`, UID/GID 1001 (matches the Codespaces convention).

- In `standard` and `vnc`, source files live in Docker named volumes or are
  Codespaces-managed, so UID alignment with the host is not required.
- In `agent`, the host bind mount needs UID alignment. The variant sets
  `updateRemoteUserUID: true` to re-chown `codespace` to your host UID on
  first start.

### Volumes and mounts

| Mount point in container                  | Type   | Purpose                                               |
| ----------------------------------------- | ------ | ----------------------------------------------------- |
| workspace folder                          | bind   | Source tree (host or Codespaces filesystem)           |
| `<workspace>/ts/node_modules`             | volume | Container-local `node_modules` (native build)         |
| `/home/codespace/.local/share/pnpm/store` | volume | Shared pnpm content-addressable store                 |
| `/home/codespace/.claude`                 | volume | Claude Code config                                    |
| `/home/codespace/.copilot`                | volume | Copilot CLI config                                    |
| `<host repo>.worktrees`                   | bind   | Agent worktrees, same path host & container (`agent`) |

### Container image

`.devcontainer/Dockerfile` extends the Ubuntu 24.04 base with pre-installed
system libraries (libsecret). This avoids `apt-get install` on every
container creation and leverages Docker's layer cache for fast rebuilds.

## Troubleshooting

### Container fails to start

1. Ensure Docker Desktop / Engine is running.
2. Try `Dev Containers: Rebuild Container`, or
   `.devcontainer/scripts/start-devcontainer.sh --rebuild`.
3. Confirm Docker has sufficient resources (4 CPU, 8 GB RAM minimum; 16 GB
   for `vnc`).

### `pnpm install` fails

```bash
pnpm store prune
pnpm install
```

### `EACCES` on `ts/node_modules` or pnpm store

The `ts/node_modules` and pnpm store named volumes are created by Docker
as `root:root` on first mount. `post-create.sh` chowns them to `codespace`
automatically. If you ever hit this manually after the script has run:

```bash
sudo chown -R codespace:codespace \
    "$(pwd)/ts/node_modules" \
    /home/codespace/.local/share/pnpm \
    /home/codespace/.claude \
    /home/codespace/.copilot
cd ts && pnpm install
```

Do **not** blindly `chown -R` the workspace tree itself in the `agent`
variant: it is a host bind mount, and the change will be visible on the
host.

### Agent window cannot create `<repo>.worktrees` (access denied)

- `standard` / `vnc` (local Docker): not supported. The worktree path
  exists only inside the container, so a separate host VS Code window
  cannot open it. Switch to the `agent` variant.
- `standard` in Codespaces: should just work; both windows attach to the
  same Codespace VM. If you hit a permission error, run
  `sudo mkdir -p /workspaces/<repo>.worktrees && sudo chown
codespace:codespace /workspaces/<repo>.worktrees`.
- `agent`: the path is a host bind mount created by `initializeCommand`.
  If it's missing, create it on the host (`mkdir -p <repo>.worktrees`) and
  rebuild the container so the bind is re-established.

### Line ending issues (Windows)

If scripts fail with `\r': command not found`, the repo has CRLF line
endings. Fix with:

```bash
git config core.autocrlf input
git rm --cached -r .
git reset --hard
```

## Rebuilding

| Goal                                | Command Palette                                   | CLI                               |
| ----------------------------------- | ------------------------------------------------- | --------------------------------- |
| Recreate container                  | `Dev Containers: Rebuild Container`               | `start-devcontainer.sh --rebuild` |
| Rebuild image, drop volumes (reset) | `Dev Containers: Rebuild Container Without Cache` | `start-devcontainer.sh --reset`   |

## Resources

- [VS Code Dev Containers](https://code.visualstudio.com/docs/devcontainers/containers)
- [GitHub Codespaces](https://docs.github.com/en/codespaces)
- [TypeAgent Documentation](../ts/README.md)
