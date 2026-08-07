// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { otel } from "@typeagent/telemetry";

let exitPromise: Promise<void> | undefined;
let earlySigintHandler: (() => void) | undefined;

export function registerEarlyTelemetrySignalHandlers(): void {
    if (earlySigintHandler !== undefined) {
        return;
    }
    earlySigintHandler = () => exitCli(0);
    process.once("SIGINT", earlySigintHandler);
    process.once("SIGTERM", earlySigintHandler);
}

export function removeEarlyTelemetrySigintHandler(): void {
    if (earlySigintHandler === undefined) {
        return;
    }
    process.removeListener("SIGINT", earlySigintHandler);
}

export function exitCli(exitCode: number): void {
    exitPromise ??= otel
        .shutdownTelemetry()
        .catch((error) => {
            console.error("Failed to shut down telemetry:", error);
        })
        .then(() => {
            process.exit(exitCode);
        });
}
