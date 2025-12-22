// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgentManifest } from "@typeagent/agent-sdk";
import { createTurtleAgent } from "./turtleAgent";
import { createTurtleCanvas } from "./turtleCanvas";
import schemaPas from "../../dist/site/turtleActionSchema.pas.json";

const manifest: AppAgentManifest = {
    emojiChar: "🐢",
    description: "A turtle that can draw on a canvas",
    schema: {
        description: "Action to control the turtle to draw on a canvas",
        schemaType: "TurtleAction",
        schemaFile: { content: JSON.stringify(schemaPas), format: "pas" },
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
