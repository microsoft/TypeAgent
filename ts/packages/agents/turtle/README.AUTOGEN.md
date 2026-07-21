<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=160c8079e4837bb1a9d4d6ec9718e8de3b2d2807b07a97e000690cb7b56a1189 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# turtle — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The Turtle package is a TypeAgent application agent that provides a browser-based interface for visualizing and controlling a turtle graphic. The turtle can move and draw on a canvas, executing actions defined by the TypeAgent framework. This package is particularly useful for demonstrating and visualizing sequential commands in a graphical environment.

## What it does

The Turtle package enables users to control a virtual turtle that moves and draws on a canvas. It supports the following actions:

- `forward`: Moves the turtle forward by a specified number of pixels.
- `left`: Rotates the turtle left by a specified number of degrees.
- `right`: Rotates the turtle right by a specified number of degrees.
- `penUp`: Lifts the turtle's pen, preventing it from drawing while moving.
- `penDown`: Lowers the turtle's pen, allowing it to draw while moving.

These actions are visualized in real-time on a web page, where the turtle's movements and drawings are rendered on an HTML canvas. The package integrates with the TypeAgent framework to handle action execution and updates the canvas accordingly. This visualization helps users understand the sequence and effects of the turtle's commands.

## Setup

To set up and run the Turtle package:

1. Install dependencies by running `pnpm install` in the package directory.
2. Start the web application with the command `pnpm run start`.
3. Open the application in a browser to interact with the turtle and visualize its actions.

For additional details, refer to the hand-written README.

## Key Files

The Turtle package is organized into several key files, each responsible for specific functionality:

- **[index.ts](./src/site/index.ts)**: The main entry point of the application. It initializes the web interface, sets up the turtle agent, and registers it with the TypeAgent framework.
- **[index.html](./src/site/index.html)**: Defines the structure of the web page, including the canvas where the turtle's movements are visualized.
- **[styles.css](./src/site/styles.css)**: Provides styling for the web interface, including the canvas and turtle elements.
- **[turtleAgent.ts](./src/site/turtleAgent.ts)**: Implements the turtle agent, defining how it processes and executes actions such as `forward`, `left`, and `penDown`.
- **[turtleActionSchema.ts](./src/site/turtleActionSchema.ts)**: Specifies the schema for turtle actions, including their names and parameters.
- **[turtleCanvas.ts](./src/site/turtleCanvas.ts)**: Manages the canvas and turtle graphics, handling drawing operations, position updates, and orientation changes.
- **[turtleTypes.ts](./src/site/turtleTypes.ts)**: Defines the `Turtle` interface, which includes methods for moving and controlling the turtle.

## How to extend

To extend the functionality of the Turtle package, follow these steps:

1. **Add New Actions**:

   - Define new actions in [turtleActionSchema.ts](./src/site/turtleActionSchema.ts). Each action should have a unique `actionName` and appropriate parameters.
   - For example, to add a `backward` action, define it as:
     ```ts
     interface TurtleBackward {
       actionName: "backward";
       parameters: {
         pixel: number;
       };
     }
     ```

2. **Implement Action Handling**:

   - Update [turtleAgent.ts](./src/site/turtleAgent.ts) to handle the new actions. Add a case in the `executeAction` method to implement the desired behavior.
   - For example:
     ```ts
     case "backward":
         turtle.forward(-action.parameters.pixel);
         break;
     ```

3. **Update Canvas Logic**:

   - If the new actions require changes to how the turtle is drawn or positioned, modify [turtleCanvas.ts](./src/site/turtleCanvas.ts). Ensure the canvas updates correctly to reflect the new behavior.

4. **Test Changes**:
   - Run the application using `pnpm run start` and verify that the new actions work as expected. Test edge cases to ensure the turtle behaves correctly.

By following these steps, you can extend the Turtle package to support additional drawing actions, modify existing behavior, or enhance the visualization.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)

External: `chalk`, `debug`

### Files of interest

`./src/site/index.ts`, `./src/site/turtleActionSchema.ts`, `./src/site/index.html`, …and 5 more under `./src/`.

---

_Auto-generated against commit `de9d1d44c33525463327199c8f244a24ddfdd874` on `2026-07-21T11:18:03.349Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter turtle docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
