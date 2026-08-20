// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

let structuredLoggingEnabled = false;

export function isStructuredLoggingEnabled(): boolean {
    return structuredLoggingEnabled;
}

/** @internal Set by the process telemetry bootstrap. */
export function setStructuredLoggingEnabled(enabled: boolean): void {
    structuredLoggingEnabled = enabled;
}
