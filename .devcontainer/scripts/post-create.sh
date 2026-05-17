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

# Ensure worktree roots are writable for agent windows.
echo "Preparing worktree roots for agent windows..."
WORKSPACE_DIR=$(pwd -P)
WORKTREES_DIR="${WORKSPACE_DIR}.worktrees"
for dir in "$WORKTREES_DIR"; do
    if [[ ! -d "$dir" ]]; then
        if sudo mkdir -p "$dir"; then
            echo "  created $dir"
        else
            echo "  warn: could not create $dir"
            continue
        fi
    fi

    if sudo chown codespace:codespace "$dir"; then
        echo "  $dir owned by codespace"
    else
        echo "  warn: could not set ownership for $dir"
    fi
done
echo ""

# Fix ownership of Docker named-volume mount points.
# Named volumes mounted into the container are owned by root:root by default,
# which prevents the non-root `codespace` user from writing into them
# (e.g. `pnpm install` -> EACCES on ts/node_modules).
echo "Fixing ownership of mounted volume directories..."
VOLUME_PATHS=(
    "/home/codespace/.local/share/pnpm"
    "/home/codespace/.local/share/pnpm/store"
    "/home/codespace/.claude"
    "/home/codespace/.copilot"
)
# Discover the workspace ts/node_modules path dynamically (works for worktrees too)
WS_TS_DIR=""
if [[ -d "/workspaces/TypeAgent/ts" ]]; then
    WS_TS_DIR="/workspaces/TypeAgent/ts"
else
    WS_TS_DIR=$(find /workspaces -maxdepth 2 -type d -name "ts" 2>/dev/null | head -1)
fi
if [[ -n "$WS_TS_DIR" ]]; then
    VOLUME_PATHS+=("$WS_TS_DIR/node_modules")
fi

for p in "${VOLUME_PATHS[@]}"; do
    if [[ -e "$p" ]]; then
        if sudo chown -R codespace:codespace "$p"; then
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
echo "Looking for TypeScript workspace..."
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [[ -n "$REPO_ROOT" ]] && [[ -d "$REPO_ROOT/ts" ]]; then
    cd "$REPO_ROOT/ts"
    echo "Found: $REPO_ROOT/ts"
else
    # Try glob pattern
    TS_DIR=$(find /workspaces -maxdepth 2 -type d -name "ts" 2>/dev/null | head -1)
    if [[ -n "$TS_DIR" ]]; then
        cd "$TS_DIR"
        echo "Found: $TS_DIR"
    else
        echo "Warning: Could not find ts directory in /workspaces"
        echo "Listing /workspaces contents:"
        ls -la /workspaces/ 2>/dev/null || echo "  /workspaces not accessible"
        echo ""
        echo "Skipping dependency installation. Run manually after container starts:"
        echo "  cd ts && pnpm install"
        exit 0
    fi
fi

# Enable pnpm
echo ""
echo "Enabling corepack and pnpm..."
if command -v corepack &> /dev/null; then
    corepack enable || echo "Warning: corepack enable failed"
    # Use the pnpm version pinned in package.json (packageManager field)
    corepack install || echo "Warning: corepack install failed"
else
    echo "Warning: corepack not found, checking for pnpm..."
    if ! command -v pnpm &> /dev/null; then
        echo "Installing pnpm via npm..."
        npm install -g pnpm || { echo "Failed to install pnpm"; exit 1; }
    fi
fi

# Verify pnpm is available
if ! command -v pnpm &> /dev/null; then
    echo "Error: pnpm is not available after setup"
    exit 1
fi

echo "pnpm version: $(pnpm --version)"

# Point pnpm store at the Docker named volume so it persists across rebuilds
pnpm config set store-dir /home/codespace/.local/share/pnpm/store --global
echo "pnpm store-dir: $(pnpm store path)"

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
SUDOERS_FILE="/etc/sudoers.d/codespace-restricted"
sudo tee "$SUDOERS_FILE" > /dev/null << 'SUDOERS'
# Restricted sudo for the codespace user (post-setup hardening).
# Only allow managing the SSH service — nothing else.
codespace ALL=(root) NOPASSWD: /usr/sbin/service ssh start, \
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
if [[ -f /etc/sudoers.d/codespace ]]; then
    sudo rm /etc/sudoers.d/codespace
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
