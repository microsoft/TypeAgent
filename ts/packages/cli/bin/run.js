#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadConfigSync } from "@typeagent/config";
import { otel } from "@typeagent/telemetry";
import registerDebug from "debug";
import { registerEarlyTelemetrySignalHandlers } from "../dist/telemetry.js";
loadConfigSync();

registerEarlyTelemetrySignalHandlers();

async function main() {
    const { flush, handle, run } = await import("@oclif/core");
    try {
        await otel.initTelemetry({
            processName: "cli",
            debugModules: [registerDebug],
        });
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
