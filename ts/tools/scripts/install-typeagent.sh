#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

set -euo pipefail

VERSION="latest"
PLUGIN_VERSION="latest"
PLUGIN_PACKAGE_NAME="typeagent-copilot-plugin"
ORG="https://dev.azure.com/msctoproj"
PROJECT="AI_Systems"
FEED="typeagent"
PLUGIN_SOURCE=""
UPGRADE=0
NO_START=0

usage() {
  cat <<'EOF'
Usage: install-typeagent.sh [options]

Options:
  --version <version>                Agent-server package version (default: latest)
  --plugin-version <version>         Plugin package version (default: latest)
  --plugin-package-name <name>       Plugin package name (default: typeagent-copilot-plugin)
  --install-dir <path>               Agent-server install dir
  --plugin-source <path>             Use local plugin payload instead of downloading
  --plugin-install-dir <path>        Download/cache dir for plugin payload
  --plugin-marketplace-name <name>   Marketplace name (default: typeagent-local)
  --plugin-marketplace-dir <path>    Marketplace dir (default: ~/.copilot/marketplaces/typeagent-local)
  --org <url>                        Azure DevOps org URL
  --project <name>                   Azure DevOps project
  --feed <name>                      Azure Artifacts feed
  --upgrade                          Force fresh artifact download
  --no-start                         Do not start agent server after install
  --help                             Show this help
EOF
}

log_step() {
  echo "==> $*"
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

node_major() {
  node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))'
}

resolve_latest_upack_version() {
  local package_name="$1"
  local json

  json="$(az devops invoke \
    --organization "$ORG" \
    --area packaging --resource packages \
    --route-parameters project="$PROJECT" feedId="$FEED" \
    --query-parameters protocolType=upack packageNameQuery="$package_name" includeAllVersions=true \
    --api-version 7.1 --output json --only-show-errors)"

  node -e '
const input = process.argv[1];
const packageName = process.argv[2];
const data = JSON.parse(input);
const values = Array.isArray(data?.value) ? data.value : [];
const pkg = values.find((p) => p?.name === packageName && p?.protocolType === "upack");
if (!pkg) {
  console.error(`Package not found: ${packageName}`);
  process.exit(1);
}
const versions = (pkg.versions || []).filter((v) => !v?.isDeleted);
if (versions.length === 0) {
  console.error(`No versions available for: ${packageName}`);
  process.exit(1);
}
const latest = versions.find((v) => v?.isLatest) ||
  versions.sort((a, b) => String(b.publishDate || "").localeCompare(String(a.publishDate || "")))[0];
if (!latest?.version) {
  console.error(`Unable to resolve latest version for: ${packageName}`);
  process.exit(1);
}
process.stdout.write(String(latest.version));
' "$json" "$package_name"
}

detect_platform_arch() {
  local os_name arch_name
  os_name="$(uname -s)"
  arch_name="$(uname -m)"

  case "$os_name" in
    Linux) PLATFORM="linux" ;;
    Darwin) PLATFORM="darwin" ;;
    *) fail "Unsupported OS: $os_name" ;;
  esac

  case "$arch_name" in
    x86_64|amd64) ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *) fail "Unsupported architecture: $arch_name" ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --plugin-version) PLUGIN_VERSION="$2"; shift 2 ;;
    --plugin-package-name) PLUGIN_PACKAGE_NAME="$2"; shift 2 ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --plugin-source) PLUGIN_SOURCE="$2"; shift 2 ;;
    --plugin-install-dir) PLUGIN_INSTALL_DIR="$2"; shift 2 ;;
    --plugin-marketplace-name) PLUGIN_MARKETPLACE_NAME="$2"; shift 2 ;;
    --plugin-marketplace-dir) PLUGIN_MARKETPLACE_DIR="$2"; shift 2 ;;
    --org) ORG="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --feed) FEED="$2"; shift 2 ;;
    --upgrade) UPGRADE=1; shift ;;
    --no-start) NO_START=1; shift ;;
    --help) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
done

detect_platform_arch

if [[ -z "${INSTALL_DIR:-}" ]]; then
  if [[ "$PLATFORM" == "darwin" ]]; then
    INSTALL_DIR="$HOME/Library/Application Support/TypeAgent/agent-server"
  else
    INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/typeagent/agent-server"
  fi
fi
PLUGIN_INSTALL_DIR="${PLUGIN_INSTALL_DIR:-$HOME/.copilot/available-plugins/typeagent}"
PLUGIN_MARKETPLACE_NAME="${PLUGIN_MARKETPLACE_NAME:-typeagent-local}"
PLUGIN_MARKETPLACE_DIR="${PLUGIN_MARKETPLACE_DIR:-$HOME/.copilot/marketplaces/typeagent-local}"
PLUGIN_REGISTER_LOG="${XDG_STATE_HOME:-$HOME/.local/state}/typeagent/register-plugin.log"

require_cmd node
if [[ "$(node_major)" -lt 22 ]]; then
  fail "Node.js >= 22 required; found $(node --version)"
fi

