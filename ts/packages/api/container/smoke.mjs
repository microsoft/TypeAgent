// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import WebSocket from "ws";
import {
    createDispatcher,
    DefaultIndexingServiceRegistry,
} from "agent-dispatcher";
import {
    HOSTED_API_PROFILE,
    HOSTED_API_SECRET_NAME,
    loadHostedApiRuntimeConfig,
} from "../dist/containerBootstrap.js";
import { startAfterBootstrap } from "../dist/startup.js";
import { TypeAgentAPIWebServer } from "../dist/webServer.js";
import { TypeAgentAPIWebSocketServer } from "../dist/webSocketServer.js";
import {
    HOSTED_API_AGENT_NAMES,
    loadHostedApiAgentProviders,
    validateHostedApiAgentCapabilities,
} from "../dist/hostedAgentProfile.js";
import {
    azureApiSettingsFromConfig,
    openai,
    setRuntimeConfig,
} from "@typeagent/aiclient";

const sentinels = [
    "graph-secret-sentinel",
    "cosmosdb-connection-string-sentinel",
    "speech-key-sentinel",
    "unrelated-api-key-sentinel",
];

assert.notEqual(process.getuid?.(), 0, "container must not run as root");
assert.equal(
    fs.existsSync("/root/.azure"),
    false,
    "root Azure CLI state must not exist",
);
assert.equal(
    fs.existsSync(path.join(process.env.HOME, ".azure")),
    false,
    "runtime Azure CLI state must not exist",
);
assert.notEqual(
    spawnSync("sh", ["-c", "command -v az"], { stdio: "ignore" }).status,
    0,
    "Azure CLI must not be installed",
);

const mockServer = http.createServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer smoke-token");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
        JSON.stringify({
            choices: [
                {
                    message: { content: "hosted-agent-ok" },
                    finish_reason: "stop",
                },
            ],
        }),
    );
});
mockServer.listen(0, "127.0.0.1");
await once(mockServer, "listening");
const mockAddress = mockServer.address();
assert(mockAddress && typeof mockAddress === "object");
const endpoint =
    `http://127.0.0.1:${mockAddress.port}/openai/deployments/` +
    "gpt-6-luna/chat/completions?api-version=2025-01-01-preview";

const dedicatedTree = {
    profile: HOSTED_API_PROFILE,
    modelProvider: "azure",
    azureOpenAI: {
        defaultAuth: "identity",
        deployments: {
            gpt_6_luna: {
                endpoints: [
                    {
                        endpoint,
                        region: "eastus",
                        mode: "PAYG",
                    },
                ],
            },
        },
    },
};
const vault = {
    [HOSTED_API_SECRET_NAME]: JSON.stringify(dedicatedTree),
    "typeagent-config": JSON.stringify({
        msGraph: { clientSecret: sentinels[0] },
        storage: {
            database: {
                cosmosDbConnectionString: sentinels[1],
            },
        },
        speech: { apiKey: sentinels[2] },
        openAI: { apiKey: sentinels[3] },
    }),
};
const requests = [];
const runtimeConfig = await loadHostedApiRuntimeConfig({
    fetcher: async (vaultName, secretName) => {
        requests.push(`${vaultName}/${secretName}`);
        return vault[secretName] ?? null;
    },
    endpointValidator: (url, fieldPath) => {
        assert.equal(fieldPath.includes("gpt_6_luna"), true);
        assert.equal(url.protocol, "http:");
        assert.equal(url.hostname, "127.0.0.1");
    },
});
assert.deepEqual(requests, [
    `${process.env.TYPEAGENT_API_CONFIG_VAULT}/${HOSTED_API_SECRET_NAME}`,
]);
setRuntimeConfig(runtimeConfig);
validateHostedApiAgentCapabilities(runtimeConfig);
const hostedProviders = await loadHostedApiAgentProviders();
const hostedAgentNames = hostedProviders
    .flatMap((provider) => provider.getAppAgentNames())
    .sort();
