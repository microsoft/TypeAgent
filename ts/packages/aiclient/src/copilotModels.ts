// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CopilotClient,
    approveAll,
    type SessionConfig,
    type CopilotSession,
    type AssistantMessageEvent,
} from "@github/copilot-sdk";
import {
    PromptSection,
    Result,
    success,
    error,
    ImagePromptContent,
    MultimodalPromptContent,
} from "typechat";
import { execSync } from "node:child_process";
import registerDebug from "debug";
import {
    ChatModelWithStreaming,
    CompletionSettings,
    CompletionJsonSchema,
    CompleteUsageStatsCallback,
} from "./models.js";
import { CompletionUsageStats } from "./openai.js";
import {
    CopilotApiSettings,
    copilotApiSettingsFromConfig,
} from "./copilotSettings.js";
import { TokenCounter } from "./tokenCounter.js";

const debug = registerDebug("typeagent:aiclient:copilot");
// Per-phase latency breakdown (client start / session create / send / total)
// and real model time vs. SDK/session overhead. Enable with
// DEBUG=typeagent:aiclient:copilot:timing.
const debugTiming = registerDebug("typeagent:aiclient:copilot:timing");
// The final, transformed prompt the CLI actually sends to the model (shows
// any XML wrapping / augmentation bloat added on top of our prompt). Enable
// with DEBUG=typeagent:aiclient:copilot:prompt.
const debugPrompt = registerDebug("typeagent:aiclient:copilot:prompt");

type CopilotSdkLogLevel =
    | "none"
    | "error"
    | "warning"
    | "info"
    | "debug"
    | "all";

// Optional passthrough to the SDK's own stderr timing logs. Set
// TYPEAGENT_COPILOT_SDK_LOG_LEVEL=debug (or all) to surface CLI-side timing.
function sdkLogLevel(): CopilotSdkLogLevel | undefined {
    const v = process.env.TYPEAGENT_COPILOT_SDK_LOG_LEVEL?.trim().toLowerCase();
    const valid = ["none", "error", "warning", "info", "debug", "all"];
    return v && valid.includes(v) ? (v as CopilotSdkLogLevel) : undefined;
}

// Subscribe to the SDK's usage / final-prompt events so we can attribute the
// wall-clock time of a request to model latency vs. our own session overhead.
// Listeners are only attached when a diagnostic namespace is enabled, so this
// is a no-op on the hot path in production.
function attachDiagnostics(session: CopilotSession): {
    getApiDurationMs: () => number | undefined;
    dispose: () => void;
} {
    let apiDurationMs: number | undefined;
    if (!debugTiming.enabled && !debugPrompt.enabled) {
        return { getApiDurationMs: () => undefined, dispose: () => {} };
    }
    const offUsage = session.on("assistant.usage", (event: any) => {
        const d = event?.data;
        apiDurationMs = d?.duration;
        debugTiming(
            `assistant.usage model=${d?.model} api=${d?.duration}ms ` +
                `in=${d?.inputTokens} out=${d?.outputTokens} ` +
                `cacheRead=${d?.cacheReadTokens} providerCallId=${d?.providerCallId}`,
        );
    });
    const offUser = session.on("user.message", (event: any) => {
        if (!debugPrompt.enabled) return;
        const tc = event?.data?.transformedContent;
        if (typeof tc === "string") {
            debugPrompt(
                `final transformedContent (${tc.length} chars):\n${tc}`,
            );
        }
    });
    return {
        getApiDurationMs: () => apiDurationMs,
        dispose: () => {
            offUsage();
            offUser();
        },
    };
}

// Replaces the Copilot CLI's default "terminal coding assistant" system
// prompt. In "append" mode the runtime still ships its full base persona
// (identity, environment context, code-change rules, tool guidelines) ahead
// of the caller's content; "replace" returns only this string, so the model
// is framed as a translation backend driven entirely by the user turn (which
// already carries TypeChat's schema and instructions).
const TRANSLATION_SYSTEM_PROMPT =
    "You are a translation engine. Follow the instructions in the user message exactly and respond only with the requested output. Do not add commentary, explanations, or formatting beyond what is asked.";

