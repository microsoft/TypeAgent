// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
    RequestDispatchCapture,
    RequestAttemptOutcome,
    RequestBudgetReceipt,
    CompleteUsageStatsCallback,
} from "@typeagent/aiclient";
import { digest } from "./packets.js";

interface CapturedCall {
    id: string;
    checkpoint: number;
    operation: string;
    at: string;
    requestFile: string;
    requestHash: string;
    reservations: readonly RequestBudgetReceipt[];
    outcome: RequestAttemptOutcome | null;
    usage: Parameters<CompleteUsageStatsCallback>[0] | null;
    result?: { file: string; hash: string };
}

export function createRequestCapture(
    root: string,
    caseId: string,
    limits?: {
        calls: number;
        reservedTokens: number;
        cost: number;
        maxCostPerCall: number;
    },
) {
    const calls: CapturedCall[] = [];
    let checkpoint = 0;
    let sequence = 0;
    let writes = Promise.resolve();
    let reservedTokens = 0;
    if (
        limits &&
        (!Number.isSafeInteger(limits.calls) ||
            limits.calls < 0 ||
            !Number.isSafeInteger(limits.reservedTokens) ||
            limits.reservedTokens < 0 ||
            !Number.isFinite(limits.cost) ||
            limits.cost < 0 ||
            !Number.isFinite(limits.maxCostPerCall) ||
            limits.maxCostPerCall <= 0)
    )
        throw new Error("Invalid campaign capture limits");
    const persist = () => {
        const text =
            JSON.stringify(
                {
                    schemaVersion: 1,
                    contract: "memory-request-capture-v1",
                    caseId,
                    requestEvidenceKind: "admitted-dispatch-body",
                    calls,
                },
                null,
                2,
            ) + "\n";
        writes = writes.then(async () => {
            const temporary = path.join(root, "request-calls.pending.json");
            await writeFile(temporary, text);
            await rename(temporary, path.join(root, "request-calls.json"));
        });
        return writes;
    };
    const find = (id: string) => {
        const call = calls.find((entry) => entry.id === id);
        if (!call) throw new Error("Unknown captured request attempt");
        return call;
    };
    const capture: RequestDispatchCapture = {
        async reserve(event) {
            if (limits) {
                const reservation = event.reservations.at(-1);
                if (!reservation)
                    throw new Error(
                        "Campaign dispatch requires a token reservation",
                    );
                const tokens =
                    reservation.inputTokens +
                    reservation.outputTokens +
                    reservation.safetyTokens;
                if (
                    sequence >= limits.calls ||
                    reservedTokens + tokens > limits.reservedTokens ||
                    (sequence + 1) * limits.maxCostPerCall > limits.cost
                )
                    throw new Error(
                        "Campaign dispatch exceeds approved call/token/cost reservations",
                    );
                reservedTokens += tokens;
            }
            const id = String(++sequence).padStart(6, "0");
            const callCheckpoint = checkpoint;
            const directory = path.join(root, "calls", id);
            await mkdir(directory, { recursive: true });
            await writeFile(
                path.join(directory, "request.json"),
                event.serializedRequest,
                { flag: "wx" },
            );
            const call: CapturedCall = {
                id,
                checkpoint: callCheckpoint,
                operation: event.operation,
                at: event.at,
                requestFile: `calls/${id}/request.json`,
                requestHash: digest(event.serializedRequest),
                reservations: event.reservations,
                outcome: null,
                usage: null,
            };
            if (call.requestHash !== event.requestFingerprint)
                throw new Error(
                    "Captured request hash differs from admitted body",
                );
            calls.push(call);
            await persist();
            return id;
        },
        async finish(id, outcome) {
            const call = find(id);
            if (call.outcome)
                throw new Error("Request attempt already has an outcome");
            call.outcome = outcome;
            await persist();
        },
        async usage(id, usage) {
            const call = find(id);
            if (call.usage)
                throw new Error("Request attempt already has usage");
            call.usage = structuredClone(usage);
            await persist();
        },
        async result(id, result) {
            const call = find(id);
            if (call.result)
                throw new Error(
                    "Request attempt already has a completion result",
                );
            const file = `calls/${id}/result.json`;
            const body = JSON.stringify(result, null, 2) + "\n";
            await writeFile(path.join(root, "calls", id, "result.json"), body, {
                flag: "wx",
            });
            call.result = { file, hash: digest(body) };
            await persist();
        },
    };
    return {
        capture,
        setCheckpoint: (sequence: number) => {
            checkpoint = sequence;
        },
    };
}
