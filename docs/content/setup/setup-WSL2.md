---
layout: docs
title: WSL2 environment setup
---

This is a list of step-by-step instructions to set up a WSL2 environment from _scratch_ to build, run, and develop the TypeAgent repo, collated from various READMEs throughout the repo and external source. The instruction will install and setup the necessary tools and put the repo in `~/src/TypeAgent`. Links to the original instructions for each part are provided for reference, but mostly not required to visit if you just follow the instructions here. Skip or change the steps as necessary to suit your existing or desired environment.

## Build

- Initialize Ubuntu distro
  - Start Windows command prompt
  - `wsl --install Ubuntu`
  - Setup WSL Username/password
- Setup NodeJS using NVM ([Full Instructions](https://nodejs.org/en/download))
  - Setup [NVM](https://github.com/nvm-sh/nvm)
    - `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash`
    - `\. "$HOME/.nvm/nvm.sh"`
  - Install Node
    - `nvm install --lts`
- Clone and build:
  - `git clone https://github.com/microsoft/TypeAgent ~/src/TypeAgent` (Note: you can clone this to any location and does not have to be ~/src)
  - `cd ~/src/TypeAgent/ts`
  - `pnpm setup`
  - `pnpm i`
  - `pnpm run build`

## Configure Services

- Setup Service Keys (See instructions [here](../../../ts/README.md#service-keys))

## Run

- Setup for [electron](https://www.electronjs.org/docs/latest/development/build-instructions-linux)
  - `sudo apt update`
  - `sudo apt-get install -y build-essential clang libdbus-1-dev libgtk-3-dev libnotify-dev libasound2-dev libcap-dev libcups2-dev libxtst-dev libxss1 libnss3-dev gcc-multilib g++-multilib curl gperf bison python3-dbusmock openjdk-8-jre`
- Setup [WSL2 to use Windows font](https://x410.dev/cookbook/wsl/sharing-windows-fonts-with-wsl/)
  - `echo '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>/mnt/c/Windows/Fonts</dir></fontconfig>' > local.conf`
  - `sudo mv local.conf /etc/fonts`
- Add config to `.bashrc`
  - Ensure keyring UI display:
    - `echo 'dbus-update-activation-environment --all > /dev/null 2>&1' >> ~/.bashrc`
  - UI cursor size
    - `echo 'export XCURSOR_SIZE=16' >> ~/.bashrc`
  - Warning
    - `echo 'export GALLIUM_DRIVER=d3d12' >> ~/.bashrc`
- Setup [GNOME keyring](https://wiki.archlinux.org/title/GNOME/Keyring)
  - `sudo apt-get install -y gnome-keyring`
  - Restart WSL
    - `exit`
    - `wsl --shutdown`
    - `wsl -d Ubuntu`
    - `cd ~/src/TypeAgent/ts`
- Run the TypeAgent shell
  - `pnpm run shell`
  - Dialog will popup to setup up password for the keyring

## Development

- Install VSCode on Windows ([download](https://code.visualstudio.com/download))
- Install VSCode extension [Remote Development](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.vscode-remote-extensionpack)
- Start VSCode in WSL (_Continued from above command prompt in WSL_)
  - `code ~/src/TypeAgent/ts`
