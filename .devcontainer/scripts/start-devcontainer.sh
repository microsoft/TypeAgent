#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/../.." && pwd)
DEFAULT_WORKSPACE_FOLDER="$REPO_ROOT"

usage() {
    cat <<EOF
Usage: $(basename "$0") [options]

Start the TypeAgent devcontainer. Optionally configure host SSH access.

Options:
  --workspace-folder PATH        Workspace folder to open (default: repo root)
  --config PATH|NAME             Devcontainer config file. Accepts a path or
                                 a short name resolved against .devcontainer/:
                                   vnc    -> .devcontainer/vnc/devcontainer.json
                                   agent  -> .devcontainer/agent/devcontainer.json
  --recreate                     Recreate container before startup
  --rebuild                      Rebuild image and recreate container before startup
  --clean                        Remove container and associated Docker volumes
  --reset                        Rebuild image and clean volumes (--rebuild + --clean)
  --ssh                          After startup, run setup-ssh-access.sh
  --insecure-local               Pass through to setup-ssh-access.sh (implies --ssh)
  -h, --help                     Show this help text

Examples:
  $(basename "$0")
  $(basename "$0") --ssh
  $(basename "$0") --recreate --ssh
  $(basename "$0") --rebuild
  $(basename "$0") --config vnc
  $(basename "$0") --config agent
EOF
}

log() {
    printf '[start-devcontainer] %s\n' "$*"
}

fail() {
    printf '[start-devcontainer] Error: %s\n' "$*" >&2
    exit 1
}

read_git_identity() {
    local key=$1
    git config --global --get "$key" 2>/dev/null || true
}

WORKSPACE_FOLDER="$DEFAULT_WORKSPACE_FOLDER"
CONFIG_PATH=""
REMOVE_EXISTING=0
REBUILD=0
CLEAN_VOLUMES=0
SETUP_SSH=0
INSECURE_LOCAL=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --workspace-folder)
            [[ $# -ge 2 ]] || fail "Missing value for $1"
            WORKSPACE_FOLDER=$(cd -- "$2" && pwd)
            shift 2
            ;;
        --config)
            [[ $# -ge 2 ]] || fail "Missing value for $1"
            # Allow short names (e.g. `vnc`, `agent`) that resolve to
            # .devcontainer/<name>/devcontainer.json. Anything containing a
            # slash or ending in .json is treated as a literal path.
            _cfg_arg=$2
            if [[ "$_cfg_arg" != */* && "$_cfg_arg" != *.json ]]; then
                _short="$REPO_ROOT/.devcontainer/$_cfg_arg/devcontainer.json"
                if [[ -f "$_short" ]]; then
                    _cfg_arg="$_short"
                else
                    fail "Unknown config short name '$_cfg_arg' (expected $_short)"
                fi
            fi
            CONFIG_PATH=$(cd -- "$(dirname -- "$_cfg_arg")" && pwd)/$(basename -- "$_cfg_arg")
            shift 2
            ;;
        --recreate|--remove-existing-container)
            REMOVE_EXISTING=1
            shift
            ;;
        --rebuild)
            REMOVE_EXISTING=1
            REBUILD=1
            shift
            ;;
        --clean)
            REMOVE_EXISTING=1
            CLEAN_VOLUMES=1
            shift
            ;;
        --reset)
            REMOVE_EXISTING=1
            REBUILD=1
            CLEAN_VOLUMES=1
            shift
            ;;
        --ssh)
            SETUP_SSH=1
            shift
            ;;
        --insecure-local)
            SETUP_SSH=1
            INSECURE_LOCAL=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            fail "Unknown argument: $1"
            ;;
    esac
done

if ! command -v docker >/dev/null 2>&1; then
    fail "docker is required"
fi

if command -v devcontainer >/dev/null 2>&1; then
    DEVCONTAINER_CMD=(devcontainer)
else
    DEVCONTAINER_CMD=(npx -y @devcontainers/cli)
fi

HOST_GIT_USER_NAME=$(read_git_identity user.name)
HOST_GIT_USER_EMAIL=$(read_git_identity user.email)

if [[ -n "$HOST_GIT_USER_NAME" ]]; then
    export LOCAL_GIT_USER_NAME="$HOST_GIT_USER_NAME"
    log "Using host git user.name from ~/.gitconfig"
fi
if [[ -n "$HOST_GIT_USER_EMAIL" ]]; then
    export LOCAL_GIT_USER_EMAIL="$HOST_GIT_USER_EMAIL"
    log "Using host git user.email from ~/.gitconfig"
fi

UP_CMD=("${DEVCONTAINER_CMD[@]}" up --workspace-folder "$WORKSPACE_FOLDER")
if [[ -n "$CONFIG_PATH" ]]; then
    UP_CMD+=(--config "$CONFIG_PATH")
fi
if [[ $REMOVE_EXISTING -eq 1 ]]; then
    UP_CMD+=(--remove-existing-container)
fi
if [[ $REBUILD -eq 1 ]]; then
    UP_CMD+=(--build-no-cache)
fi

if [[ $CLEAN_VOLUMES -eq 1 ]]; then
    # Stop and remove the container first so volumes are no longer in use
    CONTAINER_ID=$(docker ps -aq --filter "label=devcontainer.local_folder=$WORKSPACE_FOLDER" | head -1)
    if [[ -n "$CONTAINER_ID" ]]; then
        log "Stopping container $CONTAINER_ID..."
        docker rm -f "$CONTAINER_ID" >/dev/null 2>&1 || true
    fi

    log "Removing Docker volumes..."
    VOLUME_PREFIXES=(
        "pnpm-global-store"
        "typeagent-node_modules-"
        "claude-code-config-"
    )
    for prefix in "${VOLUME_PREFIXES[@]}"; do
        for vol in $(docker volume ls -q --filter "name=^$prefix" 2>/dev/null); do
            if err=$(docker volume rm "$vol" 2>&1); then
                log "  removed $vol"
            else
                log "  warn: could not remove $vol: $err"
            fi
        done
    done
fi

log "Starting devcontainer..."
"${UP_CMD[@]}"

if [[ $SETUP_SSH -eq 1 ]]; then
    SSH_SETUP_CMD=("$SCRIPT_DIR/setup-ssh-access.sh" --workspace-folder "$WORKSPACE_FOLDER")
    if [[ -n "$CONFIG_PATH" ]]; then
        SSH_SETUP_CMD+=(--config "$CONFIG_PATH")
    fi
    if [[ $INSECURE_LOCAL -eq 1 ]]; then
        SSH_SETUP_CMD+=(--insecure-local)
    fi

    log "Configuring SSH access..."
    "${SSH_SETUP_CMD[@]}"

    printf '\nDone. Connect with:\n'
    printf '  ssh typeagent-devcontainer\n'
else
    printf '\nDone. Devcontainer is running.\n'
    printf 'To set up host SSH access, re-run with --ssh, or invoke:\n'
    printf '  %s/setup-ssh-access.sh\n' "$SCRIPT_DIR"
fi
