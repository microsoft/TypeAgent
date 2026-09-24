#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { fileFixture } from "./ghcp-eval-corpus.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { stageCopilotPlugin } from "../../../tools/scripts/stageCopilotPlugin.mjs";
import {
    checkPort,
    makeConfiguration,
    startProcess,
    stopProcess,
    waitForServer,
} from "./discovery-e2e.mjs";

const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
);
const [outputDirectory, configDirectory, ledgerPath, evidenceMode] =
    process.argv.slice(2);
if (!outputDirectory || !configDirectory || !ledgerPath) {
    throw new Error(
        "Usage: node ghcp-eval-preflight.mjs <new-output-directory> <model-config-directory> <credit-ledger>",
    );
}
const port = 19024;
await checkPort(port);
fs.mkdirSync(outputDirectory);
const { env, mcp } = makeConfiguration(
    outputDirectory,
    port,
    process.env,
    configDirectory,
);
env.TYPEAGENT_COPILOT_CREDIT_LEDGER = path.resolve(ledgerPath);
const fixtures = path.join(outputDirectory, "fixtures");
fs.mkdirSync(fixtures);
for (const [name, content] of Object.entries(fileFixture)) {
    fs.writeFileSync(path.join(fixtures, name), content);
}
env.TYPEAGENT_GHCP_EVAL_FIXTURES = fixtures;
fs.mkdirSync(env.TYPEAGENT_PLUGIN_DATA);
stageCopilotPlugin(path.join(outputDirectory, "plugin"));
const result = {
    kind: "catalog_preflight_not_eval",
    status: "running",
    contracts: [],
    missing: [],
    searches: [],
    externalEvidence: [],
};
const controller = new AbortController();
const log = path.join(outputDirectory, "server.stderr.log");
const stdout = fs.openSync(
    path.join(outputDirectory, "server.stdout.log"),
    "a",
);
const stderr = fs.openSync(log, "a");
let server;
let client;
try {
    server = startProcess(
        process.execPath,
        [
            path.join(root, "packages/agentServer/server/dist/server.js"),
            "--port",
            String(port),
            "--config",
            "ghcp-eval",
            "--idle-timeout",
            "300",
        ],
        { cwd: root, env, stdio: ["ignore", stdout, stderr] },
    );
    fs.closeSync(stdout);
    fs.closeSync(stderr);
    await waitForServer(server, port, 90, controller.signal, log);
    const config = mcp.mcpServers["typeagent-e2e"];
    client = new Client({ name: "ghcp-eval-preflight", version: "1.0.0" });
    await client.connect(
        new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: { ...env, ...config.env },
            stderr: "inherit",
        }),
    );
    const required = [
        ["list", "listLists"],
        ["list", "getList"],
        ["list", "addItems"],
        ["list", "clearList"],
        ["github-cli", "prFiles"],
        ["github-cli", "prChecks"],
        ["github-cli", "issueView"],
        ["powershell.powershell-files", "readFile"],
        ["ipconfig", "displayFullConfigurationInformation"],
        ["ipconfig", "displayDNSResolverCacheContents"],
    ];
    let scopeId;
    for (const [schemaName, actionName] of required) {
        let contract;
        const queries = [`${schemaName} ${actionName}`, actionName];
        if (schemaName === "list" && actionName === "clearList") {
            queries.push(
                "remove all items from a list but keep the list itself",
            );
        }
        for (const query of queries) {
            const response = await client.callTool(
                {
                    name: "typeagent-searchActions",
                    arguments: { query },
                },
                undefined,
                { timeout: 30_000 },
            );
            if (response.isError) {
                throw new Error(
                    `Discovery failed for ${schemaName}.${actionName}`,
                );
            }
            result.searches.push({
                query,
                candidates:
                    response.structuredContent?.actions?.map(
                        ({ schemaName, actionName }) => ({
                            schemaName,
                            actionName,
                        }),
                    ) ?? [],
            });
            contract = response.structuredContent?.actions?.find(
                (action) =>
                    action.schemaName === schemaName &&
                    action.actionName === actionName,
            );
            scopeId = response.structuredContent?.scopeId;
            if (contract) break;
        }
        if (contract) result.contracts.push(contract);
        else result.missing.push(`${schemaName}.${actionName}`);
    }
    result.status = result.missing.length === 0 ? "passed" : "blocked";
    if (result.status === "passed" && evidenceMode === "--external-evidence") {
        const requests = [
            ["prFiles", 3058],
            ["prChecks", 3058],
            ["prFiles", 3067],
            ["prChecks", 3067],
            ["issueView", 2617],
        ].map(([actionName, number]) => ({
            schemaName: "github-cli",
            actionName,
            parameters: {
                repo: "microsoft/TypeAgent",
                number,
                ...(actionName === "prFiles"
                    ? { includePatch: false, maxFiles: 50 }
                    : {}),
            },
        }));
        requests.push(
            { schemaName: "list", actionName: "listLists", parameters: {} },
            {
                schemaName: "powershell.powershell-files",
                actionName: "readFile",
                parameters: { path: path.join(fixtures, "report-a.txt") },
            },
            ...[
                "displayFullConfigurationInformation",
                "displayDNSResolverCacheContents",
            ].map((actionName) => ({
                schemaName: "ipconfig",
                actionName,
                parameters: {},
            })),
        );
        for (const action of requests) {
            let response = await client.callTool(
                {
                    name: "typeagent-executeAction",
                    arguments: {
                        protocolVersion: 1,
                        scopeId,
                        ...action,
                    },
                },
                undefined,
                { timeout: 60_000 },
            );
            const pending = response.structuredContent;
            if (
                action.schemaName === "powershell.powershell-files" &&
                pending?.status === "requires_interaction" &&
                pending.prompt?.type === "confirmation" &&
                pending.prompt.action?.parameters?.path ===
                    action.parameters.path
            ) {
                response = await client.callTool(
                    {
                        name: "typeagent-continueAction",
                        arguments: {
                            protocolVersion: 1,
                            scopeId,
                            operationId: pending.operationId,
                            interactionId: pending.interactionId,
                            response: { type: "confirmation", approved: true },
                        },
                    },
                    undefined,
                    { timeout: 60_000 },
                );
            }
            result.externalEvidence.push({
                actionName: action.actionName,
                number: action.parameters.number,
                capturedAt: new Date().toISOString(),
                outcome:
                    action.schemaName === "ipconfig"
                        ? {
                              status: response.structuredContent?.status,
                              sha256: createHash("sha256")
                                  .update(
                                      JSON.stringify(
                                          response.structuredContent,
                                      ),
                                  )
                                  .digest("hex"),
                              redacted:
                                  "network configuration and resolver contents",
                          }
                        : (response.structuredContent ?? response),
            });
            if (
                response.isError ||
                response.structuredContent?.status !== "completed"
            ) {
                result.status = "blocked";
                break;
            }
        }
    }
    if (result.status !== "passed") process.exitCode = 1;
} catch (error) {
    result.status = "failed";
    result.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
} finally {
    try {
        if (client) await client.close();
    } finally {
        if (server) await stopProcess(server);
        fs.writeFileSync(
            path.join(outputDirectory, "result.json"),
            JSON.stringify(result, null, 2) + "\n",
        );
    }
    console.log(
        JSON.stringify({
            status: result.status,
            contractCount: result.contracts.length,
            missing: result.missing,
            error: result.error,
        }),
    );
}
