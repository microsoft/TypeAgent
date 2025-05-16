# TypeAgent

**TypeAgent** is **sample code** that explores an architecture for building a _personal agent_ with a _natural language interfaces_.

**TypeAgent** uses [TypeChat](https://github.com/microsoft/typechat) to build a set of application agents that **take actions**. Agents define actions using [TypeChat](https://github.com/microsoft/typechat) schemas.

This repo contains the personal agent and example application agents, along with internal packages used to build them.

## Getting Started

TypeAgent is written in TypeScript and relies on [TypeChat](https://github.com/microsoft/typechat). To understand how TypeAgent examples work, we recommend getting comfortable with [TypeChat](https://github.com/microsoft/typechat) and [TypeChat examples](https://github.com/microsoft/TypeChat/tree/main/typescript/examples) first.

### Quick start - Agent Shell Example

The main entry point to explore TypeAgent is the [Agent Shell](./ts/packages/shell) example.

Follow these step-by-step instructions to quickly setup tools and environments from scratch to build, run, explore, and develop.

- [Windows](./docs/setup/setup-Windows.md)
- [WSL2](./docs/setup/setup-WSL2.md)
- [Linux (Ubuntu/Debian)](./docs/setup/setup-Linux.md)
- MacOS (coming soon)

For more detailed setup instructions, see the [README.md](./ts/README.md) in the TypeScript code [directory](./ts)

## Examples

### Apps

- [TypeAgent Shell](./ts/packages/shell/)

  An Electron application for interacting with multiple registered agents using a single unified user interface. Agent Shell includes:

  - Integrated chat experience with voice support
  - Dispatcher that translate and dispatch actions to registered agents
  - Structured memory
  - Structured RAG

### Agents

- Application agents with natural language interfaces integrated with [TypeAgent Shell](./ts/packages/shell/) and [TypeAgent CLI](./ts/packages/cli/)

  - [Music Player](./ts/packages/agents/player/)
  - [Chat](./ts/packages/agents/chat/)
  - [Browser](./ts/packages/agents/browser/)
  - [VS Code](./ts/packages/agents/code/)
  - [List Management](./ts/packages/agents/list/)
  - [Calendar](./ts/packages/agents/calendar/)
  - [Email](./ts/packages/agents/email/)
  - [Desktop](./ts/packages/agents/desktop/)
  - [Image](./ts/packages/agents/image/)
  - [Markdown](./ts/packages/agents/markdown/)
  - [Montage](./ts/packages/agents/montage/)
  - [Spelunker](./ts/packages/agents/spelunker/)
  - [Turtle](./ts/packages/agents/turtle/)
  - [Phone](.ts/packages/agents/phone/)
  - [Photo](.ts/packages/agents/photo/)
  - [androidMobile](.ts/packages/agents/androidMobile/)

### Components

- [Agent Dispatcher](./ts/packages/dispatcher/)

  Explores applying [TypeChat](https://github.com/microsoft/typechat) to route user requests to agents whose typed contract best matches user intent. Main component of the personal agent.

- [Knowledge Processor](./ts/packages/knowPro)

- [Agent Cache](./ts/packages/cache/)

  Explores how [TypeChat](https://github.com/microsoft/typechat) translations from user intent to actions can be cached, minimizing the need to go the LLM.

## State Management

Storage, registration, chat, memory and other state maintained by examples is **_typically_** stored **_locally_** in **your user folder** on your development machine. State is typically saved as ordinary text or JSON files in sub-folders below your user folder.

Example agents that use the Microsoft Graph or similar external services may store state in those services.

Code in this repo doesn't not collect telemetry by default.

## Intended Uses

- TypeAgent is sample code shared to encourage the exploration of natural language agent architectures using [TypeChat](https://github.com/microsoft/typechat).
- Sample agents are not intended to be implemented in real-world settings without further testing/validation.

## Limitations

TypeAgent is early stage sample code over [TypeChat](https://github.com/microsoft/typechat). TypeAgent is not a framework. All code in this repo is intended for building examples (apps, agents, and disptacher hosts) only.

- TypeAgent is in **active development** with frequent updates and refactoring.
- TypeAgent has been tested with Azure Open AI services on developer's own machines only.
- TypeAgent is currently tested in English. Performance may vary in other languages.
- TypeAgent relies on [TypeChat](https://github.com/microsoft/typechat), which uses schema to validate LLM responses. An agent's validity therefore depends on how well _its schema_ represents the user intents and LLM responses _for its domains_.
- You are responsible for supplying any **API keys** for services used by examples.  You can check the [Azure provisioning readme](./azure/README.MD) for a quickstart on setting up the necessary endpoints if you do not already have endpoints.

## Developers

### Exploring Action Dispatch

[Agent Shell](./ts/packages/shell) example allow additional agents to be installed/registered to extend its functionality. For developers who are interested in experimenting with action dispatch for their own scenarios, they can create a _custom agents_ that plugs into the [Agent Shell](./ts/packages/shell) example to explore using the [Agent Dispatcher](./ts/packages/dispatcher/) to route actions to their custom agents. The `Echo` agent [tutorial](./docs/tutorial/agent.md) is a starting point to create a plugin agent, and [Agent SDK](./ts/packages/agentSdk/) provides the interface definitions between [Agent Dispatcher](./ts/packages/dispatcher) and the agent.

### Working with TypeAgent repo

For developers who want to modify TypeAgent or contribute to our repo.

Microsoft TypeAgent Repo is a mono-repo, with components organized with the following root folders based on language used.

- [`ts`](./ts) TypeScript code ([Readme](./ts/README.md))
- [`python`](./python) Python code ([Readme](./python/README.md))
- [`dotnet`](./dotnet) Dotnet (C#) code ([Readme](./dotnet/README.md))
- [`android`](./android/) Android (Kotlin/Java) code ([Readme](./android/README.md))

See more information about working with the repo [here](./docs/help/dev.md).

## Contributing

This project welcomes contributions and suggestions. Most contributions require you to
agree to a Contributor License Agreement (CLA) declaring that you have the right to,
and actually do, grant us the rights to use your contribution. For details, visit
https://cla.microsoft.com.

When you submit a pull request, a CLA-bot will automatically determine whether you need
to provide a CLA and decorate the PR appropriately (e.g., label, comment). Simply follow the
instructions provided by the bot. You will only need to do this once across all repositories using our CLA.

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
