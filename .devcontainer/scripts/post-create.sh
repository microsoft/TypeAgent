#!/bin/bash
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

#
# TypeAgent DevContainer Post-Create Script
# Runs once when the container is first created
#

set -euo pipefail

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          TypeAgent DevContainer Setup                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Detect environment
detect_env() {
    if [[ "${CODESPACES:-}" == "true" ]]; then
        echo "codespaces"
    elif [[ -n "${WSL_DISTRO_NAME:-}" ]] || grep -qi "wsl" /proc/version 2>/dev/null; then
        if [[ -n "${WAYLAND_DISPLAY:-}" ]] || [[ -n "${DISPLAY:-}" ]]; then
            echo "wsl2-gui"
        else
            echo "wsl2"
        fi
    else
        echo "standard"
    fi
}

ENV=$(detect_env)
echo "Environment: $ENV"
echo ""

# Fix ownership of Docker named-volume mount points.
# Named volumes mounted into the container are owned by root:root by default,
# which prevents the non-root `codespace` user from writing into them
# (e.g. `pnpm install` -> EACCES on ts/node_modules).
echo "Fixing ownership of mounted volume directories..."
VOLUME_PATHS=(
    "$HOME/.local/share/pnpm"
    "$HOME/.local/share/pnpm/store"
    "$HOME/.claude"
    "$HOME/.copilot"
    "$HOME/.vscode-server"
)
# Discover the workspace ts/node_modules path dynamically (works for worktrees
# and for variants that mount the workspace outside /workspaces, e.g. the
# `agent` devcontainer that bind-mounts the host path verbatim).
find_ts_dir() {
    local root=$1
    if [[ -d "$root" ]]; then
        find "$root" -maxdepth 2 -type d -name "ts" 2>/dev/null | head -1 || true
    fi
}

resolve_ts_workspace() {
    local repo_root
    repo_root=$(git rev-parse --show-toplevel 2>/dev/null || true)

    if [[ -n "$repo_root" ]] && [[ -d "$repo_root/ts" ]]; then
        echo "$repo_root/ts"
    elif [[ -d "$(pwd)/ts" ]]; then
        echo "$(pwd)/ts"
    elif [[ -n "${containerWorkspaceFolder:-}" ]] && [[ -d "${containerWorkspaceFolder}/ts" ]]; then
        echo "${containerWorkspaceFolder}/ts"
    elif [[ -d "/workspaces/TypeAgent/ts" ]]; then
        echo "/workspaces/TypeAgent/ts"
    else
        find_ts_dir "/workspaces"
    fi
}

TS_DIR=$(resolve_ts_workspace)

# Resolve TypeScript workspace early and fail fast if it is missing.
echo "Looking for TypeScript workspace..."
if [[ -n "$TS_DIR" ]]; then
    echo "Found: $TS_DIR"
    VOLUME_PATHS+=("$TS_DIR/node_modules")
else
    echo "Error: Could not find TypeScript workspace directory (expected ts/)" >&2
    echo "Checked: git repo root, current directory, containerWorkspaceFolder, /workspaces" >&2
    echo "Listing /workspaces contents:"
    ls -la /workspaces/ 2>/dev/null || echo "  /workspaces not accessible"
    exit 1
fi

for p in "${VOLUME_PATHS[@]}"; do
    if [[ -e "$p" ]]; then
        if sudo chown -R "$(id -u):$(id -g)" "$p"; then
            echo "  chowned $p"
        else
            if [[ "$p" == *"/pnpm/store" ]] || [[ "$p" == *"/node_modules" ]]; then
                echo "Error: failed to chown critical path $p" >&2
                exit 1
            fi
            echo "  warn: could not chown $p"
        fi
    fi
done
echo ""

# Navigate to TypeScript workspace
cd "$TS_DIR"

echo ""
echo "Installing system libraries required by TypeAgent..."
# libsecret is required by keytar / native credential storage used by some
# TypeAgent packages (libsecret-1.so.0 at runtime, libsecret-1-dev for builds).
APT_PACKAGES=(
    libsecret-1-0
    libsecret-1-dev
)
# Skip if already baked into the image (via .devcontainer/Dockerfile)
MISSING_PKGS=()
for pkg in "${APT_PACKAGES[@]}"; do
    if ! dpkg -s "$pkg" &>/dev/null; then
        MISSING_PKGS+=("$pkg")
    fi
