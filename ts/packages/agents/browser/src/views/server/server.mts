// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BaseServer } from "./core/baseServer.js";
import { ServerConfig } from "./core/types.js";
import { PlansRoutes } from "./features/plans/plansRoutes.js";
import { PDFRoutes } from "./features/pdf/pdfRoutes.js";
import registerDebug from "debug";

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
        enableCors: true,
        rateLimitWindow: 60000,
        rateLimitMax: 100,
        bodyLimit: "10mb",
    };

    // Create base server
    const server = new BaseServer(config);

    // Register features
    server.registerFeature(PlansRoutes.createFeatureConfig());
    server.registerFeature(PDFRoutes.createFeatureConfig());

    // Start server
    await server.start();

    // Process lifecycle management
    process.send?.("Success");

    process.on("message", (message: any) => {
        debug("Received message:", message);
    });

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
