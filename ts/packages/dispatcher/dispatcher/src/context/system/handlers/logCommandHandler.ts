// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * `@log` — sink-side control surface for local OpenTelemetry capture.
 *
 * This handler is the ONLY place where users configure local OTel sinks: the
 * active profile (`focused`/`diagnostic`/`verbose`/`off`) and the `debug-copy`
 * gate that controls whether debug messages already enabled by `DEBUG`/`@trace`
 * are teed into OTel logs. It never touches `@trace`, DEBUG, or namespace
 * enablement.
 *
 * Phase 2 note: the grammar `@log next-request` is reserved for a future
 * per-request capture feature and is intentionally NOT implemented here.
 */

import registerDebug from "debug";

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayError,
    displayResult,
    displaySuccess,
} from "@typeagent/agent-sdk/helpers/display";
import { otel } from "@typeagent/telemetry";
import { metrics as otelMetrics, trace as otelTrace } from "@opentelemetry/api";

import { CommandHandlerContext } from "../../commandHandlerContext.js";

const KNOWN_PROFILES = otel.LOCAL_TELEMETRY_PROFILES;

class LogStatusCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Show local OTel sink profile, debug-copy state, and current @trace patterns";
    public async run(context: ActionContext<CommandHandlerContext>) {
        const snapshot = otel.getLocalTelemetryState().getSnapshot();

        // Read current @trace namespaces without changing them: `disable()`
        // returns the settings string and clears them, so we re-enable
        // immediately with the same value.
        const currentTrace = registerDebug.disable();
        registerDebug.enable(currentTrace);
        const envDebug = process.env.DEBUG ?? "";
        const provenance =
            currentTrace.length > 0 && currentTrace === envDebug
                ? "env DEBUG"
                : currentTrace.length > 0
                  ? "runtime"
                  : "none";

        let logFilePath: string | undefined;
        try {
            logFilePath = otel.resolveTelemetryConfig().logs?.logFile;
        } catch {
            logFilePath = undefined;
        }

        const providers = {
            trace: describeProvider(otelTrace.getTracerProvider()),
            metrics: describeProvider(otelMetrics.getMeterProvider()),
        };

        const lines: string[] = [];
        lines.push(`Local OTel profile: ${snapshot.profile}`);
        lines.push(`debug-copy:         ${snapshot.debugCopy ? "on" : "off"}`);
        lines.push(
            `debug bridge:       ${snapshot.debugBridgeAvailable ? "available" : "not configured"}`,
        );
        lines.push(
            `local JSONL:        ${snapshot.localLogAvailable ? "configured" : "not configured"}`,
        );
        lines.push(`process scope:      pid ${process.pid}`);
        lines.push(`state revision:     ${snapshot.revision}`);
        if (
            snapshot.profile === "focused" ||
            snapshot.profile === "diagnostic" ||
            snapshot.profile === "verbose"
        ) {
            lines.push(
                "profile behavior:   focused, diagnostic, and verbose are equivalent in Phase 1",
            );
        }
        lines.push("");
        lines.push(`@trace patterns (${provenance}):`);
        lines.push(`  ${currentTrace.length === 0 ? "(none)" : currentTrace}`);
        lines.push("");
        lines.push("Trace preset registry:");
        for (const name of Object.keys(otel.TRACE_PRESETS).sort()) {
            const patterns = otel.TRACE_PRESETS[name];
            lines.push(`  ${name}: ${patterns.join(", ")}`);
        }
        lines.push("");
        lines.push("Provider availability:");
        lines.push(`  traces:  ${providers.trace}`);
        lines.push(`  metrics: ${providers.metrics}`);
        if (logFilePath !== undefined) {
            lines.push("");
            lines.push(`Local JSONL log file: ${logFilePath}`);
        }

        displayResult(lines.join("\n"), context);
    }
}

