#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/../.." && pwd)
WORKSPACE_FOLDER=$(cd -- "$REPO_ROOT" && pwd)
DEFAULT_KEY_NAME="typeagent-devcontainer"
DEFAULT_KEY_PATH="$HOME/.ssh/$DEFAULT_KEY_NAME"
DEFAULT_CONFIG_PATH="$HOME/.ssh/config"
DEFAULT_LOCAL_PORT="2222"
REMOTE_USER="codespace"

usage() {
    cat <<EOF
Usage: $(basename "$0") [options]

Set up SSH key access to the running TypeAgent devcontainer.

Options:
  --workspace-folder PATH   Workspace folder to match (default: repo root)
  --config PATH             Devcontainer config file to match (optional)
  --key-path PATH           Private key path to use (default: $DEFAULT_KEY_PATH)
  --host-alias NAME         SSH host alias to write to ~/.ssh/config (default: typeagent-devcontainer)
  --local-port PORT         Local SSH port to expose in ssh config (default: $DEFAULT_LOCAL_PORT)
    --insecure-local          Disable host key verification for local-only workflows
  --print-only              Do not modify files or container state; print detected values only
  -h, --help                Show this help text
EOF
}

log() {
    printf '[setup-ssh-access] %s\n' "$*"
}

fail() {
    printf '[setup-ssh-access] Error: %s\n' "$*" >&2
    exit 1
}

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

is_wsl() {
    [[ -n "${WSL_DISTRO_NAME:-}" ]] || grep -qiE "microsoft|wsl" /proc/version 2>/dev/null
}

ensure_ssh_config_block() {
    local config_path=$1
    local host_alias=$2
    local key_path_for_config=$3
    local strict_host_key_checking=$4
    local user_known_hosts_file=$5
    local global_known_hosts_file=$6

    local ssh_config_block
    ssh_config_block=$(cat <<EOF
Host $host_alias
    HostName localhost
    Port $LOCAL_PORT
    User $REMOTE_USER
    IdentityFile $key_path_for_config
    IdentitiesOnly yes
    PreferredAuthentications publickey
    PubkeyAuthentication yes
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    StrictHostKeyChecking $strict_host_key_checking
    UserKnownHostsFile $user_known_hosts_file
    GlobalKnownHostsFile $global_known_hosts_file
EOF
)

    local config_begin_marker="# BEGIN typeagent-devcontainer:$host_alias"
    local config_end_marker="# END typeagent-devcontainer:$host_alias"
    local legacy_marker="# typeagent-devcontainer:$host_alias"

    mkdir -p "$(dirname "$config_path")"
    touch "$config_path"
    chmod 600 "$config_path" 2>/dev/null || true

    if [[ $PRINT_ONLY -eq 1 ]]; then
        log "Would ensure SSH config block in $config_path"
        return 0
    fi

    local tmp_file
    tmp_file=$(mktemp)
    trap 'rm -f "$tmp_file"' RETURN

    awk \
        -v alias="$host_alias" \
        -v begin_marker="$config_begin_marker" \
        -v end_marker="$config_end_marker" \
        -v legacy_marker="$legacy_marker" '
        $0 == begin_marker { in_managed=1; next }
        in_managed {
            if ($0 == end_marker) {
                in_managed=0
            }
            next
        }
        $0 == legacy_marker { next }
        $0 ~ ("^Host[[:space:]]+" alias "$") { in_alias_stanza=1; next }
        in_alias_stanza {
            if ($0 ~ /^Host[[:space:]]+/) {
                in_alias_stanza=0
                print
            }
            next
        }
        { print }
    ' "$config_path" > "$tmp_file"
    mv "$tmp_file" "$config_path"
    trap - RETURN

    {
        if [[ -s "$config_path" ]] && [[ "$(tail -c 1 "$config_path")" != "" ]]; then
            printf '\n'
        fi
        printf '%s\n%s\n%s\n' "$config_begin_marker" "$ssh_config_block" "$config_end_marker"
    } >> "$config_path"
}

