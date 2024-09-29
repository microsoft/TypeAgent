# Knowledge Visualizer

## Overview

TypeAgent Shell is an UI entry point to **TypeAgent sample code** that explores architectures for building _interactive agents_ with _natural language interfaces_ using [TypeChat](https://github.com/microsoft/typechat).

TypeAgent Shell is a **single personal assistant** that takes user request and use an extensible set of agents to perform actions, answer questions, and carry a conversation. [TypeAgent CLI](../cli/)'s interactive mode is a command line version of the app, and both shared the core [Dispatcher](../dispatcher/) component. Please read Dispatcher's [README.md](../dispatcher/README.md) on example requests and usage.

## Prerequisites

### Build Prerequisites

The knowledge visualizer tool is built using [Electron](https://www.electronjs.org). Install libraries needed to build in Linux/WSL following the [instruction](https://www.electronjs.org/docs/latest/development/build-instructions-linux)

## Running the KV tool

```kv
pnpm run kv
```

On Windows, if you notice a lag when starting up the tool, you can add the source code folder to the exclusions list for Windows Defender scans following the [instruction](https://support.microsoft.com/en-us/windows/add-an-exclusion-to-windows-security-811816c0-4dfd-af4a-47e4-c301afe13b26).

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
