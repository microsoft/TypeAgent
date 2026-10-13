// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ModelRequestConstraints } from "@typeagent/config";
import { RequestAdmissionError, outputReservation } from "./requestBudget.js";

export interface RequestConstraintReceipt {
    metadata: "configured" | "missing";
    tokenAccounting: "utf8-byte-upper-bound";
    inputTokens: number;
    outputTokens: number;
    safetyTokens: number;
}

function tokenUpperBound(text: string): number {
    return Buffer.byteLength(text, "utf8");
}

function validateSafetyTokens(safetyTokens: number): void {
    if (!Number.isSafeInteger(safetyTokens) || safetyTokens < 0)
        throw new RequestAdmissionError(
            "Request safety margin must be a nonnegative integer",
        );
}

function enforceRequestBudget(
    constraints: ModelRequestConstraints,
    inputTokens: number,
    outputTokens: number,
    safetyTokens: number,
): void {
    if (
        (constraints.inputTokens !== undefined &&
            inputTokens > constraints.inputTokens) ||
        (constraints.outputTokens !== undefined &&
            outputTokens > constraints.outputTokens) ||
        (constraints.contextTokens !== undefined &&
            inputTokens + outputTokens + safetyTokens >
                constraints.contextTokens)
    )
        throw new RequestAdmissionError(
            "Serialized inference request exceeds configured provider request constraints",
        );
}

function enforceEmbeddingItemBudget(
    body: object,
    constraints: ModelRequestConstraints,
): void {
    const embeddingItemTokens = constraints.embeddingItemTokens;
    if (!("input" in body) || embeddingItemTokens === undefined) return;
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    for (const input of inputs) {
        if (typeof input !== "string")
            throw new RequestAdmissionError(
                "Configured embedding constraints require string inputs",
            );
        if (tokenUpperBound(input) > embeddingItemTokens)
            throw new RequestAdmissionError(
                "Embedding input exceeds configured provider item constraint",
            );
    }
}

/** Conservatively includes serialized schema/framing without requiring a tokenizer. */
export function checkSerializedRequestConstraints(
    serialized: string,
    constraints?: ModelRequestConstraints,
    safetyTokens = 1000,
): RequestConstraintReceipt {
    validateSafetyTokens(safetyTokens);
    const inputTokens = tokenUpperBound(serialized);
    const body: unknown = JSON.parse(serialized);
    if (!body || typeof body !== "object")
        throw new RequestAdmissionError(
            "Inference request must be a serialized object",
        );
    const chat =
        "messages" in body ||
        "instructions" in body ||
        "max_output_tokens" in body;
    const outputTokens =
        chat &&
        (constraints ||
            "max_completion_tokens" in body ||
            "max_output_tokens" in body ||
            "max_tokens" in body)
            ? outputReservation(body)
            : 0;
    if (constraints) {
        enforceRequestBudget(
            constraints,
            inputTokens,
            outputTokens,
            safetyTokens,
        );
        enforceEmbeddingItemBudget(body, constraints);
    }
    return {
        metadata: constraints ? "configured" : "missing",
        tokenAccounting: "utf8-byte-upper-bound",
        inputTokens,
        outputTokens,
        safetyTokens: chat ? safetyTokens : 0,
    };
}
