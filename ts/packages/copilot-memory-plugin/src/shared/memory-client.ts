// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadConfigSync } from "@typeagent/config";
import {
    ConversationMemory,
    ConversationMessage,
    ConversationMessageMeta,
    createConversationMemory,
} from "@typeagent/conversation-memory";
import { withMemoryLock } from "./lock.js";
import { resolveMemoryPaths, type MemoryPaths } from "./workspace.js";
import type { KnowledgePayload } from "./transcript.js";
import type { RecallAnswer } from "./context.js";

type AnswerResponse = {
    type?: string;
    answer?: string;
    whyNoAnswer?: string;
};

type StoreResult<T> = {
    success: boolean;
    message?: string;
    data?: T;
};

export interface MemoryStore {
    readonly messages: { readonly length: number };
    queueAddMessage(
        message: ConversationMessage,
        completionCallback?: (error?: unknown) => void,
        extractKnowledge?: boolean,
        retainKnowledge?: boolean,
    ): void;
    waitForPendingTasks(): Promise<void>;
    addMessage(
        message: ConversationMessage,
        extractKnowledge?: boolean,
        retainKnowledge?: boolean,
    ): Promise<StoreResult<unknown>>;
    getAnswerFromLanguage(question: string): Promise<StoreResult<unknown>>;
}

export type MemoryClient = {
    captureRequest(text: string): Promise<void>;
    captureResult(text: string, knowledge?: KnowledgePayload): Promise<void>;
    remember(memory: string, source?: string): Promise<{ ok: true }>;
    recall(query: string): Promise<RecallAnswer>;
};

function log(message: string): void {
    const safe = message.replace(/https?:\/\/\S+/g, "<endpoint>");
    process.stderr.write(`[typeagent-memory] ${safe}\n`);
}

function readAnswers(data: unknown): AnswerResponse[] {
    if (!Array.isArray(data)) {
        return [];
    }
    return data.flatMap((entry) => {
        if (!Array.isArray(entry)) {
            return [];
        }
        const answer = entry[1];
        if (!answer || typeof answer !== "object") {
            return [];
        }
        return [answer as AnswerResponse];
    });
}

export function toRecallAnswer(result: StoreResult<unknown>): RecallAnswer {
    if (!result.success) {
        return {
            type: "NoAnswer",
            whyNoAnswer: result.message ?? "Memory search failed.",
        };
    }
    const answers = readAnswers(result.data);
    const answered = answers.filter(
        (answer) => answer.type === "Answered" && answer.answer,
    );
    if (answered.length > 0) {
        return {
            type: "Answered",
            answer: answered.map((answer) => answer.answer).join("\n"),
        };
    }
    const reasons = answers
        .map((answer) => answer.whyNoAnswer)
        .filter((reason): reason is string => Boolean(reason));
    return {
        type: "NoAnswer",
        whyNoAnswer: reasons.join("\n") || "No answer in this conversation.",
    };
}

function userMessage(text: string, source?: string): ConversationMessage {
    return new ConversationMessage(
        text,
        new ConversationMessageMeta(source ?? "user", ["assistant"]),
    );
}

function assistantMessage(
    text: string,
    knowledge?: KnowledgePayload,
): ConversationMessage {
    const metadata = new ConversationMessageMeta("assistant", ["user"]);
    if (!knowledge) {
        return new ConversationMessage(text, metadata);
    }
    return new ConversationMessage(
        text,
        metadata,
        undefined,
        knowledge as never,
    );
}

async function queueMessage(
    store: MemoryStore,
    message: ConversationMessage,
    extractKnowledge: boolean,
): Promise<string | undefined> {
    let failure: string | undefined;
    store.queueAddMessage(
        message,
        (error) => {
            if (error !== undefined) {
                failure =
                    error instanceof Error ? error.message : String(error);
            }
        },
        extractKnowledge,
        false,
    );
    await store.waitForPendingTasks();
    return failure;
}

/**
 * Implicit capture uses `queueAddMessage`, matching the dispatcher. If
 * knowledge extraction fails, the turn text is still stored so a later
 * recall can search it. The retry is only safe when the first call failed
 * before appending: addMessage appends the message before indexing and
 * autosave, so retrying after those steps would persist a duplicate.
 */
export async function captureQueued(
    store: MemoryStore,
    message: ConversationMessage,
): Promise<void> {
    const before = store.messages.length;
    const failure = await queueMessage(store, message, true);
    if (!failure) {
        return;
    }
    if (store.messages.length > before) {
        throw new Error(failure);
    }
    log(`Knowledge extraction failed (${failure}); storing turn text only.`);
    const retry = await queueMessage(store, message, false);
    if (retry) {
        throw new Error(retry);
    }
}

export async function captureDirect(
    store: MemoryStore,
    message: ConversationMessage,
): Promise<void> {
    const before = store.messages.length;
    const extracted = await store.addMessage(message, true, false);
    if (extracted.success) {
        return;
    }
    if (store.messages.length > before) {
        // The append already happened, so the failure was indexing or
        // autosave. Retrying would write a second copy of the message.
        throw new Error(extracted.message ?? "Failed to store memory.");
    }
    log(
        `Knowledge extraction failed (${extracted.message ?? "unknown"}); storing fact text only.`,
    );
    const stored = await store.addMessage(message, false, false);
    if (!stored.success) {
        throw new Error(stored.message ?? "Failed to store memory.");
    }
}

export function createMemoryClient(store: MemoryStore): MemoryClient {
    return {
        captureRequest(text) {
            return captureQueued(store, userMessage(text));
        },
        captureResult(text, knowledge) {
            return captureQueued(store, assistantMessage(text, knowledge));
        },
        async remember(memory, source) {
            await captureDirect(store, userMessage(memory, source ?? "chat"));
            return { ok: true };
        },
        async recall(query) {
            return toRecallAnswer(await store.getAnswerFromLanguage(query));
        },
    };
}

const PROVIDER_ENV_VARS = [
    "TYPEAGENT_MODEL_PROVIDER",
    "TYPEAGENT_EMBEDDING_PROVIDER",
] as const;

function ensureModelConfig(): void {
    // Copilot does not load TypeAgent config, so load it before anything
    // reads provider or endpoint settings. Config values only fill env vars
    // that are unset, so this must run first for user providers to win.
    loadConfigSync();
    if (!process.env.COPILOT_PLUGIN_ROOT && !process.env.PLUGIN_ROOT) {
        return;
    }
    // A copilot provider inside a Copilot hook launches another Copilot
    // process and deadlocks the hook. Reject it so resolution falls through
    // to a configured non-Copilot provider or a clear missing-settings
    // error. Other configured providers (openai, ollama, azure) are kept.
    for (const key of PROVIDER_ENV_VARS) {
        if (process.env[key]?.trim().toLowerCase() === "copilot") {
            delete process.env[key];
        }
    }
}

async function openStore(paths: MemoryPaths): Promise<ConversationMemory> {
    ensureModelConfig();
    return createConversationMemory(
        {
            dirPath: paths.dirPath,
            baseFileName: paths.baseFileName,
        },
        false,
    );
}

export async function withWorkspaceMemory<T>(
    cwd: string,
    fn: (client: MemoryClient) => Promise<T>,
): Promise<T> {
    const paths = resolveMemoryPaths(cwd);
    return withMemoryLock(paths.dirPath, async () => {
        const store = await openStore(paths);
        try {
            return await fn(createMemoryClient(store));
        } finally {
            await store.waitForPendingTasks();
        }
    });
}
