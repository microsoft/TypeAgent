# TypeAgent

**NOTE: For the Python port see [microsoft/typeagent-py](https://github.com/microsoft/typeagent-py/blob/main/README.md).**

**TypeAgent** is **sample code** that explores an architecture for building a _single personal agent_ with _natural language interfaces_ leveraging current advances in LLM technology.

The goal of the TypeAgent team is to explore how to get work done by safely and efficiently combining stochastic systems like language models with traditional software components.  Three principles have emerged during this investigation.  They are listed below along with examples of how the principles apply to actions, memory and plans.

- Principle: distill models into logical structures
  - Actions: find translation patterns and replace some model calls by applying patterns
  - Memory: build ontologies from text
  - Plans: people, programs and models collaborate using “tree of thought”
- Principle: use structure to control information density
  - Actions: applications define discrete categories with dense descriptions of action sets
  - Memory: tight semantic structures fit into attention budget
  - Plans: each search tree node defines a focused sub-problem
- Principle: use structure to enable collaboration
  - Actions: humans decide how to disambiguate action requests
  - Memory: simple models extract logical structure from text
  - Plan: quality models, advantage models, language models, humans and programs collaborate to expand each best-first-search node

We are trying to create human-like memory with super-human precision and recall for agent conversations.  We are using a new indexing and query processing approach called [Structured RAG](./docs/content/architecture/memory.md) as the basis for agent memory.  Structured RAG does substantially better than Classic RAG at answering questions about past conversations such as "what were the books we talked about?" and "what step were we on in building the photo montage?"

We are trying to build a single personal agent that can apply to any application.  To apply agent interfaces to all applications, we need to map user requests to actions at much lower cost and latency than current systems.  To make this possible, we have created a system that can distill language models into logical systems that can handle most user requests.

Actions and memories flow together.  Actions like "add to my calendar pickle ball game 2-3pm on Friday" yield memories that can become parameters of future actions like "put in an hour of recovery time after my pickle ball game."  We are working on an architecture, AMP, that enables this natural information flow by integrating actions, memories, and plans

We are applying AMP to the web by creating a browser that enables web sites to register actions through a JavaScript interface.

## Getting Started

### Quick start - TypeAgent Shell Example

[TypeAgent Shell](./ts/packages/shell) example is the starting point to explore the **single personal agent** with **natural language interfaces** we have built so far. It is an Electron application for interacting with multiple registered agents using a single unified user interface. TypeAgent Shell includes:

- Single personal agent conversational interface with voice support
- Collaborate with users to perform and dispatch actions to an extensible set of agents, answer question and carry on a conversation.
- Conversational memory based on Structured RAG
- Integration with TypeAgent Cache to lower cost and latency

Follow these step-by-step instructions to quickly setup tools and environments from scratch to build, run, explore, and develop.

- [Windows](./docs/content/setup/setup-Windows.md)
- [WSL2](./docs/content/setup/setup-WSL2.md)
- [Linux (Ubuntu/Debian)](./docs/content/setup/setup-Linux.md)
- [MacOS](./docs/content/setup/setup-macOS.md)

For more detailed setup instructions, see the [README.md](./ts/README.md) in the TypeScript code [directory](./ts)

### Quick start - Components

- [TypeAgent Dispatcher](./ts/packages/dispatcher/)

  Explores applying structured prompting and LLM to route user requests to agents whose typed contract best matches user intent. Main component of the personal agent.

- [KnowPro](./ts/packages/knowPro)

  Explores how to implement agent memory using the ideas of [Structured RAG](./docs/content/architecture/memory.md).

- [TypeAgent Cache](./ts/packages/cache/)

  Explores how LLM with structured prompting can be used to cache action translation, minimizing the need to go the LLM.

## State Management

Storage, registration, chat, memory and other state maintained by examples is **_typically_** stored **_locally_** in **your user folder** on your development machine. State is typically saved as ordinary text or JSON files in sub-folders below your user folder.

Example agents that use the Microsoft Graph or similar external services may store state in those services.

Code in this repo does not collect telemetry by default.

## Intended Uses

- TypeAgent is sample code shared to encourage the exploration of natural language agent architectures using structured prompting and LLM
- Sample agents are not intended to be implemented in real-world settings without further testing/validation.

## Roadmap

- Publish libraries for agent memory and action dispatch.

## Limitations

TypeAgent is early stage sample code. TypeAgent is not a framework. All code in this repo is intended for building examples (apps, agents, and dispatcher hosts) only.

- TypeAgent is in **active development** with frequent updates and refactoring.
- TypeAgent has been tested with Azure Open AI services on developer's own machines only.
- TypeAgent is currently tested in English. Performance may vary in other languages.
- TypeAgent uses schema to validate LLM responses. An agent's validity therefore depends on how well _its schema_ represents the user intents and LLM responses _for its domains_.
- You are responsible for supplying any **API keys** for services used by examples. You can check the [Azure provisioning readme](./azure/README.MD) for a quickstart on setting up the necessary endpoints if you do not already have endpoints.

## Developers

### Repo Overview

This repo contains the personal agent and example application agents, along with internal packages used to build them. **TypeAgent** uses structured prompting with LLM technique for many of the components,
to build a set of application agents that **take actions**. Agents define actions using [TypeChat](https://github.com/microsoft/typechat) schemas.

### Exploring Action Dispatch

[TypeAgent Shell](./ts/packages/shell)'s functionality can be extended by installing/registering additional agents. For developers who are interested in experimenting adding action dispatch for their own scenarios, they can create a _custom agents_ that plugs into the [TypeAgent Shell](./ts/packages/shell) example to explore using the [dispatcher](./ts/packages/dispatcher/) to route actions to their custom agents. The `Echo` agent [tutorial](./docs/content/tutorial/agent.md) is a starting point to create a plugin agent, and [TypeAgent SDK](./ts/packages/agentSdk/) provides the interface definitions between [dispatcher](./ts/packages/dispatcher) and the agent.

### Working with TypeAgent Repo

For developers who want to modify TypeAgent or contribute to our repo.

Microsoft TypeAgent Repo is a mono-repo, with components organized with the following root folders based on language used.

- [`ts`](./ts) TypeScript code ([Readme](./ts/README.md))
- [`python`](./python) Python code ([Readme](./python/README.md))
- [`dotnet`](./dotnet) Dotnet (C#) code ([Readme](./dotnet/README.md))
- [`android`](./android/) Android (Kotlin/Java) code ([Readme](./android/README.md))

See more information about working with the repo [here](./docs/content/help/dev.md).

#### Apps

- [TypeAgent Shell](./ts/packages/shell/)
- [TypeAgent CLI](./ts/packages/lic/)

#### Agents

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

## Questions

If you have any questions about our project, you can post them in our [Q&A discussion section](https://github.com/microsoft/TypeAgent/discussions/categories/q-a).

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