let cachedClient: CopilotClient | undefined;
let startPromise: Promise<CopilotClient> | undefined;
let cachedCliPath: string | undefined;
let cachedCliUrl: string | undefined;
let exitHandlerInstalled = false;

export interface CopilotClientOptions {
    /** Path to the copilot CLI binary. Ignored when `cliUrl` is set. */
    cliPath?: string | undefined;
    /**
     * URL of an already-running Copilot CLI server ("host:port"). When set,
     * the SDK connects over TCP instead of spawning a CLI child, avoiding
     * process startup latency. Mutually exclusive with `cliPath`.
     */
    cliUrl?: string | undefined;
}

function findCopilotPath(): string {
    try {
        const isWindows = process.platform === "win32";
        const command = isWindows ? "where copilot" : "which copilot";
        const result = execSync(command, { encoding: "utf8" }).trim();
        const first = result.split("\n")[0].trim();
        debug(`Found copilot CLI at: ${first}`);
        return first;
    } catch {
        debug("Could not find copilot CLI in PATH, falling back to 'copilot'");
        return "copilot";
    }
}

async function getClient(
    options?: CopilotClientOptions,
): Promise<CopilotClient> {
    if (cachedClient) return cachedClient;
    if (startPromise) return startPromise;

    const cliUrl = options?.cliUrl ?? cachedCliUrl;
    cachedCliUrl = cliUrl;
    // When connecting to an external CLI server, cliPath is ignored (the two
    // are mutually exclusive in the SDK).
    const cliPath = cliUrl
        ? undefined
        : (options?.cliPath ?? cachedCliPath ?? findCopilotPath());
    cachedCliPath = cliPath;

    startPromise = (async () => {
        const target = cliUrl ? `server ${cliUrl}` : `CLI ${cliPath}`;
        debug(`Starting CopilotClient (${target})`);
        const tStart = Date.now();
        const level = sdkLogLevel();
        const client = new CopilotClient({
            ...(cliUrl ? { cliUrl } : { cliPath: cliPath! }),
            ...(level ? { logLevel: level } : {}),
        });
        try {
            await client.start();
        } catch (err) {
            startPromise = undefined;
            throw new Error(
                `Failed to start GitHub Copilot CLI client (${target}). ` +
                    (cliUrl
                        ? `Ensure a Copilot CLI server is running and reachable at '${cliUrl}'.\n`
                        : `Ensure 'copilot' is installed and authenticated (try 'copilot auth login').\n`) +
                    `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
        debugTiming(`client.start ${Date.now() - tStart}ms`);
        cachedClient = client;
        if (!exitHandlerInstalled) {
            exitHandlerInstalled = true;
            process.on("exit", () => {
                cachedClient?.stop().catch(() => {});
            });
        }
        return client;
    })();
    return startPromise;
}

/**
 * Public accessor for callers that want to talk to the Copilot CLI
 * directly (auth status, model listing, reasoning loop). Shares the
 * same process-wide singleton used by the chat adapter so we don't
 * spawn two CLI children.
 */
export async function getCopilotClient(
    options?: CopilotClientOptions | string,
): Promise<CopilotClient> {
    return getClient(
        typeof options === "string" ? { cliPath: options } : options,
    );
}

/**
 * Eagerly start (or connect to) the Copilot CLI so the first user-visible
 * request doesn't pay the one-time spawn/startup cost (measured at several
 * seconds cold). Safe to call multiple times — it reuses the singleton and
 * swallows errors (a failed pre-warm just means the first real request will
 * retry and surface the error normally).
 */
export async function warmupCopilotClient(
    options?: CopilotClientOptions,
    sessionConfig?: SessionConfig,
): Promise<void> {
    let client: CopilotClient;
    try {
        client = await getClient(options);
        debug("Copilot client pre-warmed");
    } catch (err) {
        debug(
            `Copilot client pre-warm failed (will retry on first request): ${
                err instanceof Error ? err.message : String(err)
            }`,
        );
        return;
    }
    // Warm the CLI-side session subsystem with a throwaway session so the
    // first real request doesn't pay the cold createSession cost (~1s+ on the
    // first session of a process). Best-effort: session creation is auth-free
    // (only sendAndWait needs auth), so this succeeds even when unauthenticated
    // or pointed at an external server.
    if (sessionConfig) {
        try {
            const t = Date.now();
            const session = await client.createSession(sessionConfig);
            await session.disconnect().catch(() => {});
            debugTiming(`warm session ${Date.now() - t}ms`);
            debug("Copilot session subsystem pre-warmed");
        } catch (err) {
            debug(
                `Copilot session pre-warm skipped: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
        }
    }
}

/**
 * Pre-warm the Copilot client and session subsystem using the values from the
 * active runtime config. Called at host startup (from runtimeConfig) when the
 * provider is Copilot so the first user request avoids both the CLI spawn and
 * the cold session-creation cost.
 */
export async function warmupCopilotFromConfig(): Promise<void> {
    const settings = copilotApiSettingsFromConfig();
    await warmupCopilotClient(
        { cliPath: settings.cliPath, cliUrl: settings.cliUrl },
        buildSessionConfig(settings, {}, false),
    );
}

function withAbortSignal<T>(
    promise: Promise<T>,
    signal: AbortSignal | undefined,
): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(
            (value) => {
                signal.removeEventListener("abort", onAbort);
                resolve(value);
            },
            (err) => {
                signal.removeEventListener("abort", onAbort);
                reject(err);
            },
        );
    });
}

