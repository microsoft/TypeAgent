# Tutorial: build an Echo agent (standalone package)

TypeAgent [Shell](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/shell) and [CLI](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/cli) are built using [TypeAgent Dispatcher](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/dispatcher). It has a configurable and extensible architecture that allow custom agents to plug into the system. The TypeAgent repo includes several example [agents](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/agents). **Application agents** can be built **_outside_** the TypeAgent repo by using the [TypeAgent SDK](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/agentSdk/README.md). These agents can be packaged as npm packages and then surfaced in the [Shell](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/shell) or [CLI](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/cli).

This tutorial is a hands-on walkthrough of the **standalone external-package** case: authoring an agent in its own npm package outside the TypeAgent repo. For the broader picture (agent patterns, in-repo authoring, distribution via path / catalog / feed), start with [Build an agent](./index.md). This tutorial complements that guide with a concrete Echo example.

## Prerequisites

Begin by exploring the following:

- **TypeAgent SDK**: Read about the architecture of the [TypeAgent SDK](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/agentSdk/README.md).
- **Example Agents**:
  - Review agents under the [agents](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/agents) directory. The [List](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/agents/list) agent provides a good example and template for building an agent.
  - The [Echo](https://github.com/microsoft/TypeAgent/tree/main/ts/examples/agentExamples/echo) agent illustrates the basics of building your own custom application agents.

## Steps to build an `Echo` agent outside of the repo

For the rest of the documentation, we will assume that the custom agent is named **echo**. The echo agent performs a single action: echos any input back to the user.

You can see the end result of this tutorial in [Echo](https://github.com/microsoft/TypeAgent/tree/main/ts/examples/agentExamples/echo) with some modification (NOTE: The only difference is the `@typeagent/agent-sdk` dependency)

### Step 1: Create and author the `Echo` agent package

Follow the following steps to create the `Echo` agent packages manually. Start by create a directory `echo` **_outside_** of the TypeAgent repo. Then populate the directory with the following content:

**package.json** [package.json](https://github.com/microsoft/TypeAgent/blob/main/ts/examples/agentExamples/echo/package.json) :

The `package.json` contains references to **handler** and **manifest** files in the `exports` field.

```json
{
  "name": "echo",
  "version": "0.0.1",
  "description": "Echo example for TypeAgent",
  "license": "MIT",
  "author": "Microsoft",
  "type": "module",
  "exports": {
    "./agent/manifest": "./src/echoManifest.json",
    "./agent/handlers": "./dist/echoActionHandler.js"
  },
  "scripts": {
    "build": "npm run tsc",
    "clean": "rimraf --glob dist *.tsbuildinfo *.done.build.log",
    "tsc": "tsc -b"
  },
  "keywords": [],
  "dependencies": {
    "@typeagent/agent-sdk": "0.0.1"
  },
  "devDependencies": {
    "rimraf": "^5.0.5",
    "typescript": "^5.4.2"
  }
}
```

**Typescript build config file** [`tsconfig.json`](https://github.com/microsoft/TypeAgent/blob/main/ts/examples/agentExamples/echo/tsconfig.json)

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "es2021",
    "lib": ["es2021"],
    "module": "node16",
    "declaration": true,
    "declarationMap": true,
    "esModuleInterop": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "incremental": true,
    "noEmitOnError": true,
    "noUnusedLocals": true,
    "skipLibCheck": true,
    "strict": true,
    "sourceMap": true,
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["./src/**/*"],
  "ts-node": {
    "esm": true
  }
}
```

Every application agent requires the following files to be present in the agent's [**source**](https://github.com/microsoft/TypeAgent/tree/main/ts/examples/agentExamples/echo/src) directory.

- **Agent Manifest File**: The manifest file is used to register the agent with the TypeAgent ecosystem.
- **Action Schema File**: The action schema file is used to define the actions that the agent can perform.
- **Agent Action Handler**: Your code that perform's the agent's actions.

**Agent Manifest File** : [`src/echoManifest.json`](https://github.com/microsoft/TypeAgent/blob/main/ts/examples/agentExamples/echo/src/echoManifest.json)

The manifest file contain reference in `schemaFile` to the path to **schema** file (relative path to the **manifest** file) and the `schemaType` corresponds to the union type of all the actions.

```json
{
  "emojiChar": "🦜",
  "schema": {
    "description": "A basic echo agent.",
    "schemaFile": "./echoActionSchema.ts",
    "schemaType": "EchoAction"
  }
}
```

**Agent Action Schema File** : [`src/echoActionSchema.ts`](https://github.com/microsoft/TypeAgent/blob/main/ts/examples/agentExamples/echo/src/echoActionSchema.ts)

```ts
export type EchoAction = GenEchoAction;

// If the user asks to echo a message back, the system will return a GenEchoAction. The text parameter is the message to be echoed back.
// will contain the text to be echoed back to the user.
export type GenEchoAction = {
  actionName: "echoGen";
  parameters: {
    text: string;
  };
};
```

**Agent action handler** : [`src/echoActionHandler.ts`](https://github.com/microsoft/TypeAgent/blob/main/ts/examples/agentExamples/echo/src/echoActionHandler.ts)

```ts
import { ActionContext, AppAgent, TypeAgentAction } from "@typeagent/agent-sdk";
import {
  createActionResultFromTextDisplay,
  createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import { EchoAction } from "./echoActionSchema.js";

export function instantiate(): AppAgent {
  return {
    initializeAgentContext: initializeEchoContext,
    executeAction: executeEchoAction,
  };
}

type EchoActionContext = {
  echoCount: number;
};

async function initializeEchoContext(): Promise<EchoActionContext> {
  return { echoCount: 0 };
}

async function executeEchoAction(
  action: TypeAgentAction<EchoAction>,
  context: ActionContext<EchoActionContext>,
) {
  // The context created in initializeEchoContext is returned in the action context.
  const echoContext = context.sessionContext.agentContext;
  switch (action.actionName) {
    case "echoGen":
      const displayText = `>> Echo ${++echoContext.echoCount}: ${
        action.parameters.text
      }`;
      return createActionResultFromTextDisplay(displayText, displayText);

    default:
      return createActionResultFromError("Unable to process the action");
  }
}
```

#### Folder structure for **Echo** agent:

```
┣━ package.json
┣━ tsconfig.json
┗━ src
   ┣━ echoManifest.json
   ┣━ echoActionSchema.ts
   ┗━ echoActionHandler.ts
```

### Step 2: Build the Agent

First make sure the [TypeAgent's typescript code](https://github.com/microsoft/TypeAgent/tree/main/ts) is built.

- Go to `<repo>/ts`
- `pnpm i`
- `pnpm run build`

Then create a link globally to the `@typeagent/agent-sdk` package for the `Echo` agent to consume.

- Go to `<repo>/ts/packages/agentSdk`
- `npm link`

In the `Echo` package, run the following to link to `@typeagent/agent-sdk` package and build

- `npm link @typeagent/agent-sdk`
- `npm install`
- `npm run build`

### Step 3: Install `Echo` agent in TypeAgent cli or shell.

Start TypeAgent [Shell](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/shell) or [CLI](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/cli)

```bash
# you can run these commands from the `ts` folder
# in the TypeAgent root.

pnpm run cli interactive

or

pnpm run shell
```

In the [Shell](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/shell) or [CLI](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/cli), install the echo agent and check the status by issuing the command:

```
@install echo <path to echo package>
@config agent
```

The `Echo` agent should be in the list and enabled.

### Step 4: See the `Echo` agent in action

`Echo` agent is now ready. Test it out by issuing some request to see the `Echo` agent in action

When to run the cli this is how interaction with the `Echo` agent will look like:
![alt text](https://github.com/microsoft/TypeAgent/raw/main/docs/content/tutorial/imgs/image-cli.png)

When to run the shell this is how interaction with the `Echo` agent will look like:
![alt text](https://github.com/microsoft/TypeAgent/raw/main/docs/content/tutorial/imgs/image-shell.png)

The `Echo` agent will be reloaded again after installation. It can be uninstalled using the command:

```
@uninstall echo
```

## Next step

Start modifying the `Echo` agent and add new action schema and action handlers.

## Where to go next

- **Broader picture:** [Build an agent](./index.md) covers picking a pattern,
  authoring in-repo vs. standalone, and the three distribution options
  (path / catalog / feed).
- **Display output to the user:** [User interaction (`ActionIO`)](./user-interaction.md)
  walks through `setDisplay` / `appendDisplay`, message kinds, and the display
  helpers exported from `@typeagent/agent-sdk/helpers/display`.
- **Choose an architectural pattern:** [Agent patterns](../../architecture/agents/agent-patterns.md)
  covers the nine patterns and when each is a good fit.
- **Install sources for distribution:** [Agent install sources](../../architecture/lifecycle/agent-sources.md)
  explains how path / catalog / feed sources resolve and how ordering works
  (useful for shadowing a published version with a local build during iteration).
