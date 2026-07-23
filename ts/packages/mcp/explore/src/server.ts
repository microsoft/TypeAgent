#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ExploreServer } from "./exploreServer.js";
import {
    createCodeModeExplorer,
    createTypeAgentReasoningAdapter,
} from "explorer-typeagent";
import {
    parseExploreServerOptions,
    resolveExploreApiKey,
} from "./serverConfig.js";

try {
    const options = parseExploreServerOptions(
        process.argv.slice(2),
        process.env,
        process.cwd(),
    );
    const reasoningAdapter = createTypeAgentReasoningAdapter({
        baseUrl: options.baseUrl,
        apiKey: resolveExploreApiKey(options, process.env),
        ...(options.reasoningRequestTimeoutMs !== undefined
            ? { requestTimeoutMs: options.reasoningRequestTimeoutMs }
            : {}),
    });
    const explorer = createCodeModeExplorer({
        repoRoot: options.repoRoot,
        reasoningAdapter,
        modelName: options.model,
        maxToolCalls: options.maxToolCalls,
        ...(options.telemetryFile
            ? { telemetryFile: options.telemetryFile }
            : {}),
        ...(options.lsp ? { lsp: options.lsp } : {}),
    });
    const server = new ExploreServer(explorer);
    await server.start();
    console.error(
        `TypeAgent agentic Code Mode explore MCP ready for ${options.repoRoot} using ${options.model}`,
    );
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to start TypeAgent explore MCP: ${message}`);
    process.exitCode = 1;
}
