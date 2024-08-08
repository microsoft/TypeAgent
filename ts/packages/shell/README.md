# TypeAgent Shell

## Overview

TypeAgent Shell is an UI entry point to **TypeAgent sample code** that explores architectures for building _interactive agents_ with _natural language interfaces_ using [TypeChat](https://github.com/microsoft/typechat).

TypeAgent Shell is a **single personal assistant** that takes user request and use an extensible set of agents to perform actions, answer questions, and carry a conversation. [TypeAgent CLI](../cli/)'s interactive mode is a command line version of the app, and both shared the core [Dispatcher](../dispatcher/) component. Please read Dispatcher's [README.md](../dispatcher/README.md) on example requests and usage.

## Prerequisites

### Linux/WSL Build Prerequisites

TypeAgent shell is built using [Electron](https://www.electronjs.org). Install libraries needed to build in Linux/WSL following the [instruction](https://www.electronjs.org/docs/latest/development/build-instructions-linux)

### Azure Speech to Text service (Optional)

Currently, TypeAgent Shell optionally supports voice input via Azure Speech Services or [Local Whisper Service](../../../python/whisperService/) beside keyboard input.

To set up Azure [Speech to Text service](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/index-speech-to-text), the following variables in the `.env` are needed.

| Variable              | Value                                  |
| --------------------- | -------------------------------------- |
| `SPEECH_SDK_ENDPOINT` | Service URL                            |
| `SPEECH_SDK_KEY`      | API key                                |
| `SPEECH_SDK_REGION`   | Region of the service (e.g. `westus2`) |

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