class LogProfileCommandHandler implements CommandHandler {
    public readonly description =
        "Set the local OTel profile: focused (default), diagnostic, verbose, or off";
    public readonly parameters = {
        args: {
            profile: {
                description:
                    "focused | diagnostic | verbose | off. Never modifies @trace patterns.",
                type: "string",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const raw = params.args.profile.trim().toLowerCase();
        if (!isProfileName(raw)) {
            displayError(
                `Unknown profile '${params.args.profile}'. Valid: ${KNOWN_PROFILES.join(", ")}.`,
                context,
            );
            return;
        }
        const state = otel.getLocalTelemetryState();
        const snapshot = state.setProfile(raw);
        displaySuccess(
            `Local OTel profile set to '${snapshot.profile}'.`,
            context,
        );
        if (raw !== "off") {
            displayResult(
                "Phase 1 note: focused, diagnostic, and verbose currently capture the same local log records.",
                context,
            );
        }
        if (raw === "off") {
            displayResult(
                "Note: '@log profile off' does not clear @trace. Use '@trace --clear' if you also want to silence debug output.",
                context,
            );
        }
    }
}

class LogDebugCopyCommandHandler implements CommandHandler {
    public readonly description =
        "Turn local JSONL debug-copy on/off. It never enables debug namespaces or changes OTLP export.";
    public readonly parameters = {
        args: {
            state: {
                description: "on | off",
                type: "string",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const raw = params.args.state.trim().toLowerCase();
        if (raw !== "on" && raw !== "off") {
            displayError(
                `debug-copy expects 'on' or 'off', got '${params.args.state}'.`,
                context,
            );
            return;
        }
        const on = raw === "on";
        const snapshot = otel.getLocalTelemetryState().getSnapshot();
        if (
            on &&
            (!snapshot.debugBridgeAvailable || !snapshot.localLogAvailable)
        ) {
            const missing = [
                ...(snapshot.debugBridgeAvailable
                    ? []
                    : ["telemetry.debugBridge"]),
                ...(snapshot.localLogAvailable ? [] : ["telemetry.logFile"]),
            ];
            displayError(
                `Cannot enable local JSONL debug-copy: ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not configured. Update telemetry configuration and restart the process.`,
                context,
            );
            return;
        }
        otel.getLocalTelemetryState().setDebugCopy(on);
        displaySuccess(
            `Local JSONL debug-copy is now ${on ? "on" : "off"}.`,
            context,
        );
    }
}

class LogClearCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Reset local OTel sinks to defaults: profile=focused, debug-copy=off. Leaves @trace unchanged.";
    public async run(context: ActionContext<CommandHandlerContext>) {
        otel.getLocalTelemetryState().clear();
        displaySuccess(
            "Local OTel sinks reset: profile=focused, debug-copy=off. @trace patterns unchanged.",
            context,
        );
    }
}

function isProfileName(value: string): value is otel.LocalTelemetryProfile {
    return (KNOWN_PROFILES as readonly string[]).includes(value);
}

function describeProvider(provider: unknown): string {
    if (provider === null || provider === undefined) {
        return "no-op";
    }
    const delegate = (
        provider as {
            getDelegate?: () => unknown;
        }
    ).getDelegate?.();
    if (delegate !== undefined && delegate !== provider) {
        return `active (${getConstructorName(delegate)})`;
    }
    const name = getConstructorName(provider);
    const isNoop =
        name.startsWith("Proxy") ||
        name.startsWith("NoOp") ||
        name === "Object";
    return isNoop ? `no-op (${name})` : `active (${name})`;
}

function getConstructorName(value: unknown): string {
    const ctor = (value as { constructor?: { name?: string } }).constructor;
    return ctor?.name ?? "unknown";
}

export function getLogCommandHandlers(): CommandHandlerTable {
    return {
        description:
            "Local OpenTelemetry sink controls (independent of @trace)",
        defaultSubCommand: new LogStatusCommandHandler(),
        commands: {
            status: new LogStatusCommandHandler(),
            profile: new LogProfileCommandHandler(),
            "debug-copy": new LogDebugCopyCommandHandler(),
            clear: new LogClearCommandHandler(),
        },
    };
}
