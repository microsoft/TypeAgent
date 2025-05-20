# Linux environment setup

This is a list of step-by-step instructions to set up a Linux environment from _scratch_ to build, run, and develop the TypeAgent repo, collated from various READMEs throughout the repo and external source. The instruction will install and setup the necessary tools and put the repo in `~/src/TypeAgent`. Links to the original instructions for each part are provided for reference, but mostly not required to visit if you just follow the instructions here. Skip or change the steps as necessary to suit your existing or desired environment.

Instructions tested with Ubuntu 24.04.1 LTS and Debian 12.8.0

## Build

- Install git and curl
  - `sudo apt update`
  - `sudo apt install git curl`
- Setup NodeJS using nvm ([Full Instructions](https://nodejs.org/en/download))
  - Setup [NVM](https://github.com/nvm-sh/nvm)
    - `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash`
    - `\. "$HOME/.nvm/nvm.sh"`
  - Install Node
    - `nvm install --lts`
- Clone and build:
  - `git clone https://github.com/microsoft/TypeAgent ~/src/TypeAgent` (Note: you can clone this to any location and does not have to be ~/src)
  - `cd ~/src/TypeAgent/ts`
  - `corepack enable`
  - `pnpm setup`
  - `pnpm i`
  - `pnpm run build`

## Configure Services

- Setup Service Keys (See instructions [here](./../../ts/README.md#service-keys))

## Run

- Run the TypeAgent shell:
  - (Ubuntu 24.04) `pnpm run shell --noSandbox` (see [issue](https://github.com/electron/electron/issues/18265))
  - Other: `pnpm run shell`

## Development

- Install VSCode ([download](https://code.visualstudio.com/download))
- Start VSCode
  - `code ~/src/TypeAgent/ts`