function rejectImageContent(messages: PromptSection[]): void {
    const isImage = (c: MultimodalPromptContent) =>
        (c as ImagePromptContent).type === "image_url";
    for (const ps of messages) {
        if (Array.isArray(ps.content) && ps.content.some(isImage)) {
            throw new Error(
                "Image content is not supported by the Copilot chat adapter",
            );
        }
    }
}

function renderPrompt(prompt: string | PromptSection[]): string {
    if (typeof prompt === "string") return prompt;
    const sections = prompt;
    rejectImageContent(sections);
    const parts: string[] = [];
    for (const section of sections) {
        const content =
            typeof section.content === "string"
                ? section.content
                : section.content
                      .map((c) =>
                          typeof c === "string"
                              ? c
                              : "text" in c && typeof c.text === "string"
                                ? c.text
                                : "",
                      )
                      .join("");
        const role = section.role ?? "user";
        parts.push(`[${role}]\n${content}`);
    }
    return parts.join("\n\n");
}

function buildSessionConfig(
    settings: CopilotApiSettings,
    completionSettings: CompletionSettings,
    streaming: boolean,
): SessionConfig {
    const reasoningEffort =
        (completionSettings.reasoning_effort as
            | "low"
            | "medium"
            | "high"
            | undefined) ?? settings.reasoningEffort;
    const config: SessionConfig = {
        clientName: "TypeAgent",
        model: settings.modelName,
        streaming,
        tools: [],
        availableTools: [],
        systemMessage: { mode: "replace", content: TRANSLATION_SYSTEM_PROMPT },
        onPermissionRequest: approveAll,
        ...(settings.disableInfiniteSessions
            ? { infiniteSessions: { enabled: false } }
            : {}),
        ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    };
    return config;
}

function estimateTokens(text: string): number {
    // Coarse char-based estimate so TokenCounter still has something to
    // report when the SDK doesn't surface real usage. ~4 chars/token.
    return Math.max(0, Math.ceil(text.length / 4));
}

