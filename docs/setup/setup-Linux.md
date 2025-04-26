# Linux environment setup

This is a list of step-by-step instructions to set up a Linux environment from _scratch_ to build, run, and develop the TypeAgent repo, collated from various READMEs throughout the repo and external source. The instruction will install and setup the necessary tools and put the repo in `~/src/TypeAgent`. Links to the original instructions for each part are provided for reference, but mostly not required to visit if you just follow the instructions here. Skip or change the steps as necessary to suit your needs.

Instructions tested with Ubuntu 24.04.1 LTS and Debian 12.8.0

## Build

- Install git and curl
  - `sudo apt update`
  - `sudo apt install git curl`
- Setup node
  - Setup [NVM](https://github.com/nvm-sh/nvm){:target="_blank"}
    - `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash`
    - `source ~/.bashrc`
  - Install Node
    - `nvm install --lts`
- Clone and build:
  - `git clone https://github.com/microsoft/TypeAgent ~/src/TypeAgent`
  - `cd ~/src/TypeAgent/ts`
  - `corepack enable`
  - `pnpm setup`
  - `pnpm i`
  - `pnpm run build`

## Configure Services

- Setup Service Keys (See instructions [here](./../../ts/README.md#service-keys){:target="_blank"})

## Run

- Run the TypeAgent shell:
  - (Ubuntu 24.04) `pnpm run shell --noSandbox` (see [issue](https://github.com/electron/electron/issues/18265){:target="_blank"})
  - Other: `pnpm run shell`

## Development

- Install VSCode ([download](https://code.visualstudio.com/download){:target="_blank"})
- Start VSCode
  - `code ~/src/TypeAgent/ts`
