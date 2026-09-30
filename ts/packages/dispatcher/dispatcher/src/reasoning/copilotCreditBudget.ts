// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import { randomUUID } from "node:crypto";
import {
    CopilotRequestHandler,
    type CopilotRequestContext,
    type CopilotWebSocketHandler,
} from "@github/copilot-sdk";

export interface CreditReservation {
    id: string;
    sessionId?: string;
    maximumNanoAiu: number;
    settledNanoAiu?: number;
    responseContentType?: string;
}

export interface CopilotCreditLedger {
    version: 1;
    capNanoAiu: number;
    openingNanoAiu: number;
    headroomNanoAiu: number;
    model: string;
    requestMaximumNanoAiu: number;
    reservations: CreditReservation[];
    blockedReason?: string;
}

function requireAmount(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`Invalid credit ledger ${name}`);
    }
}

export function validateCreditLedger(ledger: CopilotCreditLedger): void {
    if (
        ledger.version !== 1 ||
        typeof ledger.model !== "string" ||
        ledger.model.length === 0 ||
        !Array.isArray(ledger.reservations)
    ) {
        throw new Error("Invalid credit ledger structure");
    }
    for (const name of [
        "capNanoAiu",
        "openingNanoAiu",
        "headroomNanoAiu",
        "requestMaximumNanoAiu",
    ] as const) {
        requireAmount(ledger[name], name);
    }
    if (ledger.capNanoAiu > 50_000_000_000_000) {
        throw new Error("Credit ledger exceeds the 50,000-credit ceiling");
    }
    if (ledger.requestMaximumNanoAiu === 0) {
        throw new Error("A positive request reservation is required");
    }
    const ids = new Set<string>();
    for (const entry of ledger.reservations) {
        if (typeof entry.id !== "string" || ids.has(entry.id)) {
            throw new Error("Invalid or duplicate credit reservation id");
        }
        ids.add(entry.id);
        requireAmount(entry.maximumNanoAiu, "reservation maximum");
        if (entry.settledNanoAiu !== undefined) {
            requireAmount(entry.settledNanoAiu, "settled usage");
            if (entry.settledNanoAiu > entry.maximumNanoAiu) {
                throw new Error("Observed usage exceeded the reserved bound");
            }
        }
    }
}

export function accountedNanoAiu(ledger: CopilotCreditLedger): number {
    validateCreditLedger(ledger);
    const total = ledger.reservations.reduce(
        (sum, entry) => sum + (entry.settledNanoAiu ?? entry.maximumNanoAiu),
        ledger.openingNanoAiu + ledger.headroomNanoAiu,
    );
    requireAmount(total, "accounted total");
    return total;
}

export function reserveCredits(
    ledger: CopilotCreditLedger,
    id: string,
    sessionId?: string,
): void {
    if (ledger.blockedReason) {
        throw new Error(
            `Copilot credit accounting blocked: ${ledger.blockedReason}`,
        );
    }
    if (
        ledger.reservations.length >= 2_000 ||
        (sessionId !== undefined &&
            ledger.reservations.filter((entry) => entry.sessionId === sessionId)
                .length >= 24)
    ) {
        throw new Error(
            "Copilot credit request-count limit reached; request not sent",
        );
    }
    const total = accountedNanoAiu(ledger) + ledger.requestMaximumNanoAiu;
    if (!Number.isSafeInteger(total) || total > ledger.capNanoAiu) {
        throw new Error("Copilot credit budget exhausted; request not sent");
    }
    if (ledger.reservations.some((entry) => entry.id === id)) {
        throw new Error("Credit reservation already exists");
    }
    ledger.reservations.push({
        id,
        ...(sessionId === undefined ? {} : { sessionId }),
        maximumNanoAiu: ledger.requestMaximumNanoAiu,
    });
}

function updateLedger(
    file: string,
    update: (ledger: CopilotCreditLedger) => void,
): void {
    // Exclusive creation makes concurrent workers fail closed rather than
    // admitting against the same balance. A stale lock requires reconciliation.
    const lock = `${file}.lock`;
    const lockFd = fs.openSync(lock, "wx");
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        const ledger: CopilotCreditLedger = JSON.parse(
            fs.readFileSync(file, "utf8"),
        );
        validateCreditLedger(ledger);
        update(ledger);
        validateCreditLedger(ledger);
        const fd = fs.openSync(temporary, "wx");
        try {
            fs.writeFileSync(fd, JSON.stringify(ledger, null, 2) + "\n");
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        fs.renameSync(temporary, file);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        fs.closeSync(lockFd);
        fs.unlinkSync(lock);
    }
}

