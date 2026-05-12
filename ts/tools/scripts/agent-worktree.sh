#!/bin/bash
#
# TypeAgent Agent Worktree Management Script
#
# Creates isolated git worktrees for parallel AI agent development.
# Each worktree gets its own branch and can run an independent agent.
#
# Usage:
#   ./agent-worktree.sh <task-name> [base-branch]   # Create worktree
#   ./agent-worktree.sh --cleanup <task-name>       # Remove worktree
#   ./agent-worktree.sh --list                      # List all worktrees
#   ./agent-worktree.sh --sync                      # Check dep sync status
#

set -e

# Configuration
WORKTREE_BASE="../agent-tasks"
BRANCH_PREFIX="agent"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
print_error() { echo -e "${RED}❌ $1${NC}"; }
print_info() { echo -e "${CYAN}ℹ️  $1${NC}"; }

show_help() {
    echo "TypeAgent Agent Worktree Management"
    echo ""
    echo "Usage:"
    echo "  $0 <task-name> [base-branch]   Create a new worktree for an agent task"
    echo "  $0 --cleanup <task-name>       Remove a worktree and its branch"
    echo "  $0 --list                      List all active worktrees"
    echo "  $0 --sync                      Check dependency sync status"
    echo "  $0 --help                      Show this help"
    echo ""
    echo "Examples:"
    echo "  $0 feature-auth                Create worktree for auth feature"
    echo "  $0 bugfix-login main           Create worktree from main branch"
    echo "  $0 --cleanup feature-auth      Remove the feature-auth worktree"
    echo ""
}

create_worktree() {
    local TASK_NAME="$1"
    local BASE_BRANCH="${2:-main}"

    local WORKTREE_PATH="$WORKTREE_BASE/$TASK_NAME"
    local BRANCH_NAME="$BRANCH_PREFIX/$TASK_NAME"

    # Check if worktree already exists
    if [[ -d "$WORKTREE_PATH" ]]; then
        print_error "Worktree already exists: $WORKTREE_PATH"
        exit 1
    fi

    # Create parent directory if needed
    mkdir -p "$WORKTREE_BASE"

    # Create worktree
    print_info "Creating worktree at $WORKTREE_PATH..."
    git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME" "$BASE_BRANCH"

    # Copy git hooks to worktree
    if [[ -f ".git/hooks/post-checkout" ]]; then
        cp -f .git/hooks/post-checkout "$WORKTREE_PATH/.git/hooks/" 2>/dev/null || true
    fi
    if [[ -f ".git/hooks/post-merge" ]]; then
        cp -f .git/hooks/post-merge "$WORKTREE_PATH/.git/hooks/" 2>/dev/null || true
    fi

    # Install dependencies (fast with global virtual store)
    print_info "Installing dependencies (using global store)..."
    cd "$WORKTREE_PATH/ts"

    # Check if global virtual store is enabled
    if grep -q "enableGlobalVirtualStore: true" pnpm-workspace.yaml 2>/dev/null; then
        print_info "Global Virtual Store enabled - installation should be fast!"
    fi

    pnpm install --frozen-lockfile

    print_success "Worktree created successfully!"
    echo ""
    echo "Worktree: $WORKTREE_PATH"
    echo "Branch:   $BRANCH_NAME"
    echo ""
    echo "To work in this worktree:"
    echo "  cd $WORKTREE_PATH"
    echo ""
    echo "To run an agent in this worktree:"
    echo "  cd $WORKTREE_PATH && claude \"your task description\""
    echo ""
    echo "To review changes:"
    echo "  git diff $BASE_BRANCH...$BRANCH_NAME"
    echo ""
    echo "To cleanup when done:"
    echo "  $0 --cleanup $TASK_NAME"
}

cleanup_worktree() {
    local TASK_NAME="$1"
    local WORKTREE_PATH="$WORKTREE_BASE/$TASK_NAME"
    local BRANCH_NAME="$BRANCH_PREFIX/$TASK_NAME"

    if [[ ! -d "$WORKTREE_PATH" ]]; then
        print_error "Worktree does not exist: $WORKTREE_PATH"
        exit 1
    fi

    # Check for uncommitted changes
    if [[ -n "$(cd "$WORKTREE_PATH" && git status --porcelain)" ]]; then
        print_warning "Worktree has uncommitted changes!"
        read -p "Are you sure you want to remove it? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_info "Cleanup cancelled"
            exit 0
        fi
    fi

    print_info "Removing worktree: $WORKTREE_PATH"
    git worktree remove "$WORKTREE_PATH" --force

    print_info "Removing branch: $BRANCH_NAME"
    git branch -D "$BRANCH_NAME" 2>/dev/null || true

    print_success "Worktree cleaned up successfully!"
}

list_worktrees() {
    print_info "Active worktrees:"
    echo ""
    git worktree list
    echo ""

    # Show agent-specific worktrees
    if [[ -d "$WORKTREE_BASE" ]]; then
        echo "Agent worktrees in $WORKTREE_BASE:"
        for dir in "$WORKTREE_BASE"/*/; do
            if [[ -d "$dir" ]]; then
                local name=$(basename "$dir")
                local branch=$(cd "$dir" && git branch --show-current 2>/dev/null || echo "unknown")
                local status=$(cd "$dir" && git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
                if [[ "$status" -gt 0 ]]; then
                    echo "  📁 $name (branch: $branch, $status uncommitted changes)"
                else
                    echo "  📁 $name (branch: $branch, clean)"
                fi
            fi
        done
    fi
}

check_sync_status() {
    print_info "Checking dependency sync status..."
    echo ""

    local MAIN_LOCKFILE_HASH=$(git hash-object ts/pnpm-lock.yaml 2>/dev/null || echo "not-found")

    if [[ "$MAIN_LOCKFILE_HASH" == "not-found" ]]; then
        print_warning "No pnpm-lock.yaml found in ts/"
        return
    fi

    echo "Main lockfile hash: ${MAIN_LOCKFILE_HASH:0:8}..."
    echo ""

    for worktree in $(git worktree list --porcelain | grep "^worktree" | cut -d' ' -f2); do
        if [[ -f "$worktree/ts/pnpm-lock.yaml" ]]; then
            local WT_HASH=$(git hash-object "$worktree/ts/pnpm-lock.yaml" 2>/dev/null || echo "unknown")
            local WT_NAME=$(basename "$worktree")

            if [[ "$WT_HASH" == "$MAIN_LOCKFILE_HASH" ]]; then
                print_success "$WT_NAME (in sync)"
            else
                print_warning "$WT_NAME (out of sync - run: cd $worktree/ts && pnpm install)"
            fi
        fi
    done
}

# ============================================================================
# Main Entry Point
# ============================================================================

case "${1:-}" in
    --help|-h)
        show_help
        ;;
    --cleanup)
        if [[ -z "${2:-}" ]]; then
            print_error "Task name required for cleanup"
            show_help
            exit 1
        fi
        cleanup_worktree "$2"
        ;;
    --list)
        list_worktrees
        ;;
    --sync)
        check_sync_status
        ;;
    "")
        print_error "Task name required"
        show_help
        exit 1
        ;;
    *)
        create_worktree "$1" "${2:-main}"
        ;;
esac
