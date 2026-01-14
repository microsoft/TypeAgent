#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Windowless Agent Handler - Non-interactive wrapper for TypeAgent dispatcher
// This script accepts a type-agent:// URI and processes it without requiring a TTY

import { connectDispatcher } from "@typeagent/agent-server-client";

// Create a simple non-interactive ClientIO implementation
function createNonInteractiveClientIO() {
    const messages = [];

    return {
        info: (message, source) => {
            messages.push({ type: "info", message, source });
            console.log(`[INFO] ${message}`);
        },
        warn: (message, source) => {
            messages.push({ type: "warn", message, source });
            console.warn(`[WARN] ${message}`);
        },
        error: (message, source) => {
            messages.push({ type: "error", message, source });
            console.error(`[ERROR] ${message}`);
        },
        result: (message, source) => {
            messages.push({ type: "result", message, source });
            console.log(`[RESULT] ${message}`);
        },
        status: (message, source, temporary) => {
            messages.push({ type: "status", message, source, temporary });
            if (!temporary) {
                console.log(`[STATUS] ${message}`);
            }
        },
        success: (message, source) => {
            messages.push({ type: "success", message, source });
            console.log(`[SUCCESS] ${message}`);
        },
        setDisplay: async (source, content) => {
            messages.push({ type: "display", source, content });
        },
        appendDisplay: async (source, content, mode) => {
            messages.push({ type: "appendDisplay", source, content, mode });
        },
        clear: (source) => {
            // No-op for non-interactive
        },
        exit: () => {
            // No-op for non-interactive
        },
        notify: (event, data, source) => {
            messages.push({ type: "notify", event, data, source });
        },
        getMessages: () => messages,
    };
}

function parseArgs() {
    let port = 8999;
    let uri = undefined;

    for (let i = 2; i < process.argv.length; i++) {
        const arg = process.argv[i];
        if (!arg.startsWith("-")) {
            if (uri !== undefined) {
                throw new Error("Multiple URIs provided");
            }
            uri = arg;
            continue;
        }
        if (arg === "--port" || arg === "-p") {
            i++;
            if (i >= process.argv.length) {
                throw new Error("Missing port number after " + arg);
            }
            port = parseInt(process.argv[i], 10);
            if (isNaN(port) || port <= 0 || port >= 65536) {
                throw new Error("Invalid port number: " + process.argv[i]);
            }
        } else {
            throw new Error("Unknown argument: " + arg);
        }
    }

    return { uri, port };
}

async function run() {
    const { uri, port } = parseArgs();

    if (!uri) {
        throw new Error("No URI provided");
    }

    console.log(`Processing URI: ${uri}`);

    const url = new URL(uri);
    if (url.protocol !== "type-agent:") {
        throw new Error("Invalid URI protocol, must be type-agent://");
    }

    const request = url.searchParams.get("request");
    if (!request) {
        throw new Error("No request found in URI");
    }

    const clientIO = createNonInteractiveClientIO();

    try {
        console.log(`Connecting to dispatcher at ws://localhost:${port}`);
        const dispatcher = await connectDispatcher(
            clientIO,
            `ws://localhost:${port}`,
        );

        try {
            console.log(`Sending request: ${request}`);
            await dispatcher.processCommand(request);

            // Get all collected messages
            const messages = clientIO.getMessages();

            // Output JSON result
            const output = {
                success: true,
                request: request,
                messages: messages,
                result: messages
                    .filter((m) => m.type === "result" || m.type === "success")
                    .map((m) => m.message)
                    .join("\n"),
            };

            console.log("\n--- OUTPUT ---");
            console.log(JSON.stringify(output, null, 2));
        } finally {
            await dispatcher.close();
        }
    } catch (error) {
        const output = {
            success: false,
            request: request,
            error: error.message,
        };
        console.error("\n--- ERROR ---");
        console.error(JSON.stringify(output, null, 2));
        throw error;
    }
}

try {
    await run();
    process.exit(0);
} catch (e) {
    console.error("Error:", e.message);
    process.exit(1);
}
