#!/bin/bash
#
# TypeAgent DevContainer Setup Script for macOS, Linux, and WSL
#
# This script detects your environment, checks prerequisites, installs missing
# components, and guides you through setting up the DevContainer environment.
#
# Usage:
#   ./setup-devcontainer.sh                    # Check prerequisites only
#   ./setup-devcontainer.sh --install          # Install missing prerequisites
#   ./setup-devcontainer.sh --install --sandbox # Also install Docker Sandbox (sbx)
#   ./setup-devcontainer.sh --help             # Show help
#

set -e

# ============================================================================
# Configuration
# ============================================================================

INSTALL_MISSING=false
INSTALL_SANDBOX=false
SKIP_DOCKER=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
GRAY='\033[0;37m'
NC='\033[0m' # No Color

# ============================================================================
# Output Functions
# ============================================================================

print_title() {
    echo -e "\n${CYAN}$1${NC}"
}

print_success() {
    echo -e "  ${GREEN}[OK]${NC} $1"
}

print_warning() {
    echo -e "  ${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "  ${RED}[X]${NC} $1"
}

print_info() {
    echo -e "  ${WHITE}$1${NC}"
}

print_cmd() {
    echo -e "     ${YELLOW}$1${NC}"
}

# ============================================================================
# Environment Detection
# ============================================================================

detect_environment() {
    PLATFORM="unknown"
    IS_WSL=false
    IS_WSL2=false
    HAS_WSLG=false
    IS_MACOS=false
    IS_LINUX=false
    HAS_HOMEBREW=false
    HAS_APT=false
    HAS_DNF=false
    DISTRO=""

    # Check for WSL
    if [[ -n "$WSL_DISTRO_NAME" ]] || grep -qi "microsoft\|wsl" /proc/version 2>/dev/null; then
        IS_WSL=true
        PLATFORM="wsl"
        DISTRO="$WSL_DISTRO_NAME"

        # Check for WSL2
        if grep -qi "WSL2\|microsoft-standard" /proc/version 2>/dev/null; then
            IS_WSL2=true
        fi

        # Check for WSLg
        if [[ -n "$DISPLAY" ]] || [[ -n "$WAYLAND_DISPLAY" ]]; then
            HAS_WSLG=true
        fi
    elif [[ "$(uname)" == "Darwin" ]]; then
        IS_MACOS=true
        PLATFORM="macos"
        # Check for Homebrew
        if command -v brew &> /dev/null; then
            HAS_HOMEBREW=true
        fi
    elif [[ "$(uname)" == "Linux" ]]; then
        IS_LINUX=true
        PLATFORM="linux"

        # Detect distro
        if [[ -f /etc/os-release ]]; then
            DISTRO=$(grep -oP '(?<=^ID=).+' /etc/os-release | tr -d '"')
        fi
    fi

    # Check package managers
    if command -v apt-get &> /dev/null; then
        HAS_APT=true
    fi
    if command -v dnf &> /dev/null; then
        HAS_DNF=true
    fi
    if command -v brew &> /dev/null; then
        HAS_HOMEBREW=true
    fi
}

# ============================================================================
# Prerequisite Checks
# ============================================================================

check_docker() {
    DOCKER_INSTALLED=false
    DOCKER_RUNNING=false
    DOCKER_VERSION=""

    if command -v docker &> /dev/null; then
        DOCKER_INSTALLED=true
        DOCKER_VERSION=$(docker --version 2>/dev/null | sed 's/Docker version //' | cut -d',' -f1)

        if docker info &> /dev/null; then
            DOCKER_RUNNING=true
        fi
    fi
}

check_vscode() {
    VSCODE_INSTALLED=false
    VSCODE_VERSION=""

    if command -v code &> /dev/null; then
        VSCODE_INSTALLED=true
        VSCODE_VERSION=$(code --version 2>/dev/null | head -1)
    fi
}

check_devcontainers_cli() {
    DEVCONTAINERS_CLI_INSTALLED=false
    DEVCONTAINERS_CLI_VERSION=""

    if command -v devcontainer &> /dev/null; then
        DEVCONTAINERS_CLI_INSTALLED=true
        DEVCONTAINERS_CLI_VERSION=$(devcontainer --version 2>/dev/null)
    fi
}

