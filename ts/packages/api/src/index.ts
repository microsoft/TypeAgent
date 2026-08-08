// Copyright (c) Microsoft Corporation and Henry Lucco.
// Licensed under the MIT License.

import { TypeAgentServer } from "./typeAgentServer.js";
import { loadConfig } from "@typeagent/config";
import { otel } from "@typeagent/telemetry";

let typeAgentServer: TypeAgentServer | undefined;
let shutdownPromise: Promise<void> | undefined;
let shutdownRequested = false;

function shutdownHost(exitCode: number): Promise<void> {
    shutdownRequested = true;
    shutdownPromise ??= (async () => {
        try {
            await typeAgentServer?.stop();
        } catch (error) {
            console.error("[agent-api] Server cleanup failed:", error);
        }
        try {
            await otel.shutdownTelemetry();
        } catch (error) {
            console.error("[agent-api] Telemetry shutdown failed:", error);
        }
        process.exit(exitCode);
    })();
    return shutdownPromise;
}

process.once("disconnect", () => {
    void shutdownHost(1);
});
process.once("SIGINT", () => {
    void shutdownHost(0);
});
process.once("SIGTERM", () => {
    void shutdownHost(0);
});

async function main(): Promise<void> {
    // Load config from YAML layers + Key Vault (replacing legacy dotenv).
    await loadConfig({ keyVault: {}, strict: false });
    await otel.initTelemetry();
    if (shutdownRequested) {
        return;
    }

    typeAgentServer = new TypeAgentServer((exitCode) => {
        void shutdownHost(exitCode);
    });

    await typeAgentServer.start();
}

await main().catch(async (error) => {
    console.error("[agent-api] Fatal startup error:", error);
    await shutdownHost(1);
});
