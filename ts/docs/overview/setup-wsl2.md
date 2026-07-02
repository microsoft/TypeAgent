# Set up on WSL2

Step-by-step instructions to set up a **WSL2** environment from scratch to
build, run, and develop the TypeAgent repo, with the repo in `~/src/TypeAgent`
(you can clone anywhere). Skip or change steps to suit your environment.

## Build

- Initialize an Ubuntu distro (from a Windows command prompt):
  - `wsl --install Ubuntu`, then set up your WSL username/password.
- Set up Node.js with [nvm](https://github.com/nvm-sh/nvm):
  - `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash`
  - `\. "$HOME/.nvm/nvm.sh"`
  - `nvm install --lts`
- Install Node native module build tools:
  - `sudo apt install -y make build-essential`
- Clone and build:
  - `git clone https://github.com/microsoft/TypeAgent ~/src/TypeAgent`
  - `cd ~/src/TypeAgent/ts`
  - `pnpm setup`
  - `pnpm i`
  - `pnpm run build`

## Configure services

- Set up your [service keys & configuration](./service-keys.md).

## Run

The Shell is an Electron app, so WSL2 needs a few extra packages and tweaks:

- Electron build dependencies:
  - `sudo apt update`
  - `sudo apt-get install -y build-essential clang libdbus-1-dev libgtk-3-dev libnotify-dev libasound2-dev libcap-dev libcups2-dev libxtst-dev libxss1 libnss3-dev gcc-multilib g++-multilib curl gperf bison python3-dbusmock openjdk-8-jre`
- [Share Windows fonts with WSL](https://x410.dev/cookbook/wsl/sharing-windows-fonts-with-wsl/):
  - `echo '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>/mnt/c/Windows/Fonts</dir></fontconfig>' > local.conf`
  - `sudo mv local.conf /etc/fonts`
- Add to `.bashrc`:
  - `echo 'dbus-update-activation-environment --all > /dev/null 2>&1' >> ~/.bashrc`
  - `echo 'export XCURSOR_SIZE=16' >> ~/.bashrc`
  - `echo 'export GALLIUM_DRIVER=d3d12' >> ~/.bashrc`
- Set up the [GNOME keyring](https://wiki.archlinux.org/title/GNOME/Keyring):
  - `sudo apt-get install -y gnome-keyring`
  - Restart WSL: `exit`, then `wsl --shutdown`, then `wsl -d Ubuntu`, then `cd ~/src/TypeAgent/ts`
- Run the Shell: `pnpm run shell` (a dialog will prompt you to set a keyring password).

## Development

- Install [VS Code](https://code.visualstudio.com/download) on Windows.
- Install the [Remote Development](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.vscode-remote-extensionpack) extension.
- Start VS Code in WSL: `code ~/src/TypeAgent/ts`
