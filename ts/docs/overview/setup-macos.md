# Set up on macOS

Step-by-step instructions to set up a **macOS** environment from scratch to
build, run, and develop the TypeAgent repo, with the repo in `~/src/TypeAgent`
(you can clone anywhere). Skip or change steps to suit your environment.

## Build

- Install [Git](https://git-scm.com/downloads/mac).
- Set up Node.js with [nvm](https://github.com/nvm-sh/nvm):
  - `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash`
  - `\. "$HOME/.nvm/nvm.sh"`
  - `nvm install --lts`
- Enable corepack: `corepack enable`
- Clone and build:
  - `git clone https://github.com/microsoft/TypeAgent ~/src/TypeAgent`
  - `cd ~/src/TypeAgent/ts`
  - `pnpm setup`
  - `pnpm i`
  - `pnpm run build`

## Configure services

- Set up your [service keys & configuration](./service-keys.md).

## Run

- Run the TypeAgent Shell: `pnpm run shell`

## Development

- Install [VS Code](https://code.visualstudio.com/download).
- Start it on the workspace: `code ~/src/TypeAgent/ts`
