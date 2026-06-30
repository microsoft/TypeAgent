# Set up on Linux

Step-by-step instructions to set up a **Linux** environment from scratch to
build, run, and develop the TypeAgent repo, with the repo in `~/src/TypeAgent`
(you can clone anywhere). Tested with Ubuntu 24.04.1 LTS and Debian 12.8.0.
Skip or change steps to suit your environment.

## Build

- Install git and curl:
  - `sudo apt update`
  - `sudo apt install git curl`
- Set up Node.js with [nvm](https://github.com/nvm-sh/nvm):
  - `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash`
  - `\. "$HOME/.nvm/nvm.sh"`
  - `nvm install --lts`
- Clone and build:
  - `git clone https://github.com/microsoft/TypeAgent ~/src/TypeAgent`
  - `cd ~/src/TypeAgent/ts`
  - `corepack enable`
  - `pnpm setup`
  - `pnpm i`
  - `pnpm run build`

## Configure services

- Set up your [service keys & configuration](./service-keys.md).

## Run

- Run the TypeAgent Shell:
  - Ubuntu 24.04: `pnpm run shell:nosandbox` (see [electron#18265](https://github.com/electron/electron/issues/18265))
  - Otherwise: `pnpm run shell`

## Development

- Install [VS Code](https://code.visualstudio.com/download).
- Start it on the workspace: `code ~/src/TypeAgent/ts`
