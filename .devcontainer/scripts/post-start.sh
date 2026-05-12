#!/bin/bash
#
# TypeAgent DevContainer Post-Start Script
# Runs each time the container starts
#

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          TypeAgent Dev Container Ready                       ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Quick commands:"
echo "  cd ts && pnpm run build    # Build all packages"
echo "  pnpm run cli               # Run CLI"
echo "  pnpm run server            # Start agent server (for hybrid shell)"
echo "  pnpm run shell             # Run Electron shell (if GUI available)"
echo "  pnpm run test:local        # Run unit tests"
echo ""
echo "AI Agents:"
echo "  claude                     # Start Claude Code"
echo "  claude \"your prompt\"       # Run Claude Code with prompt"
echo ""
echo "Worktree commands (for parallel agents):"
echo "  ../scripts/agent-worktree.sh feature-name    # Create worktree"
echo "  ../scripts/agent-worktree.sh --cleanup name  # Remove worktree"
echo ""

# Check if Azure login is needed
if ! az account show &>/dev/null; then
    echo "Note: Run 'az login --use-device-code' to authenticate with Azure"
    echo ""
fi
