# Windows environment setup

This is a list of step-by-step instructions to set up a Windows environment from _scratch_ to build, run, and develop the TypeAgent repo, collated from various READMEs throughout the repo and external source. The instruction will install and setup the necessary tools and put the repo in `C:\src\TypeAgent`. Links to the original instructions for each part are provided for reference, but mostly not required to visit if you just follow the instructions here. Skip or change the steps as necessary to suit your needs.

## Build

- Install Git ([download](https://git-scm.com/downloads/win))
- Install Node ([download](https://nodejs.org/en/download))
- Enable corepack
  - Open Command Prompt as Administrator
  - `corepack enable`
- Clone and build:
  - Open command prompt
  - `git clone https://github.com/microsoft/TypeAgent C:\src\TypeAgent`
  - `cd /d C:\src\TypeAgent\ts`
  - `pnpm setup`
  - `pnpm i`
  - `pnpm run build`

## Run

- Setup Service Keys (See instructions [here](./../../ts/README.md#service-keys))
- Run the TypeAgent shell
  - `pnpm run shell`

## Development

- Install VSCode ([download](https://code.visualstudio.com/download))
- Start VSCode
  - Open command prompt
  - `code C:\src\TypeAgent\ts`
