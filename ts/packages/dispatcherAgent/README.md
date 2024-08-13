# Dispatcher Agent Interfaces and Utilities

This package contains interface definitions and utilities for implementing a Dispatcher Agent.
[List](../agents/list/) dispatcher agent is a good example and initial template for building a dispatcher agent.
Go to the [dispatcher README](../dispatcher/README.md) for instructions on how to add a dispatcher agent.

## Dispatcher Agent

To build a dispatcher agent, it needs to provide a manifest and an instantiation entry point.  
These are declared in the `package.json` as export paths:

- `./agent/manifest` - The location of the JSON file for the manifest.
- `./agent/handlers` - an ESM module with an instantiation entry point.

### Manifest

When loading dispatcher agent in a NPM package, the dispatcher first loads the manifest from the agent. It contains definition of the emoji representing the agent and the translator configuration for the agent. See the type `TopLevelTranslatorConfig` and `HierarchicalTranslatorConfig` for the detail.

### Instantiation Entry point

The instantiation entry point is the code entry point for a dispatcher agent. After loading the `./agent/handlers` ESM module,
the `instantiate` function will be call to get an instance of the `DispatcherAgent`. The `DispatcherAgent` provides four optional APIs:

- `initializeAgentContext` - Dispatcher will call after the agent is loaded. It is expected to create a context that will be passed back on all subsequent call to other APIs.
- `updateAgentContext` - A signal indicating whether the action is enabled or disabled for the agent, allowing it to manage resources such as login. The dispatcher calls this function during initialization or when the user enables or disables actions for the dispatcher agent. Each sub-translator can be enabled or disabled independently and the dispatcher will call this API once for each sub-translator. The `translatorName` parameter can be used to distinguish the sub-translator.
- `executeAction` - After the dispatcher translates a user request using the provided translator schema in the manifest, it will route to the agent and call this function to perform the action. All sub-translator actions route to the same API, and the agent will need to handle further routing to handlers.
- `partialInput` - Function to help with auto completion.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
