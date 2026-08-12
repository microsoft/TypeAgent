// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { context as otelContext } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { isTracingSuppressed } from "@opentelemetry/core";
import { format } from "node:util";

import {
    INSTRUMENTATION_SCOPE_NAME,
    INSTRUMENTATION_SCOPE_VERSION,
} from "./instrumentation.js";
import { redactText, type RedactionOptions } from "./redaction.js";

export interface DebugModule {
    log: (this: { namespace?: string }, ...args: unknown[]) => unknown;
}

export interface DebugBridgeOptions extends RedactionOptions {
    readonly excludedNamespacePrefixes?: readonly string[];
}

export interface DebugBridge {
    shutdown(): void;
}

interface InstalledBridge {
    readonly priorLog: DebugModule["log"];
    readonly wrappedLog: DebugModule["log"];
    refCount: number;
}

const installedBridges = new WeakMap<DebugModule, InstalledBridge>();
const DEFAULT_EXCLUSIONS = [
    "typeagent:logger:",
    "typeagent:telemetry:debugBridge",
    "typeagent:telemetry:promptLogger",
] as const;
const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const MAX_BODY_LENGTH = 64 * 1024;
let emitting = false;

export function installDebugBridge(
    debugModules: readonly DebugModule[],
    options: DebugBridgeOptions = {},
): DebugBridge {
    const installed: DebugModule[] = [];
    for (const debugModule of new Set(debugModules)) {
        const existing = installedBridges.get(debugModule);
        if (existing !== undefined) {
            existing.refCount++;
            installed.push(debugModule);
            continue;
        }

        const priorLog = debugModule.log;
        const exclusions =
            options.excludedNamespacePrefixes ?? DEFAULT_EXCLUSIONS;
        const wrappedLog: DebugModule["log"] = function (
            this: { namespace?: string },
            ...args: unknown[]
        ): unknown {
            const result = priorLog.apply(this, args);
            const namespace = this?.namespace;
            if (
                emitting ||
                namespace === undefined ||
                !namespace.startsWith("typeagent:") ||
                exclusions.some((prefix) => namespace.startsWith(prefix))
            ) {
                return result;
            }
            const activeContext = otelContext.active();
            if (isTracingSuppressed(activeContext)) {
                return result;
            }
            try {
                emitting = true;
                const logger = logs.getLogger(
                    INSTRUMENTATION_SCOPE_NAME,
                    INSTRUMENTATION_SCOPE_VERSION,
                );
                if (
                    logger.enabled({
                        context: activeContext,
                        severityNumber: SeverityNumber.DEBUG,
                    })
                ) {
                    const rendered = format(...args).replace(ANSI_ESCAPE, "");
                    const redacted =
                        rendered.length <= MAX_BODY_LENGTH
                            ? redactText(rendered, options)
                            : undefined;
                    const body =
                        redacted !== undefined &&
                        redacted.length <= MAX_BODY_LENGTH
                            ? redacted
                            : "[typeagent debug output truncated]";
                    logger.emit({
                        context: activeContext,
                        severityNumber: SeverityNumber.DEBUG,
                        severityText: "DEBUG",
                        eventName: "debug",
                        body,
                        attributes: {
                            "debug.namespace": namespace,
                        },
                    });
                }
            } catch {
                // The original debug output already ran. Bridge failures lose
                // only the OTel copy and never recurse through diagnostics.
            } finally {
                emitting = false;
            }
            return result;
        };
        debugModule.log = wrappedLog;
        installedBridges.set(debugModule, {
            priorLog,
            wrappedLog,
            refCount: 1,
        });
        installed.push(debugModule);
    }

    let shutdown = false;
    return {
        shutdown(): void {
            if (shutdown) {
                return;
            }
            shutdown = true;
            for (const debugModule of installed) {
                const state = installedBridges.get(debugModule);
                if (state === undefined) {
                    continue;
                }
                state.refCount--;
                if (state.refCount > 0) {
                    continue;
                }
                if (debugModule.log === state.wrappedLog) {
                    debugModule.log = state.priorLog;
                }
                installedBridges.delete(debugModule);
            }
        },
    };
}