done
if [[ ${#MISSING_PKGS[@]} -gt 0 ]]; then
    if command -v apt-get &> /dev/null; then
        if ! sudo DEBIAN_FRONTEND=noninteractive apt-get update -y; then
            echo "  warn: apt-get update failed"
        fi
        if ! sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${MISSING_PKGS[@]}"; then
            echo "  warn: failed to install: ${MISSING_PKGS[*]}"
        fi
    else
        echo "  warn: apt-get not available, skipping system library install"
    fi
else
    echo "  all packages already installed"
fi

echo ""
echo "Configuring Git identity..."
CURRENT_GIT_NAME=$(git config --global --get user.name 2>/dev/null || true)
CURRENT_GIT_EMAIL=$(git config --global --get user.email 2>/dev/null || true)
DESIRED_GIT_NAME="${LOCAL_GIT_USER_NAME:-}"
DESIRED_GIT_EMAIL="${LOCAL_GIT_USER_EMAIL:-}"

if [[ -n "$CURRENT_GIT_NAME" ]]; then
    echo "  git user.name already set"
elif [[ -n "$DESIRED_GIT_NAME" ]]; then
    git config --global user.name "$DESIRED_GIT_NAME"
    echo "  git user.name set"
fi

if [[ -n "$CURRENT_GIT_EMAIL" ]]; then
    echo "  git user.email already set"
elif [[ -n "$DESIRED_GIT_EMAIL" ]]; then
    git config --global user.email "$DESIRED_GIT_EMAIL"
    echo "  git user.email set"
fi

if [[ -z "$CURRENT_GIT_NAME" && -z "$DESIRED_GIT_NAME" ]] || \
   [[ -z "$CURRENT_GIT_EMAIL" && -z "$DESIRED_GIT_EMAIL" ]]; then
    echo ""
    echo "  Warning: no host git identity provided."
    echo "  Start the container via .devcontainer/scripts/start-devcontainer.sh"
    echo "  to inherit host ~/.gitconfig, or set it manually inside the container:"
    echo "    git config --global user.name  \"Your Name\""
    echo "    git config --global user.email \"you@example.com\""
fi

# Enable pnpm
echo ""
echo "Installing pnpm..."
PACKAGE_MANAGER=$(node -p "require('./package.json').packageManager")
if [[ "$PACKAGE_MANAGER" != pnpm@* ]]; then
    echo "Error: package.json packageManager does not specify pnpm: $PACKAGE_MANAGER" >&2
    exit 1
fi
PNPM_VERSION=${PACKAGE_MANAGER#pnpm@}
PNPM_VERSION=${PNPM_VERSION%%+sha512.*}
# Ensure npm/pnpm use the host-provided registry inside the container.
EFFECTIVE_NPM_REGISTRY="${NPM_CONFIG_REGISTRY:-}"
if [[ -z "$EFFECTIVE_NPM_REGISTRY" ]]; then
    EFFECTIVE_NPM_REGISTRY=$(npm config get registry 2>/dev/null || true)
fi
if [[ -z "$EFFECTIVE_NPM_REGISTRY" ]] || [[ "$EFFECTIVE_NPM_REGISTRY" == "undefined" ]]; then
    EFFECTIVE_NPM_REGISTRY="https://registry.npmjs.org/"
fi
case "$EFFECTIVE_NPM_REGISTRY" in
    */) ;;
    *) EFFECTIVE_NPM_REGISTRY="${EFFECTIVE_NPM_REGISTRY}/" ;;
esac
export NPM_CONFIG_REGISTRY="$EFFECTIVE_NPM_REGISTRY"
export npm_config_registry="$EFFECTIVE_NPM_REGISTRY"
echo "Using npm registry: $EFFECTIVE_NPM_REGISTRY"
if ! npm config set registry "$EFFECTIVE_NPM_REGISTRY" --global; then
    echo "  warn: failed to persist npm registry"
fi
# Ensure pnpm's expected home/bin paths exist and are on PATH for this script.
# This avoids global/bin-dir errors in non-interactive shells.
export PNPM_HOME="${PNPM_HOME:-$HOME/.local/share/pnpm}"
mkdir -p "$PNPM_HOME/bin"
export PATH="$PNPM_HOME/bin:$PATH"

if [[ "${TYPEAGENT_USE_COREPACK:-0}" == "1" ]] && command -v corepack &> /dev/null; then
    corepack enable || echo "Warning: corepack enable failed"
    # Use the pnpm version pinned in package.json (packageManager field)
    corepack install || echo "Warning: corepack install failed"
else
    if [[ "${TYPEAGENT_USE_COREPACK:-0}" == "1" ]]; then
        echo "Warning: corepack not found, falling back to npm..."
    fi
    echo "Installing pnpm@$PNPM_VERSION via npm..."
    npm install -g "pnpm@$PNPM_VERSION" --registry "$EFFECTIVE_NPM_REGISTRY" || { echo "Failed to install pnpm@$PNPM_VERSION"; exit 1; }
    # pnpm setup is interactive-shell oriented and may fail in post-create.
    # We manage PNPM_HOME/PATH directly in this script instead.
fi

# Verify pnpm is available
if ! command -v pnpm &> /dev/null; then
    echo "Error: pnpm is not available after setup"
    exit 1
fi

echo "pnpm version: $(pnpm --version)"

if ! pnpm config set registry "$EFFECTIVE_NPM_REGISTRY" --global; then
    echo "  warn: failed to persist pnpm registry"
fi
echo "pnpm registry: $(pnpm config get registry)"

# Keep PATH stable for later interactive shells as well.
if [[ -f "$HOME/.bashrc" ]] && ! grep -q 'PNPM_HOME' "$HOME/.bashrc"; then
    {
        echo ''
        echo '# pnpm home (set by TypeAgent post-create)'
        echo "export PNPM_HOME=$HOME/.local/share/pnpm"
        echo 'export PATH="$PNPM_HOME/bin:$PATH"'
    } >> "$HOME/.bashrc"
fi

# Point pnpm store at the Docker named volume so it persists across rebuilds
pnpm config set store-dir "$HOME/.local/share/pnpm/store" --global
echo "pnpm store-dir: $(pnpm store path)"

# Install dependencies
echo ""
echo "Installing pnpm dependencies..."
echo "This may take a few minutes on first run..."
if ! pnpm install; then
    echo ""
    echo "Error: pnpm install failed." >&2
    echo "This is often due to network issues or missing system dependencies." >&2
    exit 1
fi

# - Security hardening: restrict sudo to a minimal allowlist
# During post-create we needed unrestricted root access to install
# packages and fix volume ownership.  Now that setup is done, replace
# the blanket NOPASSWD:ALL rule with only the ssh service commands.
# apt-get, dpkg, chown, and mkdir are intentionally excluded — all
# package installation and ownership fixes happen above during setup,
# and allowing them at runtime exposes privilege-escalation vectors
# (e.g. apt-get -o hook injection, chown on /etc/shadow).
echo ""
echo "Hardening sudo access..."
CURRENT_USER=$(id -un)
SUDOERS_FILE="/etc/sudoers.d/${CURRENT_USER}-restricted"
sudo tee "$SUDOERS_FILE" > /dev/null <<SUDOERS
# Restricted sudo for the container user (post-setup hardening).
# Only allow managing the SSH service — nothing else.
$CURRENT_USER ALL=(root) NOPASSWD: /usr/sbin/service ssh start, \
    /usr/sbin/service ssh stop, \
    /usr/sbin/service ssh restart, \
    /usr/sbin/service ssh status, \
    /usr/sbin/service sshd start, \
    /usr/sbin/service sshd stop, \
    /usr/sbin/service sshd restart, \
    /usr/sbin/service sshd status
SUDOERS
sudo chmod 0440 "$SUDOERS_FILE"
# Remove the blanket rule that grants unrestricted root.  The common-utils
# devcontainer feature writes it to /etc/sudoers.d/codespace (filename
# matches the username).
REMOVED_BROAD_RULE=0
for broad_rule in "/etc/sudoers.d/$CURRENT_USER" /etc/sudoers.d/codespace; do
    if [[ -f "$broad_rule" ]]; then
        sudo rm "$broad_rule"
        REMOVED_BROAD_RULE=1
    fi
done
if [[ $REMOVED_BROAD_RULE -eq 1 ]]; then
    echo "  Removed blanket NOPASSWD:ALL rule"
fi
echo "  Sudo restricted to: service ssh/sshd only"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          Setup Complete!                                     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "  cd ts"
echo "  pnpm run build"
echo ""

case $ENV in
    wsl2-gui)
        echo "GUI Support: WSLg detected - 'pnpm run shell' will work!"
        ;;
    codespaces)
        echo "GUI Support: Use VNC at http://localhost:6080"
        ;;
    *)
        echo "GUI Support: For Electron, use hybrid approach:"
        echo "  Container: pnpm run server"
        echo "  Host:      pnpm run shell"
        ;;
esac

echo ""
