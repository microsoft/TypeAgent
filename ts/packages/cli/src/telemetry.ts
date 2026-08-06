// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { otel } from "@typeagent/telemetry";

let exitPromise: Promise<void> | undefined;

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