WORKSPACE_MATCH="$WORKSPACE_FOLDER"
CONFIG_MATCH=""
KEY_PATH="$DEFAULT_KEY_PATH"
HOST_ALIAS="$DEFAULT_KEY_NAME"
LOCAL_PORT="$DEFAULT_LOCAL_PORT"
PRINT_ONLY=0
INSECURE_LOCAL=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --workspace-folder)
            [[ $# -ge 2 ]] || fail "Missing value for $1"
            WORKSPACE_MATCH=$(cd -- "$2" && pwd)
            shift 2
            ;;
        --config)
            [[ $# -ge 2 ]] || fail "Missing value for $1"
            CONFIG_MATCH=$(cd -- "$(dirname -- "$2")" && pwd)/$(basename -- "$2")
            shift 2
            ;;
        --key-path)
            [[ $# -ge 2 ]] || fail "Missing value for $1"
            KEY_PATH="$2"
            shift 2
            ;;
        --host-alias)
            [[ $# -ge 2 ]] || fail "Missing value for $1"
            HOST_ALIAS="$2"
            shift 2
            ;;
        --local-port)
            [[ $# -ge 2 ]] || fail "Missing value for $1"
            LOCAL_PORT="$2"
            shift 2
            ;;
        --insecure-local)
            INSECURE_LOCAL=1
            shift
            ;;
        --print-only)
            PRINT_ONLY=1
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

require_cmd docker
require_cmd jq
require_cmd ssh-keygen
require_cmd ssh

[[ "$HOST_ALIAS" =~ ^[a-zA-Z0-9._-]+$ ]] || fail "Invalid host alias: $HOST_ALIAS"
[[ "$LOCAL_PORT" =~ ^[0-9]+$ ]] || fail "Invalid local port: $LOCAL_PORT"

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"

STRICT_HOST_KEY_CHECKING="accept-new"
USER_KNOWN_HOSTS_FILE="$HOME/.ssh/known_hosts"
GLOBAL_KNOWN_HOSTS_FILE="/etc/ssh/ssh_known_hosts"
if [[ $INSECURE_LOCAL -eq 1 ]]; then
    STRICT_HOST_KEY_CHECKING="no"
    USER_KNOWN_HOSTS_FILE="/dev/null"
    GLOBAL_KNOWN_HOSTS_FILE="/dev/null"
fi

find_container() {
    local workspace=$1
    local config=$2
    local container_ids=()
    mapfile -t container_ids < <(docker ps -q)
    [[ ${#container_ids[@]} -gt 0 ]] || return 0

    docker inspect "${container_ids[@]}" | jq -r --arg workspace "$workspace" --arg config "$config" '
        .[]
        | select(.Config.Labels["devcontainer.local_folder"] == $workspace)
        | select(($config == "") or (.Config.Labels["devcontainer.config_file"] == $config))
        | .Name
        | ltrimstr("/")
    ' | head -n 1
}

CONTAINER_NAME=$(find_container "$WORKSPACE_MATCH" "$CONFIG_MATCH")
[[ -n "$CONTAINER_NAME" ]] || fail "No running devcontainer found for $WORKSPACE_MATCH${CONFIG_MATCH:+ using $CONFIG_MATCH}"

log "Using container: $CONTAINER_NAME"
log "Workspace match: $WORKSPACE_MATCH"
if [[ -n "$CONFIG_MATCH" ]]; then
    log "Config match: $CONFIG_MATCH"
fi

if [[ ! -f "$KEY_PATH" ]]; then
    if [[ $PRINT_ONLY -eq 1 ]]; then
        log "Would create SSH key: $KEY_PATH"
    else
        log "Creating SSH key: $KEY_PATH"
        ssh-keygen -t ed25519 -f "$KEY_PATH" -N '' -C "$HOST_ALIAS"
    fi
else
    log "Using existing SSH key: $KEY_PATH"
fi

PUB_KEY_PATH="$KEY_PATH.pub"
if [[ ! -f "$PUB_KEY_PATH" ]]; then
    if [[ $PRINT_ONLY -eq 1 ]]; then
        log "Would create public key: $PUB_KEY_PATH"
        PUB_KEY=""
    else
        fail "Public key not found: $PUB_KEY_PATH"
    fi
else
    PUB_KEY=$(cat "$PUB_KEY_PATH")
fi

if [[ $PRINT_ONLY -eq 1 ]]; then
    log "Would install public key into container user $REMOTE_USER"
else
    log "Installing public key into container authorized_keys if needed"
    docker exec -u "$REMOTE_USER" "$CONTAINER_NAME" sh -lc '
        set -eu
        umask 077
        mkdir -p "$HOME/.ssh"
        touch "$HOME/.ssh/authorized_keys"
        chmod 700 "$HOME/.ssh"
        chmod 600 "$HOME/.ssh/authorized_keys"
    '

    docker exec -i -u "$REMOTE_USER" "$CONTAINER_NAME" sh -lc '
        set -eu
        key=$(cat)
        auth="$HOME/.ssh/authorized_keys"
        if ! grep -Fqx "$key" "$auth"; then
            printf "%s\n" "$key" >> "$auth"
            echo "added"
        else
            echo "present"
        fi
    ' <<< "$PUB_KEY" >/tmp/typeagent-devcontainer-ssh-key-status.$$ || fail "Failed to install public key into container"

    KEY_STATUS=$(cat /tmp/typeagent-devcontainer-ssh-key-status.$$)
    rm -f /tmp/typeagent-devcontainer-ssh-key-status.$$
    log "Container key status: $KEY_STATUS"
fi

if [[ $PRINT_ONLY -eq 1 ]]; then
    log "Would harden container sshd to key-only authentication"
else
    log "Hardening container sshd configuration to key-only authentication"
    docker exec -u root "$CONTAINER_NAME" sh -lc '
        set -eu
        install -d -m 755 /etc/ssh/sshd_config.d
        cat > /etc/ssh/sshd_config.d/99-typeagent-key-only.conf <<"EOF"
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
UsePAM yes
EOF

        if pgrep sshd >/dev/null 2>&1; then
            pkill -HUP sshd || true
        elif command -v service >/dev/null 2>&1; then
            service ssh restart || service sshd restart || true
        fi
    ' || fail "Failed to harden sshd in container"
    log "Container sshd hardening applied"
fi

CONFIG_PATH="$DEFAULT_CONFIG_PATH"
log "Writing SSH config block for $HOST_ALIAS"
ensure_ssh_config_block \
    "$CONFIG_PATH" \
    "$HOST_ALIAS" \
    "$KEY_PATH" \
    "$STRICT_HOST_KEY_CHECKING" \
    "$USER_KNOWN_HOSTS_FILE" \
    "$GLOBAL_KNOWN_HOSTS_FILE"

if is_wsl; then
    if ! command -v cmd.exe >/dev/null 2>&1 || ! command -v wslpath >/dev/null 2>&1; then
        log "Warning: WSL detected but cmd.exe / wslpath unavailable; skipping Windows SSH sync"
    else
        WINDOWS_USERPROFILE_WIN=$(cmd.exe /C "echo %USERPROFILE%" 2>/dev/null | tr -d '\r' || true)
        if [[ -z "$WINDOWS_USERPROFILE_WIN" ]] || [[ "$WINDOWS_USERPROFILE_WIN" == "%USERPROFILE%" ]]; then
            log "Warning: could not resolve Windows %USERPROFILE%; skipping Windows SSH sync"
        else
            WINDOWS_USERPROFILE_WSL=$(wslpath -u "$WINDOWS_USERPROFILE_WIN" 2>/dev/null || true)
            if [[ -z "$WINDOWS_USERPROFILE_WSL" ]]; then
                log "Warning: wslpath could not translate %USERPROFILE% ($WINDOWS_USERPROFILE_WIN); skipping Windows SSH sync"
            else
                WINDOWS_SSH_DIR_WSL="$WINDOWS_USERPROFILE_WSL/.ssh"
                WINDOWS_KEY_BASENAME=$(basename "$KEY_PATH")
                WINDOWS_KEY_PATH_WSL="$WINDOWS_SSH_DIR_WSL/$WINDOWS_KEY_BASENAME"
                WINDOWS_PUB_KEY_PATH_WSL="$WINDOWS_KEY_PATH_WSL.pub"
                WINDOWS_CONFIG_PATH_WSL="$WINDOWS_SSH_DIR_WSL/config"
                WINDOWS_KEY_PATH_CONFIG=$(wslpath -m "$WINDOWS_KEY_PATH_WSL" 2>/dev/null || true)
                WINDOWS_KNOWN_HOSTS_CONFIG=$(wslpath -m "$WINDOWS_SSH_DIR_WSL/known_hosts" 2>/dev/null || true)
                [[ -n "$WINDOWS_KEY_PATH_CONFIG" ]] || fail "Failed to convert WSL key path to Windows path"
                [[ -n "$WINDOWS_KNOWN_HOSTS_CONFIG" ]] || fail "Failed to convert WSL known_hosts path to Windows path"

                if [[ $PRINT_ONLY -eq 1 ]]; then
                    log "Would copy keypair to Windows SSH dir: $WINDOWS_SSH_DIR_WSL"
                else
                    mkdir -p "$WINDOWS_SSH_DIR_WSL"
                    cp -f "$KEY_PATH" "$WINDOWS_KEY_PATH_WSL"
                    cp -f "$PUB_KEY_PATH" "$WINDOWS_PUB_KEY_PATH_WSL"
                    log "Copied keypair to Windows SSH dir: $WINDOWS_SSH_DIR_WSL"
                fi

                log "Writing Windows SSH config block for $HOST_ALIAS"
                ensure_ssh_config_block \
                    "$WINDOWS_CONFIG_PATH_WSL" \
                    "$HOST_ALIAS" \
                    "$WINDOWS_KEY_PATH_CONFIG" \
                    "$STRICT_HOST_KEY_CHECKING" \
                    "$WINDOWS_KNOWN_HOSTS_CONFIG" \
                    "none"
            fi
        fi
    fi
fi

printf '\nSSH setup complete.\n\n'
printf 'Container: %s\n' "$CONTAINER_NAME"
printf 'Host alias: %s\n' "$HOST_ALIAS"
printf 'Key: %s\n' "$KEY_PATH"
printf 'Local port: %s\n\n' "$LOCAL_PORT"
printf 'Connect with:\n'
printf '  ssh %s\n\n' "$HOST_ALIAS"
printf 'Or without SSH config:\n'
printf '  ssh -i %s -p %s %s@localhost\n' "$KEY_PATH" "$LOCAL_PORT" "$REMOTE_USER"
