#!/bin/bash
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

#
# TypeAgent DevContainer Post-Create Script
# Runs once when the container is first created
#

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          TypeAgent DevContainer Setup                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Detect environment
detect_env() {
    if [[ "$CODESPACES" == "true" ]]; then
        echo "codespaces"
    elif [[ -n "$WSL_DISTRO_NAME" ]] || grep -qi "wsl" /proc/version 2>/dev/null; then
        if [[ -n "$WAYLAND_DISPLAY" ]] || [[ -n "$DISPLAY" ]]; then
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

# Navigate to TypeScript workspace
echo "Looking for TypeScript workspace..."
if [[ -d "/workspaces/TypeAgent/ts" ]]; then
    cd /workspaces/TypeAgent/ts
    echo "Found: /workspaces/TypeAgent/ts"
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

# Install dependencies
echo ""
echo "Installing pnpm dependencies..."
echo "This may take a few minutes on first run..."
pnpm install || {
    echo ""
    echo "Warning: pnpm install failed. You may need to run it manually."
    echo "This is often due to network issues or missing system dependencies."
}

# Set up git hooks for lock file sync (non-critical)
echo ""
echo "Setting up git hooks for dependency synchronization..."

HOOKS_DIR="../.git/hooks"
if [[ -d "$HOOKS_DIR" ]]; then
    # Post-checkout hook
    cat > "$HOOKS_DIR/post-checkout" << 'EOF'
#!/bin/bash
PREV_HEAD=$1
NEW_HEAD=$2
BRANCH_CHECKOUT=$3

if [ "$BRANCH_CHECKOUT" != "1" ]; then exit 0; fi

LOCKFILE_CHANGED=$(git diff "$PREV_HEAD" "$NEW_HEAD" --name-only 2>/dev/null | grep -c "pnpm-lock.yaml" || true)

if [ "$LOCKFILE_CHANGED" -gt 0 ]; then
    echo "pnpm-lock.yaml changed. Running pnpm install..."
    cd ts && pnpm install --frozen-lockfile
    echo "Dependencies synchronized"
fi
EOF
    chmod +x "$HOOKS_DIR/post-checkout"

    # Post-merge hook
    cat > "$HOOKS_DIR/post-merge" << 'EOF'
#!/bin/bash
LOCKFILE_CHANGED=$(git diff HEAD@{1} HEAD --name-only | grep -c "pnpm-lock.yaml" || true)

if [ "$LOCKFILE_CHANGED" -gt 0 ]; then
    echo "pnpm-lock.yaml changed after merge. Running pnpm install..."
    cd ts && pnpm install --frozen-lockfile
    echo "Dependencies synchronized"
fi
EOF
    chmod +x "$HOOKS_DIR/post-merge"

    echo "Git hooks installed for automatic dependency sync"
else
    echo "Note: .git/hooks directory not found, skipping git hooks setup"
fi

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
