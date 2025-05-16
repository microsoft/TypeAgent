# TypeAgent SDK Interfaces and Utilities

This package contains interface definitions and utilities for implementing a **Dispatcher Agent**.

- [List](../agents/list/) agent is a good example and initial template for building a dispatcher agent.
- The [Dispatcher README](../dispatcher/README.md) contains instructions on how to register a dispatcher agent with the TypeAgent Dispatcher.
- You can also create [agents as NPM packages](../../../docs/tutorial/agent.md) that can be installed/register to the [Shell](../shell) or [CLI](../cli)

## TypeAgent SDK

To build a dispatcher agent, you provide a manifest and an instantiation entry point for your agent.  
These are declared in the `package.json` as export paths:

- `./agent/manifest` - The location of the JSON file for the manifest.
- `./agent/handlers` - an ESM module with an instantiation entry point.

### Manifest

When loading dispatcher agent in a NPM package, the dispatcher first loads the manifest from the agent. It contains definition of the emoji representing the agent and the translator configuration for the agent. See the type `AppAgentManifest` and `ActionManifest` for the detail.

### Instantiation Entry point

`AppAgent` is the main interface that your agent implements.

The instantiation entry point is the code entry point for an app agent. After loading the `./agent/handlers` ESM module, the `instantiate` function will be called to get an instance of the `AppAgent`. The `AppAgent` provides these optional APIs:

Lifecycle APIs:

- `initializeAgentContext` - Dispatcher will call after the agent is loaded. It is expected to create a context that will be passed back on all subsequent call to other APIs.
- `updateAgentContext` - A signal indicating whether the action is enabled or disabled for the agent, allowing it to manage resources such as login. The dispatcher calls this function during initialization or when the user enables or disables actions for the dispatcher agent. Each sub-schema can be enabled or disabled independently and the dispatcher will call this API once for each sub-translator. The `schemaName` parameter can be used to distinguish the sub-schema.
- `closeAgentContext` - Called when the `AppAgent` is not longer needed to release resources.

Command APIs:

- `getCommands` - If the `AppAgent` want to provide `@` commands, this function should return `CommandDescriptors`.
- `executeCommand` - Dispatcher will call this function after parsing the command based ont he `CommandDescriptors` and provide the agent `ParsedCommandParams` to execute the command.

Action API:

- `executeAction` - After the dispatcher translates a user request using the provided translator schema in the manifest, it will route to the agent and call this function to perform the action. All sub-translator actions route to the same API, and the agent will need to handle further routing to handlers.
- `streamPartialAction` - For cases action can be handled while the translation result is being streamed from the LLM. Look at `chat.generateResponse` as an example.

Cache extensions:

- `validateWildcardMatch` - For parameters is can be wildcards, this function provide the agent to validate the wildcard match from the cache to avoid over generalization.

Output:

- `getDynamicDisplay` - For command/action result that needs to be updated periodically, the host will call this function to get the updated display.

### SessionContext/ActionContext

Display provide context objects to for display and storage functionality. It also tracks a "agent context" object the agent provided during `initializeAgentContext` for the agent to store runtime data between these calls.

#### Display (ActionContext.actionIO)

During execution of action or command, an `ActionContext` is provided with an `actionIO` object to display information to the user.

`setDisplay` - replace the display with the message
`appendDisplay` - append to the display message

Display message is of type `DisplayContent` and can be simple `MessageContent` of text of any `string`, multi-line `string[]`, or a table of `string[][]`. `DisplayContext` can also be an object to specify addition information about the message:

- `DisplayMessageKind` - automatic formatting of message based on kind (`info`, `status`, `warning`, `error`, `success`).
- `DisplayType` - `text`, `html` or `iframe` (`html` content will be sanitize for security, `iframe` will be rendered in an iframe, and both only work in hosts that supports it (e.g. [Shell](../shell/)))

Helper functions is available to help craft the `DisplayContent` object imported from `@typeagent/agent-sdk/helpers/display`. See [displayHelpers.ts](./src/helpers/displayHelpers.ts).

#### Storage (ActionContext.instanceStorage and ActionContext.sessionStorage)

During execution of action or command, an `ActionContext` is provided with `instanceStorage` and optionally `sessionStorage` to persist data. Agent may be running in a isolated environment that doesn't have permanent storage or access to storage.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