export function extractNanoAiu(value: unknown): number | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const object = value as Record<string, unknown>;
    const usage = object.copilot_usage ?? object.copilotUsage;
    if (typeof usage === "object" && usage !== null) {
        const fields = usage as Record<string, unknown>;
        const amount = fields.total_nano_aiu ?? fields.totalNanoAiu;
        if (typeof amount === "number") {
            requireAmount(amount, "response usage");
            return amount;
        }
    }
    return (
        (object.response === undefined
            ? undefined
            : extractNanoAiu(object.response)) ??
        (object.usage === undefined ? undefined : extractNanoAiu(object.usage))
    );
}

function settleCredits(file: string, id: string, amount: number): void {
    let exceeded = false;
    updateLedger(file, (ledger) => {
        const entry = ledger.reservations.find((entry) => entry.id === id);
        if (!entry) throw new Error("Missing credit reservation");
        if (amount > entry.maximumNanoAiu) {
            ledger.blockedReason = `Observed usage ${amount} exceeded reserved bound ${entry.maximumNanoAiu}`;
            entry.maximumNanoAiu = amount;
            exceeded = true;
        }
        entry.settledNanoAiu = amount;
    });
    if (exceeded)
        throw new Error(
            "Observed usage exceeded the reserved bound; accounting blocked",
        );
}

export class CopilotCreditBudget extends CopilotRequestHandler {
    constructor(
        private readonly ledgerPath: string,
        private readonly sessionScope?: string,
    ) {
        super();
    }

    protected override async openWebSocket(
        _context: CopilotRequestContext,
    ): Promise<CopilotWebSocketHandler> {
        throw new Error(
            "Credit-controlled sessions require capi.enableWebSocketResponses=false",
        );
    }

    protected override async sendRequest(
        request: Request,
        context: CopilotRequestContext,
    ): Promise<Response> {
        const body: unknown = await request.clone().json();
        if (typeof body !== "object" || body === null || !("model" in body)) {
            throw new Error("Credit-controlled request has no model identity");
        }
        const id = randomUUID();
        updateLedger(this.ledgerPath, (ledger) => {
            if (body.model !== ledger.model) {
                throw new Error("Credit-controlled request model mismatch");
            }
            reserveCredits(
                ledger,
                id,
                this.sessionScope
                    ? `${this.sessionScope}::${context.sessionId}`
                    : context.sessionId,
            );
        });
        // Failed, cancelled and unrecognized responses keep the
        // full reservation. Never infer that a failed request was free.
        const response = await super.sendRequest(request, context);
        const contentType = response.headers.get("content-type") ?? "";
        updateLedger(this.ledgerPath, (ledger) => {
            const entry = ledger.reservations.find((entry) => entry.id === id);
            if (!entry) throw new Error("Missing credit reservation");
            entry.responseContentType = contentType;
        });
        if (response.ok && contentType.includes("application/json")) {
            const amount = extractNanoAiu(await response.clone().json());
            if (amount !== undefined) {
                settleCredits(this.ledgerPath, id, amount);
            }
            return response;
        }
        if (
            !response.ok ||
            !response.body ||
            !contentType.includes("text/event-stream")
        ) {
            return response;
        }
        const decoder = new TextDecoder();
        let pending = "";
        let observed: number | undefined;
        const file = this.ledgerPath;
        return new Response(
            response.body.pipeThrough(
                new TransformStream<Uint8Array, Uint8Array>({
                    transform(chunk, controller) {
                        pending += decoder.decode(chunk, { stream: true });
                        if (pending.length > 8 * 1024 * 1024) {
                            throw new Error(
                                "Credit usage stream line too large",
                            );
                        }
                        const lines = pending.split("\n");
                        pending = lines.pop()!;
                        for (const line of lines) {
                            if (!line.startsWith("data:")) continue;
                            const text = line.slice(5).trim();
                            if (text === "[DONE]" || text.length === 0)
                                continue;
                            const amount = extractNanoAiu(JSON.parse(text));
                            if (amount !== undefined) {
                                observed = Math.max(observed ?? 0, amount);
                            }
                        }
                        controller.enqueue(chunk);
                    },
                    flush() {
                        if (observed === undefined || pending.trim() !== "") {
                            return;
                        }
                        const settled = observed;
                        settleCredits(file, id, settled);
                    },
                }),
            ),
            {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
            },
        );
    }
}

export function getCopilotCreditBudget(): CopilotCreditBudget | undefined {
    const file = process.env.TYPEAGENT_COPILOT_CREDIT_LEDGER;
    return file
        ? new CopilotCreditBudget(
              file,
              process.env.TYPEAGENT_COPILOT_CREDIT_SESSION_SCOPE,
          )
        : undefined;
}
