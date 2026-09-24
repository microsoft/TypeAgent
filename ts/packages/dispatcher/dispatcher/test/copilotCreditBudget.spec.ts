// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    accountedNanoAiu,
    CopilotCreditBudget,
    extractNanoAiu,
    reserveCredits,
    validateCreditLedger,
    type CopilotCreditLedger,
} from "../src/reasoning/copilotCreditBudget.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CopilotRequestContext } from "@github/copilot-sdk";
import { jest } from "@jest/globals";

function ledger(): CopilotCreditLedger {
    return {
        version: 1,
        capNanoAiu: 20_000,
        openingNanoAiu: 3_000,
        headroomNanoAiu: 8_000,
        model: "test-model",
        requestMaximumNanoAiu: 2_000,
        reservations: [],
    };
}

describe("Copilot credit admission", () => {
    it("accounts for prior sessions, headroom and unresolved requests", () => {
        const state = ledger();
        reserveCredits(state, "first");
        reserveCredits(state, "second");
        expect(accountedNanoAiu(state)).toBe(15_000);
        state.reservations[0].settledNanoAiu = 25;
        expect(accountedNanoAiu(state)).toBe(13_025);
    });

    class TestBudget extends CopilotCreditBudget {
        send(model = "test-model") {
            const request = new Request("https://example.invalid/responses", {
                method: "POST",
                body: JSON.stringify({ model }),
            });
            const context: CopilotRequestContext = {
                requestId: "test",
                sessionId: "session",
                transport: "http",
                url: request.url,
                headers: {},
                signal: new AbortController().signal,
            };
            return this.sendRequest(request, context);
        }
    }

    describe("Copilot outbound request guard", () => {
        let directory: string;
        let file: string;
        let budget: TestBudget;
        beforeEach(() => {
            directory = fs.mkdtempSync(
                path.join(os.tmpdir(), "copilot-credit-test-"),
            );
            file = path.join(directory, "ledger.json");
            fs.writeFileSync(file, JSON.stringify(ledger()));
            budget = new TestBudget(file);
        });
        afterEach(() => {
            jest.restoreAllMocks();
            fs.rmSync(directory, { recursive: true });
        });
        const read = (file: string): CopilotCreditLedger =>
            JSON.parse(fs.readFileSync(file, "utf8"));

        it("persists admission before forwarding and settles explicit JSON usage", async () => {
            const fetch = jest
                .spyOn(globalThis, "fetch")
                .mockImplementation(async () => {
                    expect(read(file).reservations).toHaveLength(1);
                    return Response.json({
                        copilot_usage: { total_nano_aiu: 25 },
                    });
                });
            await budget.send();
            expect(fetch).toHaveBeenCalledTimes(1);
            expect(accountedNanoAiu(read(file))).toBe(11_025);
        });

        it("does not send unknown models, exhausted budgets, or concurrent admissions", async () => {
            const fetch = jest.spyOn(globalThis, "fetch");
            await expect(budget.send("different-model")).rejects.toThrow(
                "model mismatch",
            );
            fs.writeFileSync(`${file}.lock`, "");
            await expect(budget.send()).rejects.toThrow();
            fs.unlinkSync(`${file}.lock`);
            const state = ledger();
            state.openingNanoAiu = 12_000;
            fs.writeFileSync(file, JSON.stringify(state));
            await expect(budget.send()).rejects.toThrow("request not sent");
            expect(fetch).not.toHaveBeenCalled();
        });

        it("retains the reservation after transport failure or missing usage", async () => {
            const fetch = jest
                .spyOn(globalThis, "fetch")
                .mockRejectedValueOnce(new Error("connection failed"))
                .mockResolvedValueOnce(Response.json({ output: "OK" }));
            await expect(budget.send()).rejects.toThrow("connection failed");
            await budget.send();
            expect(fetch).toHaveBeenCalledTimes(2);
            expect(accountedNanoAiu(read(file))).toBe(15_000);
        });

        it("persists unexpected excess billing and blocks future admissions", async () => {
            const fetch = jest
                .spyOn(globalThis, "fetch")
                .mockResolvedValue(
                    Response.json({ copilot_usage: { total_nano_aiu: 2_001 } }),
                );
            await expect(budget.send()).rejects.toThrow("accounting blocked");
            expect(read(file).reservations[0].settledNanoAiu).toBe(2_001);
            expect(read(file).blockedReason).toMatch(/exceeded/);
            await expect(budget.send()).rejects.toThrow("accounting blocked");
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        it("preserves SSE bytes and settles usage split across chunks", async () => {
            const body =
                'data: {"response":{"copilot_usage":{"total_nano_aiu":42}}}\n\ndata: [DONE]\n\n';
            const encoder = new TextEncoder();
            jest.spyOn(globalThis, "fetch").mockResolvedValue(
                new Response(
                    new ReadableStream({
                        start(controller) {
                            controller.enqueue(
                                encoder.encode(body.slice(0, 20)),
                            );
                            controller.enqueue(encoder.encode(body.slice(20)));
                            controller.close();
                        },
                    }),
                    { headers: { "content-type": "text/event-stream" } },
                ),
            );
            expect(await (await budget.send()).text()).toBe(body);
            expect(accountedNanoAiu(read(file))).toBe(11_042);
        });
    });

    it("rejects the next request without modifying the ledger", () => {
        const state = ledger();
        for (let i = 0; i < 4; i++) reserveCredits(state, String(i));
        const before = JSON.stringify(state);
        expect(() => reserveCredits(state, "fifth")).toThrow(
            "request not sent",
        );
        expect(JSON.stringify(state)).toBe(before);
    });

    it("admits an exact remaining reservation", () => {
        const state = ledger();
        state.requestMaximumNanoAiu = 9_000;
        reserveCredits(state, "exact");
        expect(accountedNanoAiu(state)).toBe(state.capNanoAiu);
    });

    it("bounds settled calls per session even when each call bills zero", () => {
        const state = ledger();
        for (let i = 0; i < 24; i++) {
            reserveCredits(state, String(i), "bounded-session");
            state.reservations[i].settledNanoAiu = 0;
        }
        expect(() => reserveCredits(state, "extra", "bounded-session")).toThrow(
            "request-count limit",
        );
        expect(state.reservations).toHaveLength(24);
    });

    it("does not reset or silently duplicate a reservation", () => {
        const state = ledger();
        reserveCredits(state, "same");
        expect(() => reserveCredits(state, "same")).toThrow("already exists");
        expect(state.reservations).toHaveLength(1);
    });

    it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
        "rejects invalid accounting values: %s",
        (value) => {
            const state = ledger();
            state.openingNanoAiu = value;
            expect(() => validateCreditLedger(state)).toThrow(
                "Invalid credit ledger",
            );
        },
    );

    it("rejects cap increases and unbounded requests", () => {
        const state = ledger();
        state.capNanoAiu = 20_000_000_000_001;
        expect(() => validateCreditLedger(state)).toThrow("ceiling");
        state.capNanoAiu = 20_000;
        state.requestMaximumNanoAiu = 0;
        expect(() => validateCreditLedger(state)).toThrow("positive");
    });

    it("fails closed if observed usage exceeds its reservation", () => {
        const state = ledger();
        reserveCredits(state, "request");
        state.reservations[0].settledNanoAiu = 2_001;
        expect(() => accountedNanoAiu(state)).toThrow("exceeded");
    });

    it("reads only explicit Copilot billing fields, including zero", () => {
        expect(extractNanoAiu({ usage: { total_tokens: 50 } })).toBeUndefined();
        expect(extractNanoAiu({ copilot_usage: { total_nano_aiu: 0 } })).toBe(
            0,
        );
        expect(
            extractNanoAiu({
                response: { copilot_usage: { totalNanoAiu: 123 } },
            }),
        ).toBe(123);
        expect(() =>
            extractNanoAiu({ copilot_usage: { total_nano_aiu: -1 } }),
        ).toThrow("response usage");
    });
});