export function createCopilotChatModel(
    settings: CopilotApiSettings,
    completionSettings?: CompletionSettings,
    completionCallback?: (request: any, response: any) => void,
    tags?: string[],
): ChatModelWithStreaming {
    completionSettings ??= {};
    completionSettings.n ??= 1;

    const model: ChatModelWithStreaming = {
        completionSettings,
        completionCallback,
        complete,
        completeStream,
    };
    return model;

    function reportUsage(
        promptText: string,
        responseText: string,
        usageCallback?: CompleteUsageStatsCallback,
    ) {
        const prompt_tokens = estimateTokens(promptText);
        const completion_tokens = estimateTokens(responseText);
        const usage: CompletionUsageStats = {
            prompt_tokens,
            completion_tokens,
            total_tokens: prompt_tokens + completion_tokens,
        };
        try {
            TokenCounter.getInstance().add(usage, tags);
            usageCallback?.(usage);
        } catch {}
    }

    async function complete(
        prompt: string | PromptSection[],
        usageCallback?: CompleteUsageStatsCallback,
        _jsonSchema?: CompletionJsonSchema,
        logFn?: (msg: any) => void,
        signal?: AbortSignal,
    ): Promise<Result<string>> {
        const messages: PromptSection[] =
            typeof prompt === "string"
                ? [{ role: "user", content: prompt }]
                : prompt;
        const promptText = renderPrompt(messages);
        if (debugPrompt.enabled) {
            debugPrompt(
                `prompt to Copilot: ${promptText.length} chars ` +
                    `(~${estimateTokens(promptText)} tokens), model=${settings.modelName}`,
            );
        }

        const tTotal = Date.now();
        let client: CopilotClient;
        const tClient = Date.now();
        try {
            client = await getClient({
                cliPath: settings.cliPath,
                cliUrl: settings.cliUrl,
            });
        } catch (err) {
            return error(err instanceof Error ? err.message : String(err));
        }
        debugTiming(`getClient ${Date.now() - tClient}ms`);

        let session: CopilotSession;
        const tCreate = Date.now();
        try {
            session = await client.createSession(
                buildSessionConfig(settings, completionSettings!, false),
            );
        } catch (err) {
            return error(
                `Failed to create Copilot session: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
        debugTiming(`createSession ${Date.now() - tCreate}ms`);

        const diag = attachDiagnostics(session);
        try {
            const tSend = Date.now();
            const response: AssistantMessageEvent | undefined =
                await withAbortSignal(
                    session.sendAndWait({ prompt: promptText }),
                    signal,
                );
            const sendMs = Date.now() - tSend;
            const apiMs = diag.getApiDurationMs();
            debugTiming(
                `sendAndWait ${sendMs}ms ` +
                    `(model≈${apiMs ?? "?"}ms, ` +
                    `sdk/session overhead≈${apiMs !== undefined ? sendMs - apiMs : "?"}ms)`,
            );
            const text = response?.data?.content ?? "";
            if (model.completionCallback) {
                model.completionCallback(
                    { prompt: promptText, model: settings.modelName },
                    response,
                );
            }
            try {
                if (settings.enableModelRequestLogging && logFn) {
                    logFn({
                        prompt: messages,
                        response: text,
                        tags,
                    });
                }
            } catch {}
            reportUsage(promptText, text, usageCallback);
            return success(text);
        } catch (err) {
            return error(err instanceof Error ? err.message : String(err));
        } finally {
            diag.dispose();
            session.disconnect().catch(() => {});
            debugTiming(`complete total ${Date.now() - tTotal}ms`);
        }
    }

    async function completeStream(
        prompt: string | PromptSection[],
        usageCallback?: CompleteUsageStatsCallback,
        _jsonSchema?: CompletionJsonSchema,
        logFn?: (msg: any) => void,
        signal?: AbortSignal,
    ): Promise<Result<AsyncIterableIterator<string>>> {
        const messages: PromptSection[] =
            typeof prompt === "string"
                ? [{ role: "user", content: prompt }]
                : prompt;
        const promptText = renderPrompt(messages);
        if (debugPrompt.enabled) {
            debugPrompt(
                `stream prompt to Copilot: ${promptText.length} chars ` +
                    `(~${estimateTokens(promptText)} tokens), model=${settings.modelName}`,
            );
        }

        const tTotal = Date.now();
        let client: CopilotClient;
        const tClient = Date.now();
        try {
            client = await getClient({
                cliPath: settings.cliPath,
                cliUrl: settings.cliUrl,
            });
        } catch (err) {
            return error(err instanceof Error ? err.message : String(err));
        }
        debugTiming(`getClient ${Date.now() - tClient}ms`);

        let session: CopilotSession;
        const tCreate = Date.now();
        try {
            session = await client.createSession(
                buildSessionConfig(settings, completionSettings!, true),
            );
        } catch (err) {
            return error(
                `Failed to create Copilot session: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
        debugTiming(`createSession ${Date.now() - tCreate}ms`);

        const diag = attachDiagnostics(session);
        // Buffer streaming deltas; the consumer pulls from a queue.
        const queue: Array<{ value?: string; done?: boolean; err?: Error }> =
            [];
        let resolveNext: (() => void) | undefined;
        let collected = "";

        const wake = () => {
            if (resolveNext) {
                const r = resolveNext;
                resolveNext = undefined;
                r();
            }
        };

        const unsubscribeDelta = session.on(
            "assistant.message_delta",
            (event: any) => {
                const delta = event?.data?.deltaContent;
                if (typeof delta === "string" && delta.length > 0) {
                    collected += delta;
                    queue.push({ value: delta });
                    wake();
                }
            },
        );
        const unsubscribeMessage = session.on(
            "assistant.message",
            (event: any) => {
                // When the SDK doesn't emit deltas (e.g. streaming
                // disabled), surface the final content as one chunk.
                if (collected.length === 0) {
                    const content = event?.data?.content;
                    if (typeof content === "string" && content.length > 0) {
                        collected = content;
                        queue.push({ value: content });
                    }
                }
            },
        );

        const tSend = Date.now();
        const completion = withAbortSignal(
            session.sendAndWait({ prompt: promptText }),
            signal,
        )
            .then((response) => {
                const sendMs = Date.now() - tSend;
                const apiMs = diag.getApiDurationMs();
                debugTiming(
                    `sendAndWait(stream) ${sendMs}ms ` +
                        `(model≈${apiMs ?? "?"}ms, ` +
                        `sdk/session overhead≈${apiMs !== undefined ? sendMs - apiMs : "?"}ms)`,
                );
                if (model.completionCallback) {
                    model.completionCallback(
                        { prompt: promptText, model: settings.modelName },
                        response,
                    );
                }
                try {
                    if (settings.enableModelRequestLogging && logFn) {
                        logFn({
                            prompt: messages,
                            response: collected,
                            tags,
                        });
                    }
                } catch {}
                reportUsage(promptText, collected, usageCallback);
                queue.push({ done: true });
                wake();
            })
            .catch((err: unknown) => {
                queue.push({
                    err: err instanceof Error ? err : new Error(String(err)),
                });
                wake();
            });

        const iterator: AsyncIterableIterator<string> = {
            [Symbol.asyncIterator]() {
                return this;
            },
            async next(): Promise<IteratorResult<string>> {
                while (true) {
                    if (queue.length > 0) {
                        const item = queue.shift()!;
                        if (item.err) {
                            await cleanup();
                            throw item.err;
                        }
                        if (item.done) {
                            await cleanup();
                            return { value: undefined, done: true };
                        }
                        return { value: item.value!, done: false };
                    }
                    await new Promise<void>((resolve) => {
                        resolveNext = resolve;
                    });
                }
            },
            async return(): Promise<IteratorResult<string>> {
                await cleanup();
                return { value: undefined, done: true };
            },
        };

        let cleaned = false;
        async function cleanup() {
            if (cleaned) return;
            cleaned = true;
            unsubscribeDelta();
            unsubscribeMessage();
            diag.dispose();
            await completion.catch(() => {});
            await session.disconnect().catch(() => {});
            debugTiming(`completeStream total ${Date.now() - tTotal}ms`);
        }

        return success(iterator);
    }
}
