// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
    buildAgentExplorer,
    extractActionsFromSource,
    renderAgentExplorerPage,
} from "./agent-explorer.mjs";

test("extractActionsFromSource captures parameters and sample phrases", () => {
    const source = `
// Create a timer.
// Sample phrases:
//   - "set a timer for 5 minutes"
//   - "start a 10 minute timer"
export type SetTimerAction = {
    actionName: "setTimer";
    parameters: {
        // Timer length in minutes.
        minutes: number;
        // Optional label.
        label?: string;
    };
};
`;
    const [action] = extractActionsFromSource(source);
    assert.equal(action.actionName, "setTimer");
    assert.deepEqual(action.samplePhrases, [
        "set a timer for 5 minutes",
        "start a 10 minute timer",
    ]);
    assert.deepEqual(action.parameters, [
        {
            name: "minutes",
            optional: false,
            type: "number",
            description: "Timer length in minutes.",
        },
        {
            name: "label",
            optional: true,
            type: "string",
            description: "Optional label.",
        },
    ]);
});

test("buildAgentExplorer resolves nested manifest schema references", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "typeagent-agent-explorer-"));
    const agentDir = path.join(root, "timer");
    await fs.mkdir(path.join(agentDir, "src", "agent"), { recursive: true });
    await fs.writeFile(
        path.join(agentDir, "package.json"),
        JSON.stringify({
            name: "@typeagent/timer-agent",
            description: "Timer agent package",
        }),
    );
    await fs.writeFile(
        path.join(agentDir, "src", "agent", "timerManifest.json"),
        JSON.stringify({
            emojiChar: "⏱️",
            description: "Manage timers",
            schema: { originalSchemaFile: "./timerSchema.mts" },
        }),
    );
    await fs.writeFile(
        path.join(agentDir, "src", "agent", "timerSchema.mts"),
        `
// Stop a timer.
// Sample phrases:
//   - "stop my timer"
export type StopTimerAction = {
    actionName: "stopTimer";
    parameters: {};
};
`,
    );
    const explorer = await buildAgentExplorer([agentDir], root);
    assert.equal(explorer.agents.length, 1);
    assert.equal(explorer.agents[0].emoji, "⏱️");
    assert.equal(explorer.agents[0].actions[0].actionName, "stopTimer");
    assert.match(explorer.markdown, /stop my timer/u);
});

test("renderAgentExplorerPage includes action details and links", () => {
    const markdown = renderAgentExplorerPage([
        {
            name: "@typeagent/list-agent",
            slug: "list",
            relDir: "packages/agents/list",
            emoji: "📝",
            description: "Manage lists",
            overviewHref: "./list/overview.md",
            generatedHref: "./list/generated.md",
            sourceHref:
                "https://github.com/microsoft/TypeAgent/tree/main/ts/packages/agents/list",
            actions: [
                {
                    typeName: "AddItemsAction",
                    actionName: "addItems",
                    description: "Add items to a list",
                    samplePhrases: ["add milk to my grocery list"],
                    parameters: [
                        {
                            name: "items",
                            optional: false,
                            type: "string[]",
                            description: "Items to add",
                        },
                    ],
                },
            ],
        },
    ]);
    assert.match(markdown, /Agent & action explorer/u);
    assert.match(markdown, /Generated README/u);
    assert.match(markdown, /add milk to my grocery list/u);
    assert.match(markdown, /<table>/u);
});