require_cmd az
if ! az account show --only-show-errors >/dev/null 2>&1; then
  log_step "Not logged into Azure CLI; launching az login"
  az login --only-show-errors >/dev/null
fi

az extension add --name azure-devops --only-show-errors >/dev/null 2>&1 || true
az devops configure --defaults organization="$ORG" project="$PROJECT" --only-show-errors >/dev/null 2>&1 || true

RID="$PLATFORM-$ARCH"
AGENT_PACKAGE="agent-server.$RID"
SERVE="$INSTALL_DIR/typeagent-serve.mjs"

if [[ "$UPGRADE" -eq 1 && -d "$INSTALL_DIR" ]]; then
  log_step "Upgrade requested; removing existing agent-server payload"
  rm -rf "$INSTALL_DIR"
fi

if [[ -f "$SERVE" ]]; then
  log_step "Using existing agent-server payload at $INSTALL_DIR"
else
  mkdir -p "$INSTALL_DIR"
  RESOLVED_VERSION="$VERSION"
  if [[ "$VERSION" == "latest" ]]; then
    log_step "Resolving latest version for $AGENT_PACKAGE"
    RESOLVED_VERSION="$(resolve_latest_upack_version "$AGENT_PACKAGE")"
    log_step "Resolved agent-server version: $RESOLVED_VERSION"
  fi

  log_step "Downloading $AGENT_PACKAGE ($RESOLVED_VERSION)"
  az artifacts universal download \
    --organization "$ORG" \
    --project "$PROJECT" \
    --scope project \
    --feed "$FEED" \
    --name "$AGENT_PACKAGE" \
    --version "$RESOLVED_VERSION" \
    --path "$INSTALL_DIR" \
    --only-show-errors >/dev/null
fi

[[ -f "$SERVE" ]] || fail "Agent-server payload is missing typeagent-serve.mjs"

require_cmd copilot || {
  require_cmd npm
  log_step "Installing GitHub Copilot CLI"
  npm install -g @github/copilot >/dev/null
  require_cmd copilot
}

PLUGIN_SOURCE_DIR="$PLUGIN_INSTALL_DIR"
if [[ -n "$PLUGIN_SOURCE" ]]; then
  PLUGIN_SOURCE_DIR="$PLUGIN_SOURCE"
elif [[ "$UPGRADE" -eq 1 && -d "$PLUGIN_INSTALL_DIR" ]]; then
  rm -rf "$PLUGIN_INSTALL_DIR"
fi

if [[ -z "$PLUGIN_SOURCE" && ! -f "$PLUGIN_SOURCE_DIR/plugin.json" ]]; then
  mkdir -p "$PLUGIN_SOURCE_DIR"
  RESOLVED_PLUGIN_VERSION="$PLUGIN_VERSION"
  if [[ "$PLUGIN_VERSION" == "latest" ]]; then
    log_step "Resolving latest version for $PLUGIN_PACKAGE_NAME"
    RESOLVED_PLUGIN_VERSION="$(resolve_latest_upack_version "$PLUGIN_PACKAGE_NAME")"
    log_step "Resolved plugin version: $RESOLVED_PLUGIN_VERSION"
  fi

  log_step "Downloading $PLUGIN_PACKAGE_NAME ($RESOLVED_PLUGIN_VERSION)"
  az artifacts universal download \
    --organization "$ORG" \
    --project "$PROJECT" \
    --scope project \
    --feed "$FEED" \
    --name "$PLUGIN_PACKAGE_NAME" \
    --version "$RESOLVED_PLUGIN_VERSION" \
    --path "$PLUGIN_SOURCE_DIR" \
    --only-show-errors >/dev/null
fi

[[ -f "$PLUGIN_SOURCE_DIR/plugin.json" ]] || fail "Plugin source missing plugin.json"
[[ -f "$PLUGIN_SOURCE_DIR/dist/mcp/server.js" ]] || fail "Plugin source missing dist/mcp/server.js"

REGISTER_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../installers/common/register-plugin.mjs"
[[ -f "$REGISTER_SCRIPT" ]] || fail "Shared plugin registration script not found: $REGISTER_SCRIPT"

log_step "Registering copilot plugin"
node "$REGISTER_SCRIPT" \
  --install-dir "$INSTALL_DIR" \
  --plugin-source-dir "$PLUGIN_SOURCE_DIR" \
  --marketplace-name "$PLUGIN_MARKETPLACE_NAME" \
  --marketplace-root "$PLUGIN_MARKETPLACE_DIR" \
  --plugin-name typeagent \
  --log-path "$PLUGIN_REGISTER_LOG"

log_step "Provisioning TypeAgent config"
node "$SERVE" provision

if [[ "$NO_START" -eq 0 ]]; then
  log_step "Starting agent server"
  node "$SERVE" start
fi

echo ""
echo "TypeAgent installed at $INSTALL_DIR"
echo "  Start:  node \"$SERVE\" start"
echo "  Status: node \"$SERVE\" status"
echo "  Logs:   node \"$SERVE\" logs"
echo "  Stop:   node \"$SERVE\" stop"
