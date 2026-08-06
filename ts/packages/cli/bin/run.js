#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadConfigSync } from "@typeagent/config";
import { otel } from "@typeagent/telemetry";
loadConfigSync();

let signalShutdown;
const shutdownOnSignal = () => {
    signalShutdown ??= otel.shutdownTelemetry().finally(() => {
        process.exit(0);
    });
};
globalThis.__typeagentCliEarlySigintHandler = shutdownOnSignal;
process.once("SIGINT", shutdownOnSignal);
process.once("SIGTERM", shutdownOnSignal);

async function main() {
    const { flush, handle, run } = await import("@oclif/core");
    try {
        await otel.initTelemetry();
        await run(process.argv.slice(2), import.meta.url);
        await flush();
        await otel.shutdownTelemetry();
    } catch (error) {
        await otel.shutdownTelemetry().catch((shutdownError) => {
            console.error("Failed to shut down telemetry:", shutdownError);
        });
        await handle(error);
    }
}

await main();
