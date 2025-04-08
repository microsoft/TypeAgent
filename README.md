# TypeAgent

**TypeAgent** is **sample code** that explores an architecture for using [TypeChat](https://github.com/microsoft/typechat) to build a _personal agent_ with a _natural language interface_.

**TypeAgent** uses [TypeChat](https://github.com/microsoft/typechat) to build a set of application agents that **take actions**. Agents define actions using [TypeChat](https://github.com/microsoft/typechat) schemas.

The TypeAgent repo contains the personal agent and example application agents, along with internal packages used to build them.

## Examples

- Application agents with natural language interfaces:

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
  - [Test](./ts/packages/agents/test/)
  - [Turtle](./ts/packages/agents/turtle/)

- [Agent Dispatcher](./ts/packages/dispatcher/)

  Explores applying [TypeChat](https://github.com/microsoft/typechat) to route user requests to agents whose typed contract best matches user intent. Main component of the personal agent.

- [Agent Cache](./ts/packages/cache/)

  Explores how [TypeChat](https://github.com/microsoft/typechat) translations from user intent to actions can be cached, minimizing the need to go the LLM.

- [Agent Shell](./ts/packages/shell/)

  An Electron application for interacting with multiple registered agents using a single unified user interface. Agent Shell includes:

  - Integrated chat experience with voice support
  - Dispatcher that dispatches to registered agents
  - Structured memory
  - Structured RAG

### State Management

Storage, registration, chat, memory and other state maintained by examples is **_typically_** stored **_locally_** in **your user folder** on your development machine. State is typically saved as ordinary text or JSON files in sub-folders below your user folder.

Example agents that use the Microsoft Graph or similar external services may store state in those services.

## Intended Uses

- TypeAgent is sample code shared to encourage the exploration of natural language agent architectures using [TypeChat](https://github.com/microsoft/typechat).
- Sample agents are not intended to be implemented in real-world settings without further testing/validation.

## Limitations

TypeAgent is early stage sample code over [TypeChat](https://github.com/microsoft/typechat). TypeAgent is not a framework. All code in this repo is intended for building our own example apps and agents only.

- TypeAgent is in **active development** with frequent updates and refactoring.
- TypeAgent has been tested with Azure Open AI services on developer's own machines only.
- TypeAgent is currently tested in English. Performance may vary in other languages.
- TypeAgent relies on [TypeChat](https://github.com/microsoft/typechat), which uses schema to validate LLM responses. An agent's validity therefore depends on how well _its schema_ represents the user intents and LLM responses _for its domains_.
- You are responsible for supplying any **API keys** for services used by examples.

## Getting Started

TypeAgent is written in TypeScript and relies on [TypeChat](https://github.com/microsoft/typechat). To understand how TypeAgent examples work, we recommend getting comfortable with [TypeChat](https://github.com/microsoft/typechat) and [TypeChat examples](https://github.com/microsoft/TypeChat/tree/main/typescript/examples) first.

### Quick start - Agent Shell Example

The main entry point to explore TypeAgent is the [Agent Shell](./ts/packages/shell) example.

Follow these quick starts for step-by-step instructions to quickly setup tools and environments from scratch to build, run and develop.

- [Windows](./docs/setup/setup-Windows.md)
- [WSL2](./docs/setup/setup-WSL2.md)
- [Linux (Ubuntu/Debian)](./docs/setup/setup-Linux.md)
- MacOS (coming soon)

See the [instructions](./ts/README.md) in the TypeScript code [directory](./ts) for more detailed setup instructions.

## Developers

### Custom Dispatcher Agents

For developer that are interested develop custom agents to show up in our [Agent Shell](./ts/packages/shell) example and explore using the [Agent Dispatcher](./ts/packages/dispatcher/) to route action to the custom agents, [Agent Shell](./ts/packages/shell) example allow additional agent to be installed/registered to extent functionality. The `Echo` agent [tutorial](./docs/tutorial/agent.md) is a starting point to create a plugin agent, and [Agent SDK](./ts/packages/agentSdk/) provides the details of the interface between [Agent Dispatcher](./ts/packages/dispatcher) and the agent.

### Developing TypeAgent

For developer who wants to modify TypeAgent and contribute to our repo.

Microsoft TypeAgent Repo is a mono-repo, with components organized with the following root folders based on language used.

- [`ts`](./ts) TypeScript code ([Readme](./ts/README.md))
- [`python`](./python) Python code ([Readme](./python/README.md))
- [`dotnet`](./dotnet) Dotnet (C#) code ([Readme](./dotnet/README.md))

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
