# TypeAgent Shell

## Overview

TypeAgent Shell is an UI entry point to **TypeAgent sample code** that explores architectures for building _interactive agents_ with _natural language interfaces_ using [TypeChat](https://github.com/microsoft/typechat).

TypeAgent Shell is a **single personal assistant** that takes user request and use an extensible set of agents to perform actions, answer questions, and carry a conversation. [TypeAgent CLI](../cli/)'s interactive mode is a command line version of the app, and both shared the core [Dispatcher](../dispatcher/) component. Please read Dispatcher's [README.md](../dispatcher/README.md) on example requests and usage.

## Prerequisites

### Linux/WSL Build Prerequisites

TypeAgent shell is built using [Electron](https://www.electronjs.org). Install libraries needed to build in Linux/WSL following the [instructions here](https://www.electronjs.org/docs/latest/development/build-instructions-linux).

## Running the agent shell

```shell
pnpm run shell
```

On Windows, if you notice a lag when starting up the shell, you can add the source code folder to the exclusions list for Windows Defender by following [these instructions](https://support.microsoft.com/en-us/windows/add-an-exclusion-to-windows-security-811816c0-4dfd-af4a-47e4-c301afe13b26).

Additionally, if you are running MS Graph based sample agents like Calendar and Email, there is an auth token persisted in the identity cache that can occasionally get corrupted. This could also slow down the start up time of the shell, you can delete that by running:

```console
del %LOCALAPPDATA%\.IdentityService\typeagent-tokencache
```

### Azure Speech to Text service (Optional)

Currently, TypeAgent Shell optionally supports voice input via Azure Speech Services or [Local Whisper Service](../../../python/stt/whisperService/) in addition to keyboard input.

To set up Azure [Speech to Text service](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/index-speech-to-text), the following variables in the `.env` are needed:

| Variable              | Value                                                                            |
| --------------------- | -------------------------------------------------------------------------------- |
| `SPEECH_SDK_ENDPOINT` | Service URL (or speech API resource ID when using Identity based authentication) |
| `SPEECH_SDK_KEY`      | API key                                                                          |
| `SPEECH_SDK_REGION`   | Region of the service (e.g. `westus2`)                                           |

## Keyless API Access

If you would like to enable keyless Speech API access you must have performed the following steps: 

1. Specify `identity` as the `SPEECH_SDK_KEY` in the `.env` file. 
2. Replace the `SPEECH_SDK_ENDPOINT` value with the azure resource id of your cognitive service instance (i.e. `/subscriptions/<your subscription guid>/resourceGroups/myResourceGroup/providers/Microsoft.CognitiveServices/accounts/speechapi`). 
3. Configure your speech API to support Azure Entra RBAC and add the necessary users/groups with the necessary permissions
(typically `Cognitive Services Speech User` or `Cognitive Services Speech Contributor`). More information on congitive services roles [here](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/role-based-access-control). 
4. If you are using JIT access elevate prior to calling the speech API. Please refer to the [elevate.js](../../tools/scripts/elevate.js) script for doing this efficiently.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
