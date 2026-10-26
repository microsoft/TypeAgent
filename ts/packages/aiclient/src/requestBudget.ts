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
    inputReservedTokens?: number | undefined;
    embeddingAttempts: number;
    elapsedMs: number;
    tokenizer: string;
    countTokens: (serialized: string) => number;
}

export interface RequestBudgetReceipt {
    attempt: number;
    kind: "chat" | "embedding" | "decision";
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
    private reservedInput = 0;
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

    public reserve(serialized: string, providerOutputTokens?: number): void {
        this.commit(this.prepare(serialized, providerOutputTokens));
    }

    public prepare(
        serialized: string,
        defaultOutputTokens?: number,
    ): RequestBudgetReceipt {
        const body: unknown = JSON.parse(serialized);
        if (!body || typeof body !== "object")
            throw new RequestAdmissionError(
                "Budgeted inference requires a serialized JSON object",
            );
        const kind = requestKind(body);
        if (!kind)
            throw new RequestAdmissionError(
                "Unsupported budgeted inference wire request",
            );
        const elapsedMs = performance.now() - this.started;
        const inputTokens = this.limits.countTokens(serialized);
        const output = requestOutputReservation(
            body,
            kind,
            defaultOutputTokens,
        );
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
            (kind !== "embedding" &&
                this.limits.contextTokens !== undefined &&
                inputTokens + output + this.limits.safetyTokens >
                    this.limits.contextTokens)
        )
            throw new RequestAdmissionError(
                "Serialized inference request exceeds configured context, output or elapsed budget",
            );
        if (
            (kind !== "embedding" && this.chats >= this.limits.chatAttempts) ||
            (kind === "embedding" &&
                this.embeddings >= this.limits.embeddingAttempts) ||
            this.reserved + inputTokens + output > this.limits.reservedTokens ||
            (this.limits.inputReservedTokens !== undefined &&
                this.reservedInput + inputTokens >
                    this.limits.inputReservedTokens)
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
        this.reservedInput += receipt.inputTokens;
        if (receipt.kind !== "embedding") this.chats++;
        else this.embeddings++;
        this.receipts.push(receipt);
    }
}

/** Conservative fixed-shape output reservation for native decision answers. */
export function decisionOutputReservation(body: object): number {
    const questions = "questions" in body ? body.questions : undefined;
    if (!questions || typeof questions !== "object")
        throw new RequestAdmissionError("Decision questions are required");
    const entries = Array.isArray(questions)
        ? questions.map((question) => [question.name, question])
        : Object.entries(questions);
    let bound = 64;
    for (const [name, question] of entries) {
        if (!question || typeof question !== "object")
            throw new RequestAdmissionError("Invalid decision question");
        const labels = decisionLabels(question);
        bound += 128 + Buffer.byteLength(JSON.stringify(name), "utf8") * 2;
        for (const label of labels)
            bound += 64 + Buffer.byteLength(JSON.stringify(label), "utf8") * 2;
    }
    return bound;
}

function decisionLabels(question: Record<string, unknown>): string[] {
    if (question.type === "score")
        return decisionArray(question.criteria ?? question.levels ?? []).map(
            (_: unknown, index: number) => String(index),
        );
    if (question.type === "choice")
        return question.choices
            ? decisionArray(question.choices).map((entry: unknown) => {
                  if (
                      !entry ||
                      typeof entry !== "object" ||
                      !("value" in entry) ||
                      typeof entry.value !== "string"
                  )
                      throw new RequestAdmissionError(
                          "Invalid decision choice",
                      );
                  return entry.value;
              })
            : Object.keys(question.criteria ?? {});
    return [];
}

function decisionArray(value: unknown): unknown[] {
    if (!Array.isArray(value))
        throw new RequestAdmissionError("Invalid decision criteria");
    return value;
}

function requestKind(body: object): RequestBudgetReceipt["kind"] | undefined {
    if (isChatWireRequest(body)) return "chat";
    if ("questions" in body) return "decision";
    return "input" in body ? "embedding" : undefined;
}

function requestOutputReservation(
    body: object,
    kind: RequestBudgetReceipt["kind"],
    defaultOutputTokens?: number,
): number {
    if (kind === "embedding") return 0;
    return kind === "decision"
        ? decisionOutputReservation(body)
        : outputReservation(body, defaultOutputTokens);
}

export function outputReservation(
    body: object,
    defaultOutputTokens?: number,
): number {
    const value = "max_tokens" in body ? body.max_tokens : defaultOutputTokens;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
        throw new RequestAdmissionError(
            "Budgeted chat requires an explicit output-token reservation or configured provider output capacity",
        );
    return value;
}

export function isChatWireRequest(body: object): boolean {
    return (
        "messages" in body ||
        "instructions" in body ||
        ("input" in body &&
            Array.isArray(body.input) &&
            body.input.some(
                (item: unknown) =>
                    item !== null && typeof item === "object" && "role" in item,
            ))
    );
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

export function reserveSerializedRequest(
    options?: RequestInit,
    defaultOutputTokens?: number,
): void {
    const active = budgets.getStore();
    if (!active) return;
    if (typeof options?.body !== "string")
        throw new RequestAdmissionError(
            "Unsupported nonserialized request in inference budget scope",
        );
    const serialized = options.body;
    const reservations = active.map((budget) =>
        budget.prepare(serialized, defaultOutputTokens),
    );
    active.forEach((budget, index) => budget.commit(reservations[index]));
}
