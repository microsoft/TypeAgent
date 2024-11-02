# External Agents

Developers can now use [agent-sdk's](./README.md) and [dispatchers's](../dispatcher/README.md) extensible architecture to build their own application agents. The agents can then surface themselves in the [TypeAgent Shell](../shell) and [TypeAgent CLI](../cli) just like other [agents](../agents) defined in [config.json](../dispatcher/data/config.json).

This document describes the process of building an sample external agent and making it work in the TypeAgent ecosystem.

## Steps to build an `Echo` agent:

For the rest of the documentation, we will assume that the external agent is named `echo`.

### Step 1: Create a new package for the agent

Add `agent-sdk` as a dependency in the package.json file.

**package.json** : Run `npm init -y` to create a new package.

```json
{
  "name": "echo",
  "version": "0.0.1",
  "description": "Echo dispatcher for Type Agent",
  "main": "index.ts",
  "license": "MIT",
  "author": "Microsoft",
  "type": "module",
  "exports": {
    "./agent/manifest": "./dist/agent/echoManifest.json",
    "./agent/handlers": "./dist/agent/echoActionHandler.js"
  },
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1",
    "build": "npm run tsc  && npm run copy:manifest",
    "copy:manifest": "mkdirp dist/agent && cp src/echoManifest.json dist/agent/echoManifest.json && cp dist/echoActionHandler.js dist/agent/echoActionHandler.js && cp ./src/echoActionsSchema.ts dist/agent/echoActionsSchema.ts",
    "clean": "rimraf --glob dist *.tsbuildinfo *.done.build.log",
    "prettier": "prettier --check . --ignore-path ../../../.prettierignore",
    "prettier:fix": "prettier --write . --ignore-path ../../../.prettierignore",
    "tsc": "tsc -b"
  },
  "keywords": [],
  "dependencies": {
    "@typeagent/agent-sdk": "0.0.1"
  },
  "devDependencies": {
    "mkdirp": "^3.0.1",
    "prettier": "^3.2.5",
    "rimraf": "^5.0.5",
    "typescript": "^5.4.2"
  }
}
```

Please look at the [README](./README.md) to understand the basic architecture of the agent-sdk. Also look at the other application agents under the [agents](../agents) directory to understand the structure of the application agents.

Every application agent requires the following files to be present in the agent's source directory. The manifest file is used to register the agent with the TypeAgent ecosystem. The action schema file is used to define the actions that the agent can perform.

**Agent Manifest File** : `echoManifest.json`

```
{
    "emojiChar": "🦜",
    "schema": {
      "description": "A basic echo agent.",
      "schemaFile": "./echoActionsSchema.ts",
      "schemaType": "EchoAction"
    }
  }
```

**Agent Action Schema File** : `echoActionsSchema.ts`

```ts
// The following types define the structure of an object of type EchoAction that represents the requested request from the user.
export type EchoAction = GenEchoAction;

// If the user asks to echo a message back, the system will return a GenEchoAction. The text parameter is the message to be echoed back.
// will contain the text to be echoed back to the user.
export type GenEchoAction = {
  actionName: "echoGen";
  parameters: {
    text?: string;
    // Generate an alternate response based on the request
    altResponse?: string;
  };
};
```

**Agent action handler** : `echoActionHandler.ts`

```ts
// Below is sample code for a simple echo agent.

import {
  ActionContext,
  AppAction,
  AppAgent,
  SessionContext,
  ActionResult,
} from "@typeagent/agent-sdk";
import {
  createActionResultFromTextDisplay,
  createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import { EchoAction } from "./echoActionsSchema.js";

export function instantiate(): AppAgent {
  return {
    initializeAgentContext: initializeEchoContext,
    updateAgentContext: updateEchoContext,
    executeAction: executeEchoAction,
  };
}

type EchoActionContext = {
  echoCount: number;
  echoRequests: Set<string> | undefined;
};

async function initializeEchoContext() {
  return {
    echoCount: 0,
    echoRequests: undefined,
  };
}

async function updateEchoContext(
  enable: boolean,
  context: SessionContext<EchoActionContext>,
): Promise<void> {
  if (enable) {
    context.agentContext.echoRequests = new Set<string>();
    context.agentContext.echoCount = 0;
  }
  context.agentContext.echoCount++;
}

async function executeEchoAction(
  action: AppAction,
  context: ActionContext<EchoActionContext>,
) {
  let result = await handleEchoAction(
    action as EchoAction,
    context.sessionContext.agentContext,
  );
  return result;
}

async function handleEchoAction(
  action: EchoAction,
  echoContext: EchoActionContext,
) {
  let result: ActionResult | undefined = undefined;
  let displayText: string | undefined = undefined;
  switch (action.actionName) {
    case "echoGen":
      displayText = `>> Echo: ${action.parameters.text}`;
      result = createActionResultFromTextDisplay(displayText, displayText);
      break;
    case "unknown":
    default:
      result = createActionResultFromError("Unable to process the action");
      break;
  }
  return result;
}
```

Folder structure for **Echo** agent:

![alt text](.\imgs\image-files.png)

### Step 2: `Echo` agent package

Run `npm pack` from the echo agent's directory to create a tarball of the agent package. This tarball(echo-0.0.1.tgz) can be used to install the agent in the TypeAgent ecosystem.

### Step 3: Install the `Echo` agent

Copy the tar file to the TypeAgent profiles directory. Please verify the path to the TypeAgent profiles directory on your machine.

```bash
cp echo-0.0.1.tgz ~\.typeagent\profiles\dev_0\.
```

Create the `externalAgentsConfig.json` file in the profiles directory with reference to the echo agent:

```json
{
  "agents": {
    "echo": {
      "type": "module",
      "name": "echo"
    }
  }
}
```

### Step 4: Scaffolding for external agents

The TypeAgent ecosystem provides a way to scaffold the external agent. Run the following command to scaffold the external agent:

```bash
mkdir externalagents && cd externalagents
npm init -y
```

If your external agent depends on the an external artifact registry for agent-sdk, create a `.npmrc` file in the externalagents directory with the following contents:

```
@typeagent:registry=https://<path_npm_registry_for_agentsdk>
always-auth=true
```

Now add dependency to the echo agent using the following command:

```bash
npm i ..\echo-0.0.1.tgz
```

The above command will install the echo agent in the externalagents node package.

```json
{
  "name": "externalagents",
  "version": "1.0.0",
  "description": "External agents package contianing references to TypeAgent application agents.",
  "main": "index.js",
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "author": "",
  "license": "MIT License",
  "dependencies": {
    "echo": "file:../echo-0.0.1.tgz"
  }
}
```

### Step 5: Run the TypeAgent cli or shell to see the `Echo` agent in action.

```bash
# you can run these commands from the `ts` folder
# in the TypeAgent root.

pnpm run cli interactive

or

pnpm run shell
```

If the above steps are followed correctly, you should see the `Echo` agent in the TypeAgent ecosystem.

When to run the cli this is how interaction with the `Echo` agent will look like:
![alt text](./imgs/image-cli.png)

When to run the shell this is how interaction with the `Echo` agent will look like:
![alt text](./imgs/image-shell.png)

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
