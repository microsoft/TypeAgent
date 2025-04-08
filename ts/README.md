# TypeAgent Typescript Code

## Overview

**TypeAgent** is **sample code** that explores an architecture for building a _personal agent_ with a _natural language interfaces_ using [TypeChat](https://github.com/microsoft/typechat). The personal agent can work with _application agents_.

This directory contains Typescript implemented packages and main entry point for **TypeAgent**. For more details about the project, please review the TypeAgent [ReadMe](./../README.md).

The main entry point to explore TypeAgent is the [TypeAgent Shell](./packages/shell) example. Currently, we only support running from the repo (i.e. no published/installable builds). Follow the instruction below to [build](#build) and [run](#running) the [TypeAgent Shell](./packages/shell) example.

## Build

### Setup

To build:

- Install [Node 18+](https://nodejs.org/en/download)
  - NOTE: HPC Tools conflict with node so be sure that the node.exe you are running is the correct one!
- Install pnpm (`npm i -g pnpm && pnpm setup`)
- **(Linux/WSL Only)** Read TypeAgent Shell's [README.md](./packages/shell/README.md) for additional requirements

### Steps

In this directory:

- Run `pnpm i`
- Run `pnpm run build`

### Agent Specific Steps (Optional)

#### VSCode Agent

If you want to `deploy` the **VS Code** extension `CODA` locally please run:

- From the root, `cd ./ts/packages/coda`
- `pnpm run deploy:local`

You should now be able to access the extension from VS Code.

#### Desktop Agent (Windows only)

To use the [Desktop Agent](./packages/agents/desktop/] for windows, follow the instruction in [README.md](./packages/agents/desktop/README.md) to build the [AutoShell](../dotnet/autoShell/) C# code necessary to interact with the OS.

### Local Whisper Service (Optional)

If you want to use a local whisper service for voice input in the [TypeAgent Shell](./packages/shell), please follow instruction in the [README.md](../python/stt/whisperService/README.md) in the python's [whisperService](../python/stt/whisperService/) directory.

## Running Prerequisites

### Service Keys

Multiple services are required to run the scenarios. Put the necessary keys in the `.env` file at this directory (TypeAgent repo's `./ts` directory). For more information standing up your own Azure OpenAI service endpoint, [continue here](https://azure.microsoft.com/en-us/products/ai-services/openai-service?msockid=03598722967c6ae20c3f93af97c66bd7).

Here is an example of the minimal `.env` file targeting Azure:

```
AZURE_OPENAI_API_KEY=<service key>
AZURE_OPENAI_ENDPOINT=<endpoint URL for LLM model, e.g. GPT-4o>
AZURE_OPENAI_RESPONSE_FORMAT=1

AZURE_OPENAI_API_KEY_EMBEDDING=<service key>
AZURE_OPENAI_ENDPOINT_EMBEDDING=<endpoint URL for text-embedding-ada-002 or equivalent
```

Here is an example of the minimal `.env` file targeting OpenAI:

```
OPENAI_ORGANIZATION=<organization id>
OPENAI_API_KEY=<service key>
OPENAI_ENDPOINT=https://api.openai.com/v1/chat/completions
OPENAI_MODEL=gpt-4o
OPENAI_RESPONSE_FORMAT=1

OPENAI_ENDPOINT_EMBEDDING=https://api.openai.com/v1/embeddings
OPENAI_MODEL_EMBEDDING=text-embedding-ada-002
```

The follow set of functionality will need the services keys. Please read the links for details about the variables needed. It is possible to use "keyless" configuration for some APIs. See [Keyless API Access](#keyless-api-access) below.

**Minimum requirements** to try out the experience with the [List](./packages/agents/list/README.md) TypeAgent:

| Requirements              | Functionality                                                                         | Variables                                                                                                                                                                                               | Instructions                                                                                                                        | Keyless Access Supported |
| ------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| LLM (GPT-4 or equivalent) | Request translation                                                                   | AZURE_OPENAI_API_KEY<br>AZURE_OPENAI_ENDPOINT<br>AZURE_OPENAI_RESPONSE_FORMAT<br>or<br>OPENAI_API_KEY<br>OPENAI_ORGANIZATION<br>OPENAI_ENDPOINT<br>OPENAI_MODEL<br>OPENAI_RESPONSE_FORMAT               | [TypeChat instruction](https://github.com/microsoft/TypeChat/tree/main/typescript/examples#step-3-configure-environment-variables). | Yes                      |
| Embeddings                | Conversation Memory<br><br>[Desktop](./packages/agents/desktop/) App name Fuzzy match | AZURE_OPENAI_API_KEY_EMBEDDING<br>AZURE_OPENAI_ENDPOINT_EMBEDDING<br>or<br> OPENAI_ENDPOINT_EMBEDDING<br>OPENAI_MODEL_EMBEDDING<br>OPENAI_API_KEY_EMBEDDING (optional if different from OPENAI_API_KEY) |                                                                                                                                     | Yes                      |

**Optional requirements**

| Requirements                                                                                                      | Functionality            | Variables                                                  | Instructions                                                                                | Keyless Access Supported |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------ |
| [Speech to Text service](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/index-speech-to-text) | Voice input (shell only) | SPEECH_SDK_ENDPOINT<br>SPEECH_SDK_KEY<br>SPEECH_SDK_REGION | [Shell setup instruction](./packages/shell/README.md#azure-speech-to-text-service-optional) | Yes                      |

**Additional keys required for individual AppAgents** (Optional if not using these AppAgents)

| Requirements                                                           | Functionality                                                             | Variables                                                                | Instructions                                                              | Keyless Access Supported |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------ |
| Bing Search API                                                        | Chat Lookup                                                               | BING_API_KEY                                                             |                                                                           | No                       |
| GPT-3.5 Turbo                                                          | Fast Chat Response<br>[Email](./packages/agents/email) content generation | AZURE_OPENAI_API_KEY_GPT_35_TURBO<br>AZURE_OPENAI_ENDPOINT_GPT_35_TURBO  |                                                                           | Yes                      |
| [Spotify Web API](https://developer.spotify.com/documentation/web-api) | [Music player](./packages/agents/player/)                                 | SPOTIFY_APP_CLI<br>SPOTIFY_APP_CLISEC<br>SPOTIFY_APP_PORT                | [Music player setup](./packages/agents/player/README.md#application-keys) | No                       |
| [Graph Application](https://developer.microsoft.com/en-us/graph)       | [Calendar](./packages/agents/calendar/)/[Email](./packages/agents/email)  | MSGRAPH_APP_CLIENTID<br>MSGRAPH_APP_CLIENTSECRET<br>MSGRAPH_APP_TENANTID |                                                                           | No                       |
| GPT-4o                                                                 | [Browser](./packages/agents/browser/) - Crossword Page                    | AZURE_OPENAI_API_KEY_GPT_4_O<br>AZURE_OPENAI_ENDPOINT_GPT_4_O            |                                                                           | Yes                      |

Other examples in the [example directory](./examples/) may have additional service keys requirements. See the README in those examples for more detail.

Read the [Debugging](#debugging) section for additional service keys that can be used for debugging.

#### Using Azure Key Vault to manage keys

The [getKey](./tools/scripts/getKeys.mjs) script is created for developer convenience to manage service secret using Azure Key Vault and set up the local development environments.

To setup:

- Install the latest [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli)
- Run `az login` to login using the CLI.
- Run `az account set --subscription <Subscription Id>` to set the subscription.
- [Create a Azure Key Vault](https://learn.microsoft.com/en-us/azure/key-vault/general/quick-create-cli) with name `<name>`.

To update keys on the key vault:

- Add or change the values in the `.env` file
- Add new keys name in `tools/scripts/getKeys.config.json`
- Run `npm run getKeys -- push [--vault <name>]`. (If the `--vault` option is omitted, the default from vault name in `tools/scripts/getKeys.config.json` is used.)
- Check in the changes to `tools/scripts/getKeys.config.json`

To get the required config and keys saved to the `.env` file under the `ts` folder:

- Run `npm run getKeys [--vault <name>]` at the root to pull secret from the key vault with `<name>`. (If the `--vault` option is omitted, the default from vault name in `tools/scripts/getKeys.config.json` is used.)

Note: Shared keys doesn't include Spotify integration, which can be created using the the [Spotify API keys instructions](./packages/agents/player/README.md)

### Keyless API Access

For additional security, it is possible to run a subset of the TypeAgent endpoints in a keyless environment. Instead of using keys the examples provided can use Azure Entra user identities to authenticate against endpoints. To use this approach, modify the .env file and specify `identity` as the key value.
You must also configure your services to use [RBAC](https://learn.microsoft.com/en-us/azure/role-based-access-control/overview) and assign users access to the correct roles for each endpoint. Please see the tables above to determine keyless endpoint support.

### Just-in-time Access

TypeAgent also supports least privileged security approach using [Azure Entra Prividged Identity Management](https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-configure). [Elevate.js](./tools/scripts/elevate.js) is a script used to automate elevation. Default configuration
options for elevation (duration, justification message, etc.) are stored in `tools/scripts/elevate.config.json`. A typical developer workflow is to run `npm run elevate` once at the beginning of each workday.

To learn more about JIT access: [start here](https://techcommunity.microsoft.com/t5/microsoft-entra-blog/just-in-time-access-to-groups-and-conditional-access-integration/ba-p/2466926).

### Linux/WSL

For TypeAgents that operates on the Microsoft Graph (e.g. [Calendar](./packages/agents/calendar/) and [Email](./packages/agents/email/)), they leverage [@azure/identity](https://www.npmjs.com/package/@azure/identity) for authentication and use [@azure/identity-cache-persistence](https://www.npmjs.com/package/@azure/identity-cache-persistence) to cache on the local machine.

Install the following packages if you are on Linux or WSL2 environment (please `restart` the shell after running the commands below):

```shell
  sudo apt-get update
  sudo apt install -y gnome-keyring
```

After the step above, you will need to enter a password to protect the secrets in the keyring. The popup normally appears when you restart the shell and run the code that needs to persists secrets in the keyring.

## Running

There are two main apps to start exploring TypeAgent: [TypeAgent Shell](#shell) and [TypeAgent CLI](#cli). Both provides _interactive agents_ with _natural language interfaces_ experience via a shared package [dispatcher](./packages/dispatcher/) that implemented core TypeAgent functionalities. Currently, we only support running from the repo (i.e. no published/installable builds).

### Shell

[TypeAgent Shell](./packages/shell) provides a light weight GUI _interactive agents_ with _natural language interfaces_ experience

- Run `pnpm run shell`.

Also, you can go to the shell directory `./packages/shell` and start from there. Please see instruction in TypeAgent Shell's [README.md](./packages/shell/README.md).

### CLI

[TypeAgent CLI](./packages/cli) provides a console based _interactive agents_ with _natural language interfaces_ experience. Additional console command is available to explore different part of TypeAgent functionalities.

- Run `pnpm run cli` to get the available command
- Run `pnpm run cli -- interactive` will start the interactive prompt

Also, you can go to the CLI directory `./packages/cli` and start from there. Please see instruction in TypeAgent CLI's [README.md](./packages/cli/README.md) for more options and detail.

## Development

### Main packages and directory structure

Apps:

- [agent-cli](./packages/cli): TypeAgent dispatcher CLI and interactive prompt
- [agent-shell](./packages/shell): TypeAgent shell UI

Libraries:

- [agent-dispatcher](./packages/dispatcher): TypeAgent dispatcher used by both the CLI and shell
- [agent-cache](./packages/cache): Construction explanation and cache

[Agents with natural language interfaces](./packages/agents):

- [Music Player](./packages/agents/player/): Spotify music player TypeAgent plugin
- [Chat](./packages/agents/chat/)
- [Browser](./packages/agents/browser/)
- [VS Code](./packages/agents/code/)
- [List Management](./packages/agents/list/)
- [Calendar](./packages/agents/calendar/)
- [Email](./packages/agents/email/)
- [Desktop](./packages/agents/desktop/)

Other directories:

- [examples](./examples/): various additional standalone explorations.
- [tools](./tools/): tools for CI/CD and internal development environments.

### Testing

Run `npm run test` at the root.

#### Schema Changes

If new translator or explainer, or any of the translator schema or explanation schema changes, the built-in construction cache and the test data needs to be regenerated and be evaluated for correctness.

Test data are located in the [defaultAgentProvider](./packages/defaultAgentProvider)'s [test/data](./packages/defaultAgentProvider/test/data) directory. Each test data files are for specify translator and explainer.

Use the `agent-cli data add` command to add new test cases.

To regenerated you can run the following at the root or in the [cli](./packages/cli) directory:

- `npm run regen:builtin` - Regenerate builtin construction store.
- `npm run regen` - Regenerate test data

To evaluate correctness for the test data:

- `agent-cli data diff <file>` can be used to open test data file diff in the vscode.
- Look at the translation to check if its correct. (can be skipped if translator schema didn't change).
- Run `npm run test` to make sure the generated test data can be round tripped (Run in the CI as well).
- Check the stats in the regen before and after:
  - `npm run regen -- -- --none` at the root will print out per file stats and total stats.
  - Make sure that the number explanation failure per file and total stay roughly same (or improved).
  - Make sure that the attempts (corrections) ratios stay roughly the same (or improve).
  - Examine if the failures are because of LLM instability:
    - Borderline failure: was there a lot of correction before and failed now.
    - Run the explanation before and after `agent-cli explain --repeat 5 <RequestAction>` to repeat it 5 times and compare the stats.

### Linting

The repo is set up with prettier to help with consistent code style. Run `npm run lint` to check and `npm run lint:fix` to fix any issues.

### Debugging

#### Starting Development version of TypeAgent CLI

Go to `./packages/cli`, you don't have to build and just run `./bin/dev.js`. It will use `ts-node` and build the typescript as it goes.

#### Launching from VSCode

If you open this directory as a workspace in VSCode, multiple launch task is defined to quickly start debug.

Common Debug Launch Task:

- CLI interactive - `./package/cli/bin/run.js interactive`
- CLI (dev) interactive - `./package/cli/bin/dev.js interactive` with a new command prompt
- CLI (dev) interactive [Integrated Terminal] - `./bin/dev.js interactive` using VSCode terminal (needed for WSL)

#### Attaching to running sessions

To attaching to an existing session with TypeAgent CLI's interactive mode or TypeAgent Shell, you can start inspector by issuing the command `@debug` and use the VSCode `Attach` debugger launch task to attach.

#### TypeAgent Shell Browser Process

With the TypeAgent Shell, press F12 will bring up the devtool to debug the browser process.

### Tracing

The project uses [debug](https://www.npmjs.com/package/debug) package to enable tracing. There are two options to enable these traces:

**Option 1**: Set the namespace pattern in the environment variable `DEBUG=typeagent:prompt` before starting the program.

For example (in Linux), to trace the GPT prompt that get sent when running the interactive CLI.

```bash
DEBUG=typeagent:prompt packages/cli/bin/run.js interactive
```

**Option 2**: In the shell or CLI's interactive mode, you can issue the command `@trace <pattern>` to add to the list of namespace. Use "-" or "-\*" to disable all the trace.

For example inside the CLI's interactive mode, enter

```txt
@trace *:prompt:*
```

Search the code base with '"typeagent:' will give all the traces available.

### Logging

TypeAgent does not collect telemetry by default. Developer can enable logging to a mongodb for internal debugging purpose by providing a mongodb connection string with the `MONGODB_CONNECTION_STRING` variable in the `.env` file.

### Experiement with Local LLM via Ollama

**NOTE**: TypeAgent is current only tuned to run on GPT4 and similar model. Reliablity and quality may vary using other smaller LLM models.

TypeAgent's shell and CLI will detect if Ollama is running locally via default port (11434) and expose those model to be used.
To use ollama, install ollama and pull some model locally. TypeAgent will automatically detect them.

In the interactive mode (cli or shell), you can also change the translation (and explainer) model using the commands

- `@config translation model <name>`
- `@config explainer model <name>`

They are also offered in CLI's --model option for the follow commands:

- `agent-cli interactive`
- `agent-cli run request`
- `agent-cli run translate`
- `agent-cli prompt`
- `agent-cli data add`
- `agent-cli data regen`

The model name to specify are prefix with `ollama:` for example `ollama:phi3` or `ollama:llama3.2` or specifically tagged ones: e.g. `ollama:llama3.2:3b-instruct-q5_0`

If ollama is running on a different URL, `OLLAMA_ENDPOINT` environment variable can be use to specify the URL and port for the Ollama endpoints.

### User data location

To share user data with other developers for debugging, please look for the folder `.typeagent` under `%USERPROFILE%`on Windows and the home directory `~/` on WSL/Linux/MacOS.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
