# Set up on Windows

Step-by-step instructions to set up a Windows environment **from scratch** to
build, run, and develop the TypeAgent repo. These install the necessary tools
and put the repo in `C:\src\TypeAgent` (you can clone anywhere). Skip or change
steps to suit your existing environment.

## Build

- Install [Git](https://git-scm.com/downloads/win).
- Install [Node.js](https://nodejs.org/en/download).
- Enable corepack:
  - Open Command Prompt **as Administrator**.
  - `corepack enable`
- Clone and build:
  - `git clone https://github.com/microsoft/TypeAgent C:\src\TypeAgent`
  - `cd /d C:\src\TypeAgent\ts`
  - `pnpm setup`
  - `pnpm i`
  - `pnpm run build`

## Configure services

- Set up your [service keys & configuration](./service-keys.md).

## Run

- Run the TypeAgent Shell: `pnpm run shell`

## Development

- Install [VS Code](https://code.visualstudio.com/download).
- Start it on the workspace: `code C:\src\TypeAgent\ts`
