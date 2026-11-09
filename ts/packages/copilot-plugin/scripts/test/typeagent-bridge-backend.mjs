// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Synthetic loopback backend for the native CLI bridge acceptance scenario.
import assert from "node:assert/strict";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createSharedDispatcher } from "../../../agentServer/server/dist/sharedDispatcher.js";
import { createAgentServerConnectionHandler } from "../../../agentServer/server/dist/connectionHandler.js";

const [directory, portText] = process.argv.slice(2);
const port = Number(portText);
assert(directory && path.isAbsolute(directory));
assert(Number.isInteger(port) && port > 1024 && port < 65536);
await mkdir(directory, { recursive: true });
process.env.TYPEAGENT_USER_DATA_DIR = path.join(directory, "user");
const require = createRequire(
    new URL("../../../agentServer/server/package.json", import.meta.url),
);
const { createWebSocketChannelServer } = await import(
    pathToFileURL(require.resolve("@typeagent/websocket-channel-server")).href
);
const manifest = {
    description:
        "Synthetic readiness documents only; no external accounts or data.",
    emojiChar: "",
    schema: {
        description: "Read a current synthetic readiness note by project name.",
        schemaType: "Readiness",
        schemaFile: {
            format: "ts",
            content: `
            export type Readiness = {
                actionName: "readReadiness";
                parameters: { project: string };
            };
        `,
        },
        actionPolicies: { readReadiness: { effects: "read-only" } },
    },
};
const notes = {
    Orion: "ORION: synthetic checklist complete; launch is GREEN.",
    Vega: "VEGA: synthetic dependency pending; launch is AMBER.",
    Nova: "NOVA: synthetic acceptance passed; launch is BLUE.",
};
const audit = path.join(directory, "actions.jsonl");
const agent = {
    checkReadiness: async () => ({ state: "ready" }),
    executeAction: async (action) => {
        assert.equal(action.actionName, "readReadiness");
        const project = action.parameters?.project;
        assert.equal(typeof project, "string");
        assert(Object.hasOwn(notes, project), "Unknown synthetic project.");
        const value = { project, note: notes[project] };
        await appendFile(
            audit,
            JSON.stringify({
                at: new Date().toISOString(),
                action: "readReadiness",
                parameters: action.parameters,
                result: value,
            }) + "\n",
        );
        return {
            entities: [],
            resultValue: value,
            displayContent: notes[project],
        };
    },
};
const provider = {
    getAppAgentNames: () => ["readinessFixture"],
    getAppAgentManifest: async () => manifest,
    loadAppAgent: async () => agent,
    unloadAppAgent: async () => {},
};
const shared = await createSharedDispatcher("typeagent-bridge-demo", {
    agents: { schemas: ["readinessFixture"], actions: ["readinessFixture"] },
    appAgentProviders: [provider],
    translation: { enabled: false },
    explainer: { enabled: false },
    cache: { enabled: false },
    collectCommandResult: true,
    metrics: true,
    conversationMemorySettings: {
        requestKnowledgeExtraction: false,
        actionResultEntityStorage: false,
        actionResultKnowledgeExtraction: false,
    },
});
const conversationManager = {
    resolveConversationId: async (id) => {
        assert(!id || id === "fixture");
        return "fixture";
    },
    async joinConversation(_id, io, close, options) {
        const dispatcher = shared.join(io, close, options);
        return {
            dispatcher,
            connectionId: dispatcher.connectionId,
            name: "Synthetic fixture",
            pendingInteractions: shared.getPendingInteractions(
                dispatcher.connectionId,
                true,
            ),
            structuredActions: shared.getStructuredActionBinding(
                dispatcher.connectionId,
            ),
        };
    },
    leaveConversation: async (_id, connectionId) => shared.leave(connectionId),
};
const { handler } = createAgentServerConnectionHandler({
    conversationManager,
    macroManager: {},
    skillCatalog: {},
    shutdown() {},
    getUserIdentity: () => ({
        username: "synthetic",
        displayName: "Synthetic",
        initial: "S",
    }),
});
const server = await createWebSocketChannelServer(
    { host: "127.0.0.1", port },
    handler,
);
await writeFile(
    path.join(directory, "ready.json"),
    JSON.stringify({
        pid: process.pid,
        port,
        source: fileURLToPath(import.meta.url),
        execution:
            "actual shared Dispatcher with synthetic read-only application provider",
    }),
);
let closing;
const close = () =>
    (closing ??= (async () => {
        server.close();
        await shared.close();
    })());
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