check_git() {
    GIT_INSTALLED=false
    GIT_VERSION=""

    if command -v git &> /dev/null; then
        GIT_INSTALLED=true
        GIT_VERSION=$(git --version 2>/dev/null | sed 's/git version //')
    fi
}

check_node() {
    NODE_INSTALLED=false
    NODE_VERSION=""

    if command -v node &> /dev/null; then
        NODE_INSTALLED=true
        NODE_VERSION=$(node --version 2>/dev/null)
    fi
}

check_pnpm() {
    PNPM_INSTALLED=false
    PNPM_VERSION=""

    if command -v pnpm &> /dev/null; then
        PNPM_INSTALLED=true
        PNPM_VERSION=$(pnpm --version 2>/dev/null)
    fi
}

check_docker_sandbox() {
    SBX_INSTALLED=false
    SBX_VERSION=""

    if command -v sbx &> /dev/null; then
        SBX_INSTALLED=true
        SBX_VERSION=$(sbx --version 2>/dev/null)
    fi
}

check_all_prerequisites() {
    check_docker
    check_vscode
    check_devcontainers_cli
    check_git
    check_node
    check_pnpm
    check_docker_sandbox
}

# ============================================================================
# Installation Functions
# ============================================================================

install_homebrew() {
    print_info "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
}

install_docker_macos() {
    print_info "Installing Docker Desktop for macOS..."
    if $HAS_HOMEBREW; then
        brew install --cask docker
        print_warning "Docker Desktop installed. Please start it from Applications."
    else
        print_error "Homebrew not found. Please install Docker Desktop manually from https://docker.com"
        return 1
    fi
}

install_docker_linux() {
    print_info "Installing Docker..."

    if $HAS_APT; then
        # Debian/Ubuntu
        sudo apt-get update
        sudo apt-get install -y ca-certificates curl gnupg
        sudo install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        sudo chmod a+r /etc/apt/keyrings/docker.gpg

        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

        sudo apt-get update
        sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

        # Add user to docker group
        sudo usermod -aG docker $USER
        print_warning "Added $USER to docker group. Please log out and back in for this to take effect."
    elif $HAS_DNF; then
        # Fedora/RHEL
        sudo dnf -y install dnf-plugins-core
        sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
        sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
        sudo systemctl start docker
        sudo systemctl enable docker
        sudo usermod -aG docker $USER
    else
        print_error "Unsupported package manager. Please install Docker manually."
        return 1
    fi
}

install_docker_wsl() {
    print_info "For WSL, Docker Desktop should be installed on Windows."
    print_info "Install Docker Desktop on Windows and enable WSL2 integration."
    print_cmd "winget install Docker.DockerDesktop"
    return 1
}

install_vscode_macos() {
    print_info "Installing VS Code..."
    if $HAS_HOMEBREW; then
        brew install --cask visual-studio-code
    else
        print_error "Homebrew not found. Please install VS Code manually."
        return 1
    fi
}

install_vscode_linux() {
    print_info "Installing VS Code..."

    if $HAS_APT; then
        wget -qO- https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > packages.microsoft.gpg
        sudo install -D -o root -g root -m 644 packages.microsoft.gpg /etc/apt/keyrings/packages.microsoft.gpg
        sudo sh -c 'echo "deb [arch=amd64,arm64,armhf signed-by=/etc/apt/keyrings/packages.microsoft.gpg] https://packages.microsoft.com/repos/code stable main" > /etc/apt/sources.list.d/vscode.list'
        rm -f packages.microsoft.gpg
        sudo apt-get update
        sudo apt-get install -y code
    elif $HAS_DNF; then
        sudo rpm --import https://packages.microsoft.com/keys/microsoft.asc
        sudo sh -c 'echo -e "[code]\nname=Visual Studio Code\nbaseurl=https://packages.microsoft.com/yumrepos/vscode\nenabled=1\ngpgcheck=1\ngpgkey=https://packages.microsoft.com/keys/microsoft.asc" > /etc/yum.repos.d/vscode.repo'
        sudo dnf install -y code
    else
        print_error "Unsupported package manager. Please install VS Code manually."
        return 1
    fi
}

