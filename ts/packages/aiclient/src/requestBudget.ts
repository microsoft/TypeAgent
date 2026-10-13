// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestBudgetLimits {
    contextTokens?: number | undefined;
    inputTokens: number;
    embeddingInputTokens?: number | undefined;
    outputTokens: number;
    safetyTokens: number;
    chatAttempts: number;
    reservedTokens: number;
    embeddingAttempts: number;
    elapsedMs: number;
    tokenizer: string;
    countTokens: (serialized: string) => number;
}

export interface RequestBudgetReceipt {
    attempt: number;
    kind: "chat" | "embedding";
    inputTokens: number;
    outputTokens: number;
    safetyTokens: number;
    contextTokens?: number | undefined;
    tokenAccounting: "estimate";
    serializedChars: number;
    elapsedMs: number;
}

export class RequestAdmissionError extends Error {}

export class RequestBudget {
    public readonly receipts: RequestBudgetReceipt[] = [];
    private readonly started = performance.now();
    private reserved = 0;
    private chats = 0;
    private embeddings = 0;

    public constructor(public readonly limits: RequestBudgetLimits) {
        const { countTokens, tokenizer, ...bounds } = limits;
        if (
            !tokenizer.trim() ||
            typeof countTokens !== "function" ||
            Object.values(bounds).some(
                (value) =>
                    value !== undefined &&
                    (!Number.isSafeInteger(value) || value < 1),
            )
        )
            throw new RequestAdmissionError(
                "A named token estimator and positive request budget limits are required",
            );
    }

    public reserve(serialized: string): void {
        this.commit(this.prepare(serialized));
    }

    public prepare(serialized: string): RequestBudgetReceipt {
        const body: unknown = JSON.parse(serialized);
        if (!body || typeof body !== "object")
            throw new RequestAdmissionError(
                "Budgeted inference requires a serialized JSON object",
            );
        const kind =
            "messages" in body ||
            "instructions" in body ||
            "max_output_tokens" in body
                ? "chat"
                : "input" in body
                  ? "embedding"
                  : undefined;
        if (!kind)
            throw new RequestAdmissionError(
                "Unsupported budgeted inference wire request",
            );
        const elapsedMs = performance.now() - this.started;
        const inputTokens = this.limits.countTokens(serialized);
        const output = kind === "embedding" ? 0 : outputReservation(body);
        if (
            !Number.isSafeInteger(inputTokens) ||
            inputTokens < 0 ||
            elapsedMs > this.limits.elapsedMs ||
            inputTokens >
                (kind === "embedding"
                    ? (this.limits.embeddingInputTokens ??
                      this.limits.inputTokens)
                    : this.limits.inputTokens) ||
            output > this.limits.outputTokens ||
            (kind === "chat" &&
                this.limits.contextTokens !== undefined &&
                inputTokens + output + this.limits.safetyTokens >
                    this.limits.contextTokens)
        )
            throw new RequestAdmissionError(
                "Serialized inference request exceeds configured context, output or elapsed budget",
            );
        if (
            (kind === "chat" && this.chats >= this.limits.chatAttempts) ||
            (kind === "embedding" &&
                this.embeddings >= this.limits.embeddingAttempts) ||
            this.reserved + inputTokens + output > this.limits.reservedTokens
        )
            throw new RequestAdmissionError(
                "Inference attempt or total reserved-token budget exhausted",
            );
        return {
            attempt: this.receipts.length + 1,
            kind,
            inputTokens,
            outputTokens: output,
            safetyTokens: this.limits.safetyTokens,
            contextTokens: this.limits.contextTokens,
            tokenAccounting: "estimate",
            serializedChars: serialized.length,
            elapsedMs,
        };
    }

    public commit(receipt: RequestBudgetReceipt): void {
        this.reserved += receipt.inputTokens + receipt.outputTokens;
        if (receipt.kind === "chat") this.chats++;
        else this.embeddings++;
        this.receipts.push(receipt);
    }
}

export function outputReservation(body: object): number {
    const value =
        "max_completion_tokens" in body
            ? body.max_completion_tokens
            : "max_output_tokens" in body
              ? body.max_output_tokens
              : "max_tokens" in body
                ? body.max_tokens
                : undefined;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
        throw new RequestAdmissionError(
            "Budgeted chat requires an explicit output-token reservation",
        );
    return value;
}

const budgets = new AsyncLocalStorage<readonly RequestBudget[] | undefined>();

export function bindRequestBudgetScope<T>(work: () => T): () => T {
    const active = budgets.getStore();
    return () => budgets.run(active, work);
}

export function runWithRequestBudget<T>(
    budget: RequestBudget,
    work: () => T,
): T {
    return budgets.run([...(budgets.getStore() ?? []), budget], work);
}

export function reserveSerializedRequest(options?: RequestInit): void {
    const active = budgets.getStore();
    if (!active) return;
    if (typeof options?.body !== "string")
        throw new RequestAdmissionError(
            "Unsupported nonserialized request in inference budget scope",
        );
    const serialized = options.body;
    const reservations = active.map((budget) => budget.prepare(serialized));
    active.forEach((budget, index) => budget.commit(reservations[index]));
}
