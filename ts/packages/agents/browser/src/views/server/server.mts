// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BaseServer } from "./core/baseServer.js";
import { ServerConfig } from "./core/types.js";
import { PDFRoutes } from "./features/pdf/pdfRoutes.js";
import registerDebug from "debug";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import { createChannelAdapter } from "@typeagent/agent-rpc/channel";
import type {
    ViewInvokeFunctions,
    ViewCallFunctions,
} from "@typeagent/browser-control-rpc/viewRpc";
import { registerViewRoutes } from "./features/views/viewRoutes.mjs";
import { browserViews } from "@typeagent/browser-control-rpc/viewRoutes";

const debug = registerDebug("typeagent:views:server");

async function main() {
    // Get port from command line arguments
    const port = parseInt(process.argv[2]);
    if (isNaN(port)) {
        throw new Error("Port must be a number");
    }

    // Server configuration
    const config: ServerConfig = {
        port,
        enableCors: false,
        rateLimitWindow: 1000,
        rateLimitMax: 100,
        bodyLimit: "10mb",
    };

    // Create base server
    const server = new BaseServer(config);
    for (const view of Object.values(browserViews)) {
        server
            .getApp()
            .get(
                [view.path, `/views/${view.page}`, `/${view.page}`],
                (_req, res) => {
                    const query = _req.originalUrl.includes("?")
                        ? _req.originalUrl.slice(_req.originalUrl.indexOf("?"))
                        : "";
                    res.redirect(302, `/library/${view.page}${query}`);
                },
            );
    }
    if (!process.send) {
        throw new Error("Views server requires a parent IPC channel");
    }
    const send = process.send.bind(process);
    const adapter = createChannelAdapter((message, callback) =>
        send(message, callback),
    );
    process.on("message", adapter.notifyMessage);
    process.on("disconnect", adapter.notifyDisconnected);
    const rpc = createRpc<ViewInvokeFunctions, {}, {}, ViewCallFunctions>(
        "browser-view-child",
        adapter.channel,
        undefined,
        {
            viewEvent: (event) =>
                server.getSSEManager().broadcast("views", event),
        },
    );
    registerViewRoutes(server.getApp(), server.getSSEManager(), (request) =>
        rpc.invoke(request.method, request.params),
    );

    // Register features
    await server.registerFeature(PDFRoutes.createFeatureConfig());

    // Start server
    await server.start();

    // Process lifecycle management
    process.send?.({ type: "Success", port: server.port });

    process.on("disconnect", () => {
        debug("Process disconnected, exiting...");
        process.exit(1);
    });

    process.on("SIGTERM", () => {
        debug("SIGTERM received, shutting down gracefully...");
        process.exit(0);
    });

    process.on("SIGINT", () => {
        debug("SIGINT received, shutting down gracefully...");
        process.exit(0);
    });
}

main().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
});