install_git_macos() {
    print_info "Installing Git..."
    if $HAS_HOMEBREW; then
        brew install git
    else
        # Git comes with Xcode command line tools
        xcode-select --install
    fi
}

install_git_linux() {
    print_info "Installing Git..."
    if $HAS_APT; then
        sudo apt-get update && sudo apt-get install -y git
    elif $HAS_DNF; then
        sudo dnf install -y git
    fi
}

install_docker_sandbox_macos() {
    print_info "Installing Docker Sandbox (sbx)..."
    if $HAS_HOMEBREW; then
        brew install docker/tap/sbx
    else
        print_error "Homebrew required. Install Homebrew first."
        return 1
    fi
}

install_docker_sandbox_linux() {
    print_info "Installing Docker Sandbox (sbx)..."
    curl -fsSL https://get.docker.com/sbx | sh
}

install_vscode_extensions() {
    print_info "Installing VS Code extensions..."
    code --install-extension ms-vscode-remote.remote-containers --force 2>/dev/null || true
    code --install-extension ms-vscode-remote.remote-wsl --force 2>/dev/null || true
}

install_devcontainers_cli() {
    print_info "Installing Dev Containers CLI..."
    if command -v npm &> /dev/null; then
        npm install -g @devcontainers/cli
    else
        print_warning "npm not found. Dev Containers CLI installation skipped."
    fi
}

# ============================================================================
# Display Functions
# ============================================================================

show_banner() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║          TypeAgent DevContainer Setup                        ║${NC}"
    echo -e "${CYAN}║          AI Agent Sandboxing Environment                     ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

