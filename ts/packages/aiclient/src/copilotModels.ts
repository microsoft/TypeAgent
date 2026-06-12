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
import { CopilotApiSettings } from "./copilotSettings.js";
import { TokenCounter } from "./tokenCounter.js";

const debug = registerDebug("typeagent:aiclient:copilot");

let cachedClient: CopilotClient | undefined;
let startPromise: Promise<CopilotClient> | undefined;
let cachedCliPath: string | undefined;
let exitHandlerInstalled = false;

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

async function getClient(cliPathOverride?: string): Promise<CopilotClient> {
    if (cachedClient) return cachedClient;
    if (startPromise) return startPromise;

    const cliPath = cliPathOverride ?? cachedCliPath ?? findCopilotPath();
    cachedCliPath = cliPath;

    startPromise = (async () => {
        debug(`Starting CopilotClient at ${cliPath}`);
        const client = new CopilotClient({ cliPath });
        try {
            await client.start();
        } catch (err) {
            startPromise = undefined;
            throw new Error(
                `Failed to start GitHub Copilot CLI client at '${cliPath}'. ` +
                    `Ensure 'copilot' is installed and authenticated (try 'copilot auth login').\n` +
                    `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
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
    cliPathOverride?: string,
): Promise<CopilotClient> {
    return getClient(cliPathOverride);
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
        systemMessage: { mode: "append", content: "" },
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

        let client: CopilotClient;
        try {
            client = await getClient(settings.cliPath);
        } catch (err) {
            return error(err instanceof Error ? err.message : String(err));
        }

        let session: CopilotSession;
        try {
            session = await client.createSession(
                buildSessionConfig(settings, completionSettings!, false),
            );
        } catch (err) {
            return error(
                `Failed to create Copilot session: ${err instanceof Error ? err.message : String(err)}`,
            );
        }

        try {
            const response: AssistantMessageEvent | undefined =
                await withAbortSignal(
                    session.sendAndWait({ prompt: promptText }),
                    signal,
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
            session.disconnect().catch(() => {});
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

        let client: CopilotClient;
        try {
            client = await getClient(settings.cliPath);
        } catch (err) {
            return error(err instanceof Error ? err.message : String(err));
        }

        let session: CopilotSession;
        try {
            session = await client.createSession(
                buildSessionConfig(settings, completionSettings!, true),
            );
        } catch (err) {
            return error(
                `Failed to create Copilot session: ${err instanceof Error ? err.message : String(err)}`,
            );
        }

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

        const completion = withAbortSignal(
            session.sendAndWait({ prompt: promptText }),
            signal,
        )
            .then((response) => {
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
            await completion.catch(() => {});
            await session.disconnect().catch(() => {});
        }

        return success(iterator);
    }
}
