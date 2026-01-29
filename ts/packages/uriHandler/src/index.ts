// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { withConsoleClientIO } from "agent-dispatcher/helpers/console";
import { connectDispatcher } from "@typeagent/agent-server-client";

function parseArgs() {
    let port: number = 8999;
    let uri: string | undefined = undefined;
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

async function run(): Promise<void> {
    const { uri, port } = parseArgs();
    if (uri) {
        console.log(`Processing URI: ${uri}`);
    } else {
        throw new Error("No URI provided");
    }

    const url = new URL(uri);
    if (url.protocol !== "type-agent:") {
        throw new Error("Invalid URI protocol, must be type-agent://");
    }

    const request = url.searchParams.get("request");
    if (!request) {
        throw new Error("No request found in URI");
    }

    await withConsoleClientIO(async (clientIO) => {
        const dispatcher = await connectDispatcher(
            clientIO,
            `ws://localhost:${port}`,
            { filter: true },
        );
        try {
            console.log(`Sending request: ${request}`);
            await dispatcher.processCommand(request);
        } finally {
            if (dispatcher) {
                await dispatcher.close();
            }
        }
    });
}

try {
    await run();
    // Some background network (like mongo) might keep the process live, exit explicitly.
    process.exit(0);
} catch (e: any) {
    console.error("Error:", e.message);
    console.error(e.stack);
    process.exit(1);
}