show_environment_info() {
    print_title "Environment Detection"

    case $PLATFORM in
        macos)
            print_success "Platform: macOS"
            if $HAS_HOMEBREW; then
                print_success "  Homebrew: Installed"
            else
                print_warning "  Homebrew: Not installed (recommended)"
            fi
            ;;
        linux)
            print_success "Platform: Linux ($DISTRO)"
            ;;
        wsl)
            print_success "Platform: WSL ($DISTRO)"
            if $IS_WSL2; then
                print_success "  WSL Version: WSL2"
            else
                print_warning "  WSL Version: WSL1 (WSL2 recommended)"
            fi
            if $HAS_WSLG; then
                print_success "  WSLg (GUI): Available"
            else
                print_warning "  WSLg (GUI): Not detected"
            fi

            # Check filesystem location
            if [[ "$PWD" == /mnt/* ]]; then
                print_warning "  Repository on Windows filesystem (/mnt/...)"
                print_info "    Consider moving to WSL filesystem for better performance"
            else
                print_success "  Repository on WSL filesystem"
            fi
            ;;
        *)
            print_warning "Platform: Unknown"
            ;;
    esac
}

show_prerequisite_status() {
    print_title "Prerequisite Check"

    # Docker
    if $DOCKER_INSTALLED; then
        if $DOCKER_RUNNING; then
            print_success "Docker: $DOCKER_VERSION (running)"
        else
            print_warning "Docker: $DOCKER_VERSION (not running)"
        fi
    else
        print_error "Docker: Not installed"
    fi

    # VS Code
    if $VSCODE_INSTALLED; then
        print_success "VS Code: $VSCODE_VERSION"
    else
        print_error "VS Code: Not installed"
    fi

    # Dev Containers CLI
    if $DEVCONTAINERS_CLI_INSTALLED; then
        print_success "Dev Containers CLI: $DEVCONTAINERS_CLI_VERSION"
    else
        print_info "Dev Containers CLI: Not installed (optional)"
    fi

    # Git
    if $GIT_INSTALLED; then
        print_success "Git: $GIT_VERSION"
    else
        print_error "Git: Not installed"
    fi

    # Node
    if $NODE_INSTALLED; then
        print_success "Node.js: $NODE_VERSION"
    else
        print_info "Node.js: Not installed (needed for host development)"
    fi

    # pnpm
    if $PNPM_INSTALLED; then
        print_success "pnpm: $PNPM_VERSION"
    else
        print_info "pnpm: Not installed (needed for host development)"
    fi

    # Docker Sandbox
    if $SBX_INSTALLED; then
        print_success "Docker Sandbox (sbx): $SBX_VERSION"
    else
        print_info "Docker Sandbox (sbx): Not installed (optional, for MicroVM isolation)"
    fi
}

show_platform_recommendations() {
    print_title "Platform-Specific Recommendations"

    case $PLATFORM in
        macos)
            print_success "macOS is well-suited for container development!"
            print_info "  - Docker Desktop provides native performance"
            print_info "  - All TypeAgent components work in container"
            if ! $HAS_HOMEBREW; then
                echo ""
                print_info "Install Homebrew for easier package management:"
                print_cmd '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
            fi
            ;;
        linux)
            print_success "Linux provides native container performance!"
            print_info "  - Docker runs natively (no VM overhead)"
            print_info "  - All TypeAgent components work in container"
            ;;
        wsl)
            if $IS_WSL2 && $HAS_WSLG; then
                print_success "WSL2 + WSLg - Optimal configuration!"
                print_info "  - Electron shell works inside container"
                print_info "  - GUI windows appear on Windows desktop"
            elif $IS_WSL2; then
                print_success "WSL2 detected - Good performance!"
                print_warning "  WSLg not detected - Use hybrid approach for Electron shell"
                print_info "    - Run server in container: pnpm run server"
                print_info "    - Run shell on Windows: pnpm run shell"
            else
                print_warning "WSL1 detected - Consider upgrading to WSL2"
                print_cmd "wsl --set-version $WSL_DISTRO_NAME 2"
            fi

            if [[ "$PWD" == /mnt/* ]]; then
                echo ""
                print_warning "For better performance, move repository to WSL filesystem:"
                print_cmd "cp -r . ~/TypeAgent && cd ~/TypeAgent"
            fi
            ;;
    esac
}

show_next_steps() {
    print_title "Next Steps"

    ALL_GOOD=false
    if $DOCKER_RUNNING && $VSCODE_INSTALLED && $GIT_INSTALLED; then
        ALL_GOOD=true
    fi

    if $ALL_GOOD; then
        print_success "All prerequisites are ready!"
        echo ""
        print_info "To start using DevContainers:"
        echo ""
        echo -e "  ${WHITE}1. Navigate to the TypeAgent repository:${NC}"
        print_cmd "cd ~/TypeAgent  # or your repo location"
        echo ""
        echo -e "  ${WHITE}2. Open in VS Code:${NC}"
        print_cmd "code ."
        echo ""
        echo -e "  ${WHITE}3. When prompted, click 'Reopen in Container'${NC}"
        echo -e "     ${GRAY}Or press F1 and select 'Dev Containers: Reopen in Container'${NC}"
        echo ""
        echo -e "  ${WHITE}4. Wait for container to build (~5 minutes first time)${NC}"
        echo ""
        echo -e "  ${WHITE}5. Start developing:${NC}"
        print_cmd "cd ts && pnpm install && pnpm run build"
        echo ""

        if $SBX_INSTALLED; then
            print_info "Docker Sandbox (sbx) is available for MicroVM isolation:"
            print_cmd "sbx run --mount ./ts:/workspace claude"
        fi
    else
        print_warning "Some prerequisites are missing or not running."
        echo ""

        if ! $DOCKER_INSTALLED; then
            case $PLATFORM in
                macos)
                    print_info "Install Docker Desktop:"
                    print_cmd "brew install --cask docker"
                    ;;
                linux)
                    print_info "Install Docker:"
                    print_cmd "curl -fsSL https://get.docker.com | sh"
                    ;;
                wsl)
                    print_info "Install Docker Desktop on Windows with WSL2 integration"
                    ;;
            esac
        elif ! $DOCKER_RUNNING; then
            print_info "Start Docker Desktop"
        fi

        if ! $VSCODE_INSTALLED; then
            case $PLATFORM in
                macos)
                    print_cmd "brew install --cask visual-studio-code"
                    ;;
                linux)
                    print_info "Download VS Code from https://code.visualstudio.com"
                    ;;
                wsl)
                    print_info "Install VS Code on Windows, then run 'code .' from WSL"
                    ;;
            esac
        fi

        if ! $GIT_INSTALLED; then
            case $PLATFORM in
                macos)
                    print_cmd "brew install git"
                    ;;
                linux)
                    print_cmd "sudo apt install git  # or: sudo dnf install git"
                    ;;
            esac
        fi

        # Build list of missing items for prompt
        MISSING_ITEMS=""
        if ! $DOCKER_INSTALLED; then MISSING_ITEMS="${MISSING_ITEMS}Docker, "; fi
        if ! $VSCODE_INSTALLED; then MISSING_ITEMS="${MISSING_ITEMS}VS Code, "; fi
        if ! $GIT_INSTALLED; then MISSING_ITEMS="${MISSING_ITEMS}Git, "; fi
        MISSING_ITEMS="${MISSING_ITEMS%, }"  # Remove trailing comma

        if [[ -n "$MISSING_ITEMS" ]]; then
            echo ""
            echo -e "${CYAN}Would you like to install the missing components ($MISSING_ITEMS)?${NC}"
            read -p "Enter [Y]es to install, [N]o to skip, or [Q]uit (Y/N/Q): " response

            case "${response^^}" in
                Y|YES)
                    echo ""
                    install_missing_prerequisites
                    # Re-check and show updated status
                    check_all_prerequisites
                    show_prerequisite_status
                    ;;
                Q|QUIT)
                    echo "Exiting..."
                    exit 0
                    ;;
                *)
                    echo ""
                    print_info "You can install later with:"
                    print_cmd "./setup-devcontainer.sh --install"
                    ;;
            esac
        fi
    fi
}

install_missing_prerequisites() {
    print_title "Installing Missing Components"

    # Homebrew (macOS only)
    if $IS_MACOS && ! $HAS_HOMEBREW; then
        install_homebrew
        HAS_HOMEBREW=true
    fi

    # Git
    if ! $GIT_INSTALLED; then
        case $PLATFORM in
            macos) install_git_macos ;;
            linux|wsl) install_git_linux ;;
        esac
    fi

    # Docker
    if ! $SKIP_DOCKER && ! $DOCKER_INSTALLED; then
        case $PLATFORM in
            macos) install_docker_macos ;;
            linux) install_docker_linux ;;
            wsl) install_docker_wsl ;;
        esac
    fi

    # VS Code
    if ! $VSCODE_INSTALLED; then
        case $PLATFORM in
            macos) install_vscode_macos ;;
            linux) install_vscode_linux ;;
            wsl)
                print_info "For WSL, install VS Code on Windows and use 'code .' from WSL"
                ;;
        esac
    fi

    # VS Code Extensions
    if $VSCODE_INSTALLED || command -v code &> /dev/null; then
        install_vscode_extensions
    fi

    # Dev Containers CLI
    if ! $DEVCONTAINERS_CLI_INSTALLED && $NODE_INSTALLED; then
        install_devcontainers_cli
    fi

    # Docker Sandbox
    if $INSTALL_SANDBOX && ! $SBX_INSTALLED; then
        case $PLATFORM in
            macos) install_docker_sandbox_macos ;;
            linux) install_docker_sandbox_linux ;;
            wsl) print_info "Install Docker Sandbox on Windows: winget install Docker.sbx" ;;
        esac
    fi
}

show_help() {
    echo "TypeAgent DevContainer Setup Script"
    echo ""
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --install       Install missing prerequisites"
    echo "  --sandbox       Also install Docker Sandbox (sbx) for MicroVM isolation"
    echo "  --skip-docker   Skip Docker installation/check"
    echo "  --help          Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                      # Check prerequisites only"
    echo "  $0 --install            # Install missing prerequisites"
    echo "  $0 --install --sandbox  # Install with Docker Sandbox"
    echo ""
}

# ============================================================================
# Main Entry Point
# ============================================================================

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --install)
            INSTALL_MISSING=true
            shift
            ;;
        --sandbox)
            INSTALL_SANDBOX=true
            shift
            ;;
        --skip-docker)
            SKIP_DOCKER=true
            shift
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

show_banner

detect_environment
show_environment_info

check_all_prerequisites
show_prerequisite_status

if $INSTALL_MISSING; then
    install_missing_prerequisites
    # Re-check after installation
    check_all_prerequisites
fi

show_platform_recommendations
show_next_steps

echo ""
echo -e "${GRAY}For more information, see the DevContainer documentation:${NC}"
echo -e "${GRAY}  codeDocs/TypeAgent/forUser/2026-05-12_devcontainer-agent-sandboxing-proposal.md${NC}"
echo ""
