// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { otel } from "@typeagent/telemetry";

/**
 * Agent workers emit RPC spans, while host-level metrics and logs are emitted
 * by agent-server. Avoid creating idle exporters in every worker process.
 */
export function selectAgentProcessTelemetry(
    config: otel.TelemetryConfig,
): otel.TelemetryConfig {
    return config.traces === undefined ? {} : { traces: config.traces };
}
