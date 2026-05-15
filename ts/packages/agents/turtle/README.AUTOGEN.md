<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=78436c8e491d4411ef4d54080f83fe51104af178cc162305d039df17d36212e1 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# turtle â€” AI-generated documentation

> ðŸ¤– **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h â€” see the staleness footer at the end of this file.

## Overview

The Turtle package is a TypeAgent application agent designed to provide a web-based interface for visualizing and controlling a turtle that can draw on a canvas. It integrates with the TypeAgent framework to execute drawing actions and render the results in a browser.

## What it does

The Turtle package allows users to control a turtle graphic through various actions. These actions include `forward`, `left`, `right`, `penUp`, and `penDown`. The turtle's movements and drawing actions are visualized on a canvas within a web page. The package communicates with the TypeAgent framework to receive and execute these actions, updating the canvas accordingly.

## Setup

To set up the Turtle package, follow these steps:

1. Ensure you have all necessary dependencies installed by running `pnpm install`.
2. Start the web application by running `pnpm run start` in the package directory.

For detailed setup instructions, see the hand-written README.

## Key Files
The Turtle package is structured as follows:

- **Entry Point**: The main entry point is [index.ts](./src/site/index.ts), which initializes the web application and registers the turtle agent with TypeAgent.
- **HTML and CSS**: The web interface is defined in [index.html](./src/site/index.html) and styled using [styles.css](./src/site/styles.css).
- **Turtle Agent**: The turtle agent is created in [turtleAgent.ts](./src/site/turtleAgent.ts). This file defines the agent's behavior and how it executes actions.
- **Action Schema**: The action schema is defined in [turtleActionSchema.ts](./src/site/turtleActionSchema.ts), specifying the types of actions the turtle can perform.
- **Canvas Management**: The canvas and turtle graphics are managed in [turtleCanvas.ts](./src/site/turtleCanvas.ts), which handles drawing and updating the turtle's position and orientation.
- **Turtle Types**: The turtle's methods and properties are defined in [turtleTypes.ts](./src/site/turtleTypes.ts).

## How to extend

To extend the Turtle package, follow these steps:

1. **Add New Actions**: Define new actions in [turtleActionSchema.ts](./src/site/turtleActionSchema.ts). Ensure each action has a unique `actionName` and appropriate parameters.
2. **Implement Action Handling**: Update [turtleAgent.ts](./src/site/turtleAgent.ts) to handle the new actions. Add cases in the `executeAction` method to execute the new actions.
3. **Update Canvas Logic**: Modify [turtleCanvas.ts](./src/site/turtleCanvas.ts) if the new actions require changes to how the turtle is drawn or positioned.
4. **Test Changes**: Run the web application using `pnpm run start` and verify that the new actions work as expected.

By following these steps, you can extend the functionality of the Turtle package to support additional drawing actions or modify existing behavior.

## Reference

> âš™ï¸ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default â†’ [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)

External: `chalk`, `debug`

### Files of interest

`./src/site/index.ts`, `./src/site/turtleActionSchema.ts`, `./src/site/index.html`, â€¦and 5 more under `./src/`.

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.858Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter turtle docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
