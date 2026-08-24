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
import {
    classifyDebugNamespace,
    DEBUG_CLASS_ATTRIBUTE,
    DEBUG_NAMESPACE_ATTRIBUTE,
} from "./debugClass.js";
import { redactText, type RedactionOptions } from "./redaction.js";

export interface DebugModule {
    log: DebugFunction;
    formatArgs?: unknown;
}

export interface DebugBridgeOptions extends RedactionOptions {
    readonly includedNamespacePrefixes?: readonly string[];
    readonly excludedNamespacePrefixes?: readonly string[];
}

export interface DebugBridge {
    shutdown(): void;
}

interface InstalledBridge {
    readonly hook: "formatArgs" | "log";
    readonly prior: Function;
    readonly wrapped: DebugFunction;
    readonly options: EffectiveDebugBridgeOptions;
    refCount: number;
}

type DebugFunction = (
    this: { namespace?: string },
    ...args: unknown[]
) => unknown;

interface EffectiveDebugBridgeOptions extends RedactionOptions {
    readonly includedNamespacePrefixes: readonly string[];
    readonly excludedNamespacePrefixes: readonly string[];
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
    const effectiveOptions: EffectiveDebugBridgeOptions = {
        includedNamespacePrefixes: options.includedNamespacePrefixes ?? [
            "typeagent:",
        ],
        excludedNamespacePrefixes:
            options.excludedNamespacePrefixes ?? DEFAULT_EXCLUSIONS,
        ...(options.secretFilter === undefined
            ? {}
            : { secretFilter: options.secretFilter }),
    };
    const uniqueModules = [...new Set(debugModules)];
    for (const debugModule of uniqueModules) {
        const existing = installedBridges.get(debugModule);
        if (
            existing !== undefined &&
            !hasEquivalentOptions(existing.options, effectiveOptions)
        ) {
            throw new Error(
                "Cannot install a debug bridge with different options on an already bridged debug module.",
            );
        }
    }

    const installed: DebugModule[] = [];
    for (const debugModule of uniqueModules) {
        const existing = installedBridges.get(debugModule);
        if (existing !== undefined) {
            existing.refCount++;
            installed.push(debugModule);
            continue;
        }

        const formatArgs = debugModule.formatArgs;
        const hook = typeof formatArgs === "function" ? "formatArgs" : "log";
        const prior: Function =
            typeof formatArgs === "function" ? formatArgs : debugModule.log;
        const wrapped: DebugFunction =
            hook === "formatArgs"
                ? function (
                      this: { namespace?: string },
                      ...callArgs: unknown[]
                  ): unknown {
                      const args = callArgs[0];
                      if (!Array.isArray(args)) {
                          return Reflect.apply(prior, this, callArgs);
                      }
                      const rawArgs = [...args];
                      const result = Reflect.apply(prior, this, callArgs);
                      emitDebugRecord(
                          this?.namespace,
                          rawArgs,
                          effectiveOptions,
                      );
                      return result;
                  }
                : function (
                      this: { namespace?: string },
                      ...args: unknown[]
                  ): unknown {
                      const result = Reflect.apply(prior, this, args);
                      emitDebugRecord(this?.namespace, args, effectiveOptions);
                      return result;
                  };
        setDebugHook(debugModule, hook, wrapped);
        installedBridges.set(debugModule, {
            hook,
            prior,
            wrapped,
            options: effectiveOptions,
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
                if (getDebugHook(debugModule, state.hook) === state.wrapped) {
                    setDebugHook(debugModule, state.hook, state.prior);
                }
                installedBridges.delete(debugModule);
            }
        },
    };
}

function getDebugHook(
    debugModule: DebugModule,
    hook: "formatArgs" | "log",
): unknown {
    return hook === "formatArgs" ? debugModule.formatArgs : debugModule.log;
}

function setDebugHook(
    debugModule: DebugModule,
    hook: "formatArgs" | "log",
    value: Function,
): void {
    if (hook === "formatArgs") {
        debugModule.formatArgs = value;
    } else {
        debugModule.log = value as DebugFunction;
    }
}

function emitDebugRecord(
    namespace: string | undefined,
    args: unknown[],
    options: EffectiveDebugBridgeOptions,
): void {
    if (
        emitting ||
        namespace === undefined ||
        !options.includedNamespacePrefixes.some((prefix) =>
            namespace.startsWith(prefix),
        ) ||
        options.excludedNamespacePrefixes.some((prefix) =>
            namespace.startsWith(prefix),
        )
    ) {
        return;
    }
    const activeContext = otelContext.active();
    if (isTracingSuppressed(activeContext)) {
        return;
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
                eventName: "debug",
            })
        ) {
            const cls = classifyDebugNamespace(namespace);
            const rendered = format(...args).replace(ANSI_ESCAPE, "");
            const redacted =
                rendered.length <= MAX_BODY_LENGTH
                    ? redactText(rendered, options)
                    : undefined;
            const body =
                redacted !== undefined && redacted.length <= MAX_BODY_LENGTH
                    ? redacted
                    : "[typeagent debug output truncated]";
            logger.emit({
                context: activeContext,
                severityNumber: SeverityNumber.DEBUG,
                severityText: "DEBUG",
                eventName: "debug",
                body,
                attributes: {
                    [DEBUG_NAMESPACE_ATTRIBUTE]: namespace,
                    [DEBUG_CLASS_ATTRIBUTE]: cls,
                },
            });
        }
    } catch {
        // Bridge failures lose only the OTel copy and never recurse through
        // diagnostics or affect the original debug output.
    } finally {
        emitting = false;
    }
}

function hasEquivalentOptions(
    left: EffectiveDebugBridgeOptions,
    right: EffectiveDebugBridgeOptions,
): boolean {
    return (
        left.secretFilter === right.secretFilter &&
        arraysEqual(
            left.includedNamespacePrefixes,
            right.includedNamespacePrefixes,
        ) &&
        arraysEqual(
            left.excludedNamespacePrefixes,
            right.excludedNamespacePrefixes,
        )
    );
}

function arraysEqual(
    left: readonly string[],
    right: readonly string[],
): boolean {
    return (
        left.length === right.length &&
        left.every((value, index) => value === right[index])
    );
}
