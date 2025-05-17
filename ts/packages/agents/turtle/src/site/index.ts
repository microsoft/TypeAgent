// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgentManifest } from "@typeagent/agent-sdk";
import { createTurtleAgent } from "./turtleAgent";
import { createTurtleCanvas } from "./turtleCanvas";

const schemaTs = `
export type TurtleAction =
    | TurtleForward
    | TurtleTurnLeft
    | TurtleTurnRight
    | TurtlePenUp
    | TurtlePenDown;

interface TurtleForward {
    actionName: "forward";
    parameters: {
        pixel: number;
    };
}

interface TurtleTurnLeft {
    actionName: "left";
    parameters: {
        degrees: number;
    };
}

interface TurtleTurnRight {
    actionName: "right";
    parameters: {
        degrees: number;
    };
}

interface TurtlePenUp {
    actionName: "penUp";
}

interface TurtlePenDown {
    actionName: "penDown";
}
`;
const manifest: AppAgentManifest = {
    emojiChar: "🐢",
    description: "A turtle that can draw on a canvas",
    schema: {
        description: "Action to control the turtle to draw on a canvas",
        schemaType: "TurtleAction",
        schemaFile: { content: schemaTs, format: "ts" },
    },
};

async function initialize() {
    const content = document.getElementById("content") as HTMLDivElement;
    const message = document.createTextNode("Connecting to TypeAgent...");
    try {
        content.appendChild(message);
        const { div, turtle } = createTurtleCanvas();
        const agent = createTurtleAgent(turtle);
        await (window as any).registerTypeAgent("turtle", manifest, agent);
        content.removeChild(message);
        content.appendChild(div);
    } catch (e: any) {
        message.nodeValue = `Failed to connect to TypeAgent: ${e.message}`;
    }
}
let initialized = false;
document.addEventListener("DOMContentLoaded", () => {
    if (!initialized) {
        initialized = true;
        initialize();
    }
});
