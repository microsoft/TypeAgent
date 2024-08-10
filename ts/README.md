# TypeAgent Typescript Code

## Overview

**TypeAgent** is **sample code** that explores architectures for building _interactive agents_ with _natural language interfaces_ using [TypeChat](https://github.com/microsoft/typechat).

This directory contains Typescript implemented packages and main entry point for **TypeAgent**. For more details about the project, please review the TypeAgent [ReadMe](./../README.md).

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

If you want to use a local whisper service for voice input in the [TypeAgent Shell](./packages/shell), please follow instruction in the [README.md](../python/whisperService/README.md) in the python's [whisperService](../python/whisperService/) directory.

## Running Prerequisites

### Service Keys

Multiple services are required to run the scenarios. Put the necessary keys in the `.env` file at this directory (TypeAgent repo's `./ts` directory).
The follow set of functionality will need the services keys. Please read the links for details about the variables needed.

**Minimum requirements** to try out the experience with the [List](./packages/agents/list/README.md) TypeAgent:

| Requirements              | Functionality       | Variables                                                                     | Instructions                                                                                                                        |
| ------------------------- | ------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| LLM (GPT-4 or equivalent) | Request translation | AZURE_OPENAI_API_KEY<br>AZURE_OPENAI_ENDPOINT<br>AZURE_OPENAI_RESPONSE_FORMAT | [TypeChat instruction](https://github.com/microsoft/TypeChat/tree/main/typescript/examples#step-3-configure-environment-variables). |

**Optional requirements**

| Requirements                                                                                                      | Functionality            | Variables                                                  | Instructions                                                                                |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [Speech to Text service](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/index-speech-to-text) | Voice input (shell only) | SPEECH_SDK_ENDPOINT<br>SPEECH_SDK_KEY<br>SPEECH_SDK_REGION | [Shell setup instruction](./packages/shell/README.md#azure-speech-to-text-service-optional) |

**Additional keys required per TypeAgent** (Optional if not using these TypeAgent)

| Requirements                                                                                                                 | Functionality                                                               | Variables                                                                | Instructions                                                              |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Bing Search API                                                                                                              | Chat Lookup                                                                 | BING_API_KEY                                                             |                                                                           |
| GPT-3.5 Turbo                                                                                                                | Fast Chat Response<br>[Email](./packages/agents/email) content generation   | AZURE_OPENAI_API_KEY_GPT_35_TURBO<br>AZURE_OPENAI_ENDPOINT_GPT_35_TURBO  |
| [Spotify Web API](https://developer.spotify.com/documentation/web-api)                                                       | [Music player](./packages/agents/player/)                                   | SPOTIFY_APP_CLI<br>SPOTIFY_APP_CLISEC<br>SPOTIFY_APP_PORT                | [Music player setup](./packages/agents/player/README.md#application-keys) |
| [Graph Application](https://developer.microsoft.com/en-us/graph)                                                             | [Calendar](./packages/agents/calendar/)/[Email](./packages/agents/email)    | MSGRAPH_APP_CLIENTID<br>MSGRAPH_APP_CLIENTSECRET<br>MSGRAPH_APP_TENANTID |                                                                           |
| Embeddings                                                                                                                   | [Desktop](./packages/agents/desktop/) App name Fuzzy match                  | AZURE_OPENAI_API_KEY_EMBEDDING<br>AZURE_OPENAI_ENDPOINT_EMBEDDING        |                                                                           |
| GPT-4o                                                                                                                       | [Browser](./packages/agents/browser/) - Crossword Page                      | AZURE_OPENAI_API_KEY_GPT_4_O<br>AZURE_OPENAI_ENDPOINT_GPT_4_O            |                                                                           |
| [Bing Maps Location Rest API](https://learn.microsoft.com/en-us/bingmaps/rest-services/locations/find-a-location-by-address) | [Browser](./packages/agents/browser/) - PaleoBioDB set Lat/Longitude action | BING_MAPS_API_KEY                                                        |                                                                           |

Other examples in the [example directory](./examples/) may have additional service keys requirements. See the README in those examples for more detail.

Read the [Debugging](#debugging) section for additional service keys that can be used for debugging.

**Local Environment**:

You can use Azure Key Vault to store keys. To get the required config and keys saved to the `.env` file under the `ts` folder:

- Install [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli)
- Run `az login` to login using the CLI. Run `az account set --subscription <Subscription Id>` to set the subscription.
- Run `npm run getKeys` at the root to pull secret from our team key vault.

Note: Shared keys doesn't include Spotify integration, which can be created using the the [Spotify API keys instructions](./packages/agents/player/README.md)

To update keys on the key vault

- Add or change the values in the `.env` file
- Add new keys name in `tools/scripts/getKeys.config.json`
- Run `npm run getKeys -- push`
- Check in the changes to `tools/scripts/getKeys.config.json`

### WSL

For TypeAgents that operates on the Microsoft Graph (e.g. [Calendar](./packages/agents/calendar/) and [Email](./packages/agents/email/)), they leverage [@azure/identity](https://www.npmjs.com/package/@azure/identity) for authentication and use [@azure/identity-cache-persistence](https://www.npmjs.com/package/@azure/identity-cache-persistence) to cache on the local machine.

Install the following packages if you are on `WSL2` environment (please `restart` the shell after running the commands below):

```shell
  sudo apt-get update
  sudo apt install -y gnome-keyring
```

After the step above, you will need to enter a password to protect the secrets in the keyring. The popup normally appears when you restart the shell and run the code that needs to persists secrets in the keyring.

## Running

There are two main apps to start using the system: [TypeAgent Shell](#shell) or [TypeAgent CLI](#cli). Currently, we only support running builds from the repo (i.e. no published/installable builds). Both shared a common core package [dispatcher](./packages/dispatcher/)

### Shell

- Run `pnpm run shell`.

Also, you can go to the shell directory `./packages/shell` and start from there. Please see instruction in TypeAgent Shell's [README.md](./packages/shell/README.md).

### CLI

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

Test data are located in the [dispatcher](./packages/dispatcher)'s [test/data](./packages/dispatcher/test/data) directory. Each test data files are for specify translator and explainer.

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

### Alternate LLM

Other LLM can be substituted for GPT-4 as long as they are REST API compatible.
To use a local model the follow environment variable can be used:

```
OPENAI_API_KEY_LOCAL=None
OPENAI_ENDPOINT_LOCAL=
OPENAI_MODEL_LOCAL=
OPENAI_ORGANIZATION_LOCAL=
OPENAI_RESPONSE_FORMAT_LOCAL=
```

### User data location

To share user data with other developers for debugging, please look for the folder `.typeagent` under `%USERPROFILE%`on Windows and the home directory `~/` on WSL/Linux/MacOS.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
