// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { otel } from "@typeagent/telemetry";
import { selectAgentProcessTelemetry } from "../src/agentProvider/process/agentProcessTelemetry.js";

describe("agent process telemetry configuration", () => {
    it("keeps traces without starting worker metrics or log exporters", () => {
        const traces: otel.TraceConfig = {
            otlp: { endpoint: "http://localhost:4318/v1/traces" },
            sampler: "always_on",
        };
        const config: otel.TelemetryConfig = {
            traces,
            metrics: {
                otlp: { endpoint: "http://localhost:4318/v1/metrics" },
            },
            logs: {
                otlp: { endpoint: "http://localhost:4318/v1/logs" },
                logFile: "worker.jsonl",
            },
            debugBridge: true,
            structuredLogs: true,
        };

        expect(selectAgentProcessTelemetry(config)).toEqual({ traces });
    });

    it("returns an unconfigured telemetry pipeline when traces are disabled", () => {
        expect(
            selectAgentProcessTelemetry({
                logs: { logFile: "worker.jsonl" },
                debugBridge: true,
            }),
        ).toEqual({});
    });
});
