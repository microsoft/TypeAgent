---
layout: docs
title: Windows environment setup
---


This is a list of step-by-step instructions to set up a Windows environment from _scratch_ to build, run, and develop the TypeAgent repo, collated from various READMEs throughout the repo and external source. The instruction will install and setup the necessary tools and put the repo in `C:\src\TypeAgent`. Links to the original instructions for each part are provided for reference, but mostly not required to visit if you just follow the instructions here. Skip or change the steps as necessary to suit your existing or desired environment.

## Build

- Install Git ([instructions](https://git-scm.com/downloads/win))
- Install NodeJS ([instructions](https://nodejs.org/en/download))
- Enable corepack
  - Open Command Prompt as Administrator
  - `corepack enable`
- Clone and build:
  - Open command prompt
  - `git clone https://github.com/microsoft/TypeAgent C:\src\TypeAgent` (Note: you can clone this to any location and does not have to be C:\src)
  - `cd /d C:\src\TypeAgent\ts`
  - `pnpm setup`
  - `pnpm i`
  - `pnpm run build`

## Configure Services

- Setup Service Keys (See instructions [here](../../../ts/README.md#service-keys))

## Run

- Run the TypeAgent shell
  - `pnpm run shell`

## Development

- Install VSCode ([download](https://code.visualstudio.com/download))
- Start VSCode
  - Open command prompt
  - `code C:\src\TypeAgent\ts`
