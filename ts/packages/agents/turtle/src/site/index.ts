// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgentManifest } from "@typeagent/agent-sdk";
import { createTurtleAgent } from "./turtleAgent";
import { createTurtleCanvas } from "./turtleCanvas";

const turtle = createTurtleCanvas();
const agent = createTurtleAgent(turtle);

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
        schemaFile: { content: schemaTs, type: "ts" },
    },
};

let registered = false;
document.addEventListener("DOMContentLoaded", () => {
    if (!registered) {
        (window as any)
            .registerTypeAgent("turtle", manifest, agent)
            .then(() => {
                console.log("Turtle agent registered");
            })
            .catch((e: any) => {
                console.error("Failed to register turtle agent", e);
            });
        registered = true;
    }
});
