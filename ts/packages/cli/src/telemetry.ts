// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { otel } from "@typeagent/telemetry";
import { stopCopilotClient } from "@typeagent/aiclient";

let exitPromise: Promise<void> | undefined;
let shutdownPromise: Promise<void> | undefined;
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
    exitPromise ??= shutdownCli()
        .catch((error) => {
            console.error("Failed to shut down CLI:", error);
        })
        .then(() => {
            process.exit(exitCode);
        });
}

export function shutdownCli(): Promise<void> {
    return (shutdownPromise ??= stopCopilotClient().finally(() =>
        otel.shutdownTelemetry(),
    ));
}