assert.deepEqual(hostedAgentNames, [...HOSTED_API_AGENT_NAMES].sort());
for (const unsupported of [
    "browser",
    "discord",
    "image",
    "mcpfilesystem",
    "photo",
    "video",
]) {
    assert.equal(hostedAgentNames.includes(unsupported), false);
}
for (const supported of ["chat", "list", "timer"]) {
    assert.equal(hostedAgentNames.includes(supported), true);
}
const hostedDispatcher = await createDispatcher("api-container-smoke", {
    appAgentProviders: hostedProviders,
    agents: hostedAgentNames,
    indexingServiceRegistry: new DefaultIndexingServiceRegistry(),
});
const registeredAgentNames = (await hostedDispatcher.getStatus()).agents
    .map((agent) => agent.name)
    .sort();
const registeredAppAgentNames = registeredAgentNames.filter(
    (name) =>
        name !== "dispatcher" &&
        !name.startsWith("dispatcher.") &&
        name !== "system" &&
        !name.startsWith("system."),
);
assert.deepEqual(registeredAppAgentNames, hostedAgentNames);
await hostedDispatcher.close();

const settings = azureApiSettingsFromConfig(
    runtimeConfig,
    openai.ModelType.Chat,
    "gpt_6_luna",
);
settings.tokenProvider = {
    getAccessToken: async () => ({ success: true, data: "smoke-token" }),
    refreshToken: async () => ({ success: true, data: "smoke-token" }),
};
const completion = await openai.createChatModel(settings).complete("smoke");
assert.deepEqual(completion, { success: true, data: "hosted-agent-ok" });

const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), "api-container-smoke-"));
fs.writeFileSync(path.join(webRoot, "index.html"), "<h1>container-ok</h1>");
const webServer = new TypeAgentAPIWebServer(
    {
        wwwroot: webRoot,
        port: 0,
        broadcast: false,
        blobBackupEnabled: false,
    },
    () => ({ ok: true }),
);
const socketServer = new TypeAgentAPIWebSocketServer(
    webServer.server,
    (socket) => socket.send("websocket-ok"),
    (exitCode) => {
        throw new Error(`WebSocket server requested exit ${exitCode}`);
    },
);
webServer.server.listen(0, "127.0.0.1");
await once(webServer.server, "listening");
const webAddress = webServer.server.address();
assert(webAddress && typeof webAddress === "object");

const staticResponse = await fetch(`http://127.0.0.1:${webAddress.port}/`);
assert.equal(staticResponse.status, 200);
assert.match(await staticResponse.text(), /container-ok/);

const socket = new WebSocket(`ws://127.0.0.1:${webAddress.port}/`);
const [socketMessage] = await once(socket, "message");
assert.equal(socketMessage.toString(), "websocket-ok");
socket.close();
socketServer.stop();
await new Promise((resolve) => webServer.server.close(resolve));
fs.rmSync(webRoot, { recursive: true, force: true });
mockServer.close();
await once(mockServer, "close");

let listenerStarted = false;
const missingEnv = {
    HOME: process.env.HOME,
    TYPEAGENT_USER_DATA_DIR: process.env.TYPEAGENT_USER_DATA_DIR,
    TYPEAGENT_API_BOOTSTRAP: HOSTED_API_PROFILE,
    TYPEAGENT_API_CONFIG_VAULT: "missing-vault",
    TYPEAGENT_API_CONFIG_SECRET: HOSTED_API_SECRET_NAME,
};
await assert.rejects(
    startAfterBootstrap(
        () =>
            loadHostedApiRuntimeConfig({
                env: missingEnv,
                fetcher: async () => null,
            }),
        async () => {
            listenerStarted = true;
        },
    ),
    /Dedicated hosted API configuration secret is missing or empty/,
);
assert.equal(listenerStarted, false);

const runtimeStats = fs.statSync(process.env.TYPEAGENT_USER_DATA_DIR);
assert.equal(runtimeStats.mode & 0o777, 0o700);
assert.equal(runtimeStats.uid, process.getuid());
const processEnvironment = fs.readFileSync("/proc/1/environ", "utf8");
for (const sentinel of sentinels) {
    assert.equal(processEnvironment.includes(sentinel), false);
}
assert.deepEqual(
    fs.readdirSync(process.env.TYPEAGENT_USER_DATA_DIR),
    [],
    "bootstrap must not persist configuration",
);

process.stdout.write("API container smoke passed.\n");
