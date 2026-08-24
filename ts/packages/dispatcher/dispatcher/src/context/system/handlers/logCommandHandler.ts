// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * `@log` — sink-side control surface for local OpenTelemetry capture.
 *
 * This handler is the ONLY place where users configure local OTel sinks: the
 * active profile (`focused`/`diagnostic`/`verbose`/`off`). The profile decides
 * which classes of bridged `debug` log reach the local JSONL sink; structured
 * events are always captured (except the `off` profile, which disables the sink
 * entirely). It never touches `@trace`, DEBUG, or namespace enablement.
 *
 * Phase 2 note: the grammar `@log next-request` is reserved for a future
 * per-request capture feature and is intentionally NOT implemented here.
 */

import registerDebug from "debug";

import type { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import type {
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

const KNOWN_PROFILES = otel.LOCAL_TELEMETRY_PROFILES;

class LogStatusCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Show local OTel sink profile and current @trace patterns";
    public async run(context: ActionContext<unknown>) {
        showLogStatus(context);
    }
}

export function showLogStatus(context: ActionContext<unknown>): void {
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
    lines.push(
        `debug bridge:       ${snapshot.debugBridgeAvailable ? "available" : "not configured"}`,
    );
    lines.push(
        `local JSONL:        ${snapshot.localLogAvailable ? "configured" : "not configured"}`,
    );
    lines.push(`process scope:      pid ${process.pid}`);
    lines.push(`state revision:     ${snapshot.revision}`);
    const profileBehavior: Record<otel.LocalTelemetryProfile, string> = {
        focused: "structured events only (no debug logs)",
        diagnostic: "structured events + error/warn/info debug logs",
        verbose: "structured events + all debug logs",
        off: "local OTel sink disabled",
    };
    lines.push(`profile behavior:   ${profileBehavior[snapshot.profile]}`);
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
        context: ActionContext<unknown>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        setLogProfile(params.args.profile, context);
    }
}

export function setLogProfile(
    profile: string,
    context: ActionContext<unknown>,
): void {
    const raw = profile.trim().toLowerCase();
    if (!isProfileName(raw)) {
        displayError(
            `Unknown profile '${profile}'. Valid: ${KNOWN_PROFILES.join(", ")}.`,
            context,
        );
        return;
    }
    const state = otel.getLocalTelemetryState();
    const snapshot = state.setProfile(raw);
    displaySuccess(`Local OTel profile set to '${snapshot.profile}'.`, context);
    if (raw === "off") {
        displayResult(
            "Note: '@log profile off' does not clear @trace. Use '@trace --clear' if you also want to silence debug output.",
            context,
        );
    }
}

class LogClearCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Reset local OTel sinks to defaults: profile=focused. Leaves @trace unchanged.";
    public async run(context: ActionContext<unknown>) {
        clearLogSettings(context);
    }
}

export function clearLogSettings(context: ActionContext<unknown>): void {
    otel.getLocalTelemetryState().clear();
    displaySuccess(
        "Local OTel sinks reset: profile=focused. @trace patterns unchanged.",
        context,
    );
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
            clear: new LogClearCommandHandler(),
        },
    };
}
