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
    corepack prepare pnpm@latest --activate || echo "Warning: corepack prepare failed"
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

echo ""
echo "Installing system libraries required by TypeAgent..."
# libsecret is required by keytar / native credential storage used by some
# TypeAgent packages (libsecret-1.so.0 at runtime, libsecret-1-dev for builds).
APT_PACKAGES=(
    libsecret-1-0
    libsecret-1-dev
)
if command -v apt-get &> /dev/null; then
    if ! sudo DEBIAN_FRONTEND=noninteractive apt-get update -y; then
        echo "  warn: apt-get update failed"
    fi
    if ! sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${APT_PACKAGES[@]}"; then
        echo "  warn: failed to install: ${APT_PACKAGES[*]}"
    fi
else
    echo "  warn: apt-get not available, skipping system library install"
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
else
    echo "  note: no LOCAL_GIT_USER_NAME provided"
fi

if [[ -n "$CURRENT_GIT_EMAIL" ]]; then
    echo "  git user.email already set"
elif [[ -n "$DESIRED_GIT_EMAIL" ]]; then
    git config --global user.email "$DESIRED_GIT_EMAIL"
    echo "  git user.email set"
else
    echo "  note: no LOCAL_GIT_USER_EMAIL provided"
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

# Set up git hooks for lock file sync without clobbering existing hooks (for git-lfs compatibility)
echo ""
echo "Configuring TypeAgent git hook helpers..."

HOOKS_DIR=$(git rev-parse --git-path hooks 2>/dev/null || true)
if [[ -n "$HOOKS_DIR" ]] && [[ -d "$HOOKS_DIR" ]]; then
    TYPEAGENT_HOOK_DIR="$HOOKS_DIR/typeagent"
    mkdir -p "$TYPEAGENT_HOOK_DIR"

    cat > "$TYPEAGENT_HOOK_DIR/post-checkout.sh" << 'EOF'
#!/bin/sh
PREV_HEAD=$1
NEW_HEAD=$2
BRANCH_CHECKOUT=$3

if [ "$BRANCH_CHECKOUT" != "1" ]; then exit 0; fi

LOCKFILE_CHANGED=$(git diff "$PREV_HEAD" "$NEW_HEAD" --name-only 2>/dev/null | grep -c "pnpm-lock.yaml" || true)
if [ "$LOCKFILE_CHANGED" -gt 0 ]; then
    REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
    if [ -n "$REPO_ROOT" ] && [ -d "$REPO_ROOT/ts" ]; then
        echo "pnpm-lock.yaml changed. Running pnpm install..."
        cd "$REPO_ROOT/ts" && pnpm install --frozen-lockfile
        echo "Dependencies synchronized"
    fi
fi
EOF
    chmod +x "$TYPEAGENT_HOOK_DIR/post-checkout.sh"

    cat > "$TYPEAGENT_HOOK_DIR/post-merge.sh" << 'EOF'
#!/bin/sh
LOCKFILE_CHANGED=$(git diff HEAD@{1} HEAD --name-only 2>/dev/null | grep -c "pnpm-lock.yaml" || true)
if [ "$LOCKFILE_CHANGED" -gt 0 ]; then
    REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
    if [ -n "$REPO_ROOT" ] && [ -d "$REPO_ROOT/ts" ]; then
        echo "pnpm-lock.yaml changed after merge. Running pnpm install..."
        cd "$REPO_ROOT/ts" && pnpm install --frozen-lockfile
        echo "Dependencies synchronized"
    fi
fi
EOF
    chmod +x "$TYPEAGENT_HOOK_DIR/post-merge.sh"

    ensure_hook_chain() {
        local hook_file=$1
        local helper_script=$2
        local marker="# TypeAgent dependency sync"

        if [[ ! -f "$hook_file" ]]; then
            cat > "$hook_file" << 'EOF'
#!/bin/sh
EOF
            chmod +x "$hook_file"
        fi

        if ! grep -Fq "$marker" "$hook_file"; then
            cat >> "$hook_file" << EOF

$marker
HOOK_DIR="\$(cd "\$(dirname "\$0")" && pwd)"
if [ -x "\$HOOK_DIR/typeagent/$helper_script" ]; then
    "\$HOOK_DIR/typeagent/$helper_script" "\$@"
fi
EOF
        fi
    }

    ensure_hook_chain "$HOOKS_DIR/post-checkout" "post-checkout.sh"
    ensure_hook_chain "$HOOKS_DIR/post-merge" "post-merge.sh"

    echo "TypeAgent hook helpers installed (compatible with existing hooks)"
else
    echo "Note: Could not resolve .git/hooks directory, skipping hook helper setup"
fi

# ── Security hardening: restrict sudo to a minimal allowlist ──────────
# During post-create we needed unrestricted root access to install
# packages and fix volume ownership.  Now that setup is done, replace
# the blanket NOPASSWD:ALL rule with the narrowest set of commands the
# codespace user is likely to need at runtime.
echo ""
echo "Hardening sudo access..."
SUDOERS_FILE="/etc/sudoers.d/codespace-restricted"
sudo tee "$SUDOERS_FILE" > /dev/null << 'SUDOERS'
# Restricted sudo for the codespace user (post-setup hardening).
# Only allow package management, ownership fixes, and directory creation.
codespace ALL=(root) NOPASSWD: /usr/bin/apt-get update*, \
    /usr/bin/apt-get install*, \
    /usr/bin/apt-get upgrade*, \
    /usr/bin/apt-get autoremove*, \
    /bin/chown *, \
    /usr/bin/chown *, \
    /bin/mkdir *, \
    /usr/bin/mkdir *, \
    /usr/sbin/service ssh *
SUDOERS
sudo chmod 0440 "$SUDOERS_FILE"
# Remove the blanket rule that grants unrestricted root.  The common-utils
# devcontainer feature writes it to /etc/sudoers.d/codespace (filename
# matches the username).
if [[ -f /etc/sudoers.d/codespace ]]; then
    sudo rm /etc/sudoers.d/codespace
    echo "  Removed blanket NOPASSWD:ALL rule"
fi
echo "  Sudo restricted to: apt-get, chown, mkdir, service ssh"

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
