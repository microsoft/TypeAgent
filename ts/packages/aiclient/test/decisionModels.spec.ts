// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { buildConfig, type Config } from "@typeagent/config";
import type { CopilotModelEndpointProvider } from "../src/copilotModels.js";
import type { DecisionRequest, DecisionModel } from "../src/decisionModels.js";
import { trace } from "@opentelemetry/api";
import { azureApiSettingsFromConfig } from "../src/apiSettingsFromConfig.js";
import { ModelType } from "../src/apiTypes.js";
import { createChatModel } from "../src/openai.js";
import {
    createCopilotChatModel,
    createCopilotTransportModel,
} from "../src/copilotModels.js";
import { copilotApiSettingsFromConfig } from "../src/copilotSettings.js";

const forceCalls: boolean[] = [];
let acquire: (() => Promise<void>) | undefined;
let acquisitions = 0;
const endpointProvider: CopilotModelEndpointProvider = {
    async getEndpoint(force = false) {
        acquisitions++;
        forceCalls.push(force);
        if (acquire) await acquire();
        return {
            baseUrl: "https://copilot.example",
            model: "gpt-6-luna-decisions",
            headers: { Authorization: "Bearer offline-test" },
        };
    },
};
const {
    createDecisionModel,
    buildCopilotDecisionRequest,
    normalizeDecisionAnswers,
} = await import("../src/decisionModels.js");
const { setActiveModelProvider } = await import("../src/providerMode.js");
const { setRuntimeConfig, getRuntimeConfigGeneration } = await import(
    "../src/runtimeConfig.js"
);
const { RequestBudget, runWithRequestBudget, decisionOutputReservation } =
    await import("../src/requestBudget.js");

const questions: DecisionRequest["questions"] = {
    flag: { type: "noul", instructions: "Does it fit?" },
    pick: {
        type: "choice",
        instructions: "Pick",
        criteria: { yes: "Fits", no: "Does not fit" },
    },
    fit: {
        type: "score",
        instructions: "How well?",
        criteria: ["Bad", "Good"],
    },
};
const request: DecisionRequest = { state: { text: "hello" }, questions };
const native = {
    model: "reported-native-model",
    answers: {
        flag: { type: "noul", noul: 0.8 },
        pick: {
            type: "choice",
            choice: "yes",
            probabilities: { yes: 0.8, no: 0.2 },
        },
        fit: {
            type: "score",
            score: 0.7,
            probabilities: { "0": 0.3, "1": 0.7 },
        },
    },
    usage: { input_tokens: 10, output_tokens: 4 },
};
const copilot = {
    model: "reported-copilot-model",
    answers: [
        {
            name: "pick",
            type: "choice",
            choice: "yes",
            probabilities: [
                { value: "no", probability: 0.2 },
                { value: "yes", probability: 0.8 },
            ],
        },
        {
            name: "fit",
            type: "score",
            score: 0.7,
            probabilities: [
                { value: 1, probability: 0.7 },
                { value: 0, probability: 0.3 },
            ],
        },
        { name: "flag", type: "predicate", probability: 0.8 },
    ],
};
function config(extra: Record<string, string> = {}): Config {
    return buildConfig({
        AZURE_OPENAI_ENDPOINT_DECISION_1_EASTUS:
            "https://eastus.example/providers/microsoft/v1/systemone",
        AZURE_OPENAI_API_KEY_DECISION_1_EASTUS: "offline-test",
        AZURE_OPENAI_MAX_RETRYATTEMPTS: "0",
        COPILOT_MAX_RETRYATTEMPTS: "0",
        ...extra,
    });
}
function model(
    configValue = config(),
    provider?: "azure" | "copilot",
): DecisionModel {
    const result = createDecisionModel({
        config: configValue,
        endpointProvider,
        ...(provider ? { provider } : {}),
    });
    if (!result.success) throw new Error(result.message);
    return result.data;
}
function response(status = 200, body: unknown = native): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}
describe("native decision models", () => {
    const originalFetch = globalThis.fetch;
    beforeEach(() => {
        setActiveModelProvider(undefined);
        forceCalls.length = 0;
        acquire = undefined;
        acquisitions = 0;
    });
    afterEach(() => {
        import.meta.jest.useRealTimers();
        import.meta.jest.restoreAllMocks();
        globalThis.fetch = originalFetch;
        setActiveModelProvider(undefined);
    });

    test("factory checks capability without credentials or inference", () => {
        globalThis.fetch = async () => {
            throw new Error("must not fetch");
        };
        expect(model(config(), "copilot").provider).toBe("copilot");
        expect(model().provider).toBe("azure");
        expect(acquisitions).toBe(0);
        expect(forceCalls).toEqual([]);
    });
    test("Decision settings cannot fall through any chat factory", () => {
        const azure = azureApiSettingsFromConfig(
            config(),
            ModelType.Decision,
            "decision_1",
        );
        const copilot = {
            ...copilotApiSettingsFromConfig(undefined, config()),
            modelType: ModelType.Decision as const,
        };
        expect(() => createChatModel(azure)).toThrow("Native decisions");
        expect(() => createCopilotChatModel(copilot)).toThrow(
            "Native decisions",
        );
        expect(() =>
            createCopilotTransportModel(
                copilot,
                undefined,
                undefined,
                undefined,
                undefined as any,
            ),
        ).toThrow("Native decisions");
    });
    test("explicit config never consults ambient runtime/provider env", () => {
        setRuntimeConfig(config({ TYPEAGENT_MODEL_PROVIDER: "copilot" }));
        expect(model(config()).provider).toBe("azure");
        expect(
            createDecisionModel({
                config: config({ TYPEAGENT_MODEL_PROVIDER: "openai" }),
            }),
        ).toMatchObject({ success: false, code: "unavailable" });
    });
    test("provider precedence: factory > decision > override > config > Azure", () => {
        setActiveModelProvider("ollama");
        const c = config({
            TYPEAGENT_MODEL_PROVIDER: "openai",
            TYPEAGENT_DECISION_PROVIDER: "azure",
        });
        expect(model(c, "copilot")).toMatchObject({
            provider: "copilot",
            providerSource: "factory",
        });
        expect(model(c)).toMatchObject({
            provider: "azure",
            providerSource: "decision",
        });
        expect(
            createDecisionModel({
                config: config({ TYPEAGENT_MODEL_PROVIDER: "copilot" }),
            }),
        ).toMatchObject({ success: false, code: "unavailable" });
        setActiveModelProvider("copilot");
        expect(
            model(config({ TYPEAGENT_MODEL_PROVIDER: "azure" })),
        ).toMatchObject({ provider: "copilot", providerSource: "override" });
        setActiveModelProvider(undefined);
        expect(
            model(config({ TYPEAGENT_MODEL_PROVIDER: "copilot" })),
        ).toMatchObject({ provider: "copilot", providerSource: "config" });
        expect(model()).toMatchObject({
            provider: "azure",
            providerSource: "default",
        });
    });
    test("config and active override changes invalidate generation", () => {
        const before = getRuntimeConfigGeneration();
        setRuntimeConfig(config());
        const first = model();
        expect(first.configGeneration).toBeGreaterThan(before);
        setActiveModelProvider("copilot");
        expect(getRuntimeConfigGeneration()).toBeGreaterThan(
            first.configGeneration,
        );
        expect(model(config(), "copilot").configGeneration).toBe(
            getRuntimeConfigGeneration(),
        );
    });
    test.each(["openai", "ollama"])(
        "unsupported inherited %s never falls back",
        (provider) => {
            expect(
                createDecisionModel({
                    config: config({ TYPEAGENT_MODEL_PROVIDER: provider }),
                }),
            ).toMatchObject({ success: false, code: "unavailable" });
        },
    );
    test.each([
        "https://example/chat/completions",
        "http://example/providers/microsoft/v1/systemone",
        "https://user:pass@example/providers/microsoft/v1/systemone",
    ])("rejects invalid native route %s", (url) => {
        expect(
            createDecisionModel({
                config: config({
                    AZURE_OPENAI_ENDPOINT_DECISION_1_EASTUS: url,
                }),
            }),
        ).toMatchObject({ success: false, code: "configuration" });
    });
    test("missing decision deployment never falls back to chat", () => {
        expect(
            createDecisionModel({
                config: buildConfig({
                    AZURE_OPENAI_ENDPOINT: "https://chat.example",
                }),
            }),
        ).toMatchObject({ success: false, code: "unavailable" });
    });
    test("Azure sends exact native body/model/auth and normalizes usage", async () => {
        let captured: RequestInit | undefined;
        globalThis.fetch = async (url, init) => {
            expect(url.toString()).toBe(
                "https://eastus.example/providers/microsoft/v1/systemone",
            );
            captured = init;
            return response();
        };
        const result = await model().decide(request);
        expect(JSON.parse(captured!.body as string)).toEqual({
            model: "decision-1",
            ...request,
        });
        expect(captured!.headers).toMatchObject({ "api-key": "offline-test" });
        expect(result).toMatchObject({
            success: true,
            data: {
                answers: native.answers,
                requestedModel: "decision-1",
                reportedModel: native.model,
                provider: "azure",
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 4,
                    total_tokens: 14,
                },
            },
        });
    });
    test("Azure configured model name is distinct from deployment key", async () => {
        globalThis.fetch = async (_, init) => {
            expect(JSON.parse(init!.body as string).model).toBe(
                "Case-Sensitive-Wire-Name",
            );
            return response();
        };
        expect(
            (
                await model(
                    config({
                        TYPEAGENT_DECISION_AZURE_DEPLOYMENT_NAME:
                            "Case-Sensitive-Wire-Name",
                    }),
                ).decide(request)
            ).success,
        ).toBe(true);
    });
    test.each(["azure", "copilot"] as const)(
        "preserves typed native confidence and requested/reported identity for %s",
        async (provider) => {
            const payload = JSON.parse(
                JSON.stringify(provider === "azure" ? native : copilot),
            );
            const answers =
                provider === "azure"
                    ? Object.values(payload.answers)
                    : payload.answers;
            answers.forEach((answer: any, index: number) => {
                answer.confidence = [0, 0.5, 1][index];
            });
            globalThis.fetch = async () => response(200, payload);
            const result = await model(config(), provider).decide(request);
            expect(result.success).toBe(true);
            if (!result.success) return;
            const reportedModel: string | undefined = result.data.reportedModel;
            const requestedModel: string = result.data.requestedModel;
            const confidence: number | undefined =
                result.data.answers.flag.confidence;
            expect(reportedModel).toBe(payload.model);
            expect(requestedModel).toBe(
                provider === "azure" ? "decision-1" : "gpt-6-luna-decisions",
            );
            expect(confidence).toBe(provider === "azure" ? 0 : 1);
            expect(result.data.answers.pick.confidence).toBe(
                provider === "azure" ? 0.5 : 0,
            );
            expect(result.data.answers.fit.confidence).toBe(
                provider === "azure" ? 1 : 0.5,
            );
        },
    );
    test.each(["azure", "copilot"] as const)(
        "retains input-only native usage for %s without fabricated output",
        async (provider) => {
            const payload = {
                ...(provider === "azure" ? native : copilot),
                usage: { input_tokens: 100 },
            };
            globalThis.fetch = async () => response(200, payload);
            const result = await model(config(), provider).decide(request);
            expect(result).toMatchObject({
                success: true,
                data: { decisionUsage: { prompt_tokens: 100 } },
            });
            if (!result.success) return;
            expect(result.data.usage).toBeUndefined();
            expect(result.data.decisionUsage).toEqual({ prompt_tokens: 100 });
            expect(
                result.data.decisionUsage?.completion_tokens,
            ).toBeUndefined();
            expect(result.data.decisionUsage?.total_tokens).toBeUndefined();
        },
    );
    test("normalizes complete usage compatibly while retaining only reported metadata fields", async () => {
        globalThis.fetch = async () =>
            response(200, {
                ...native,
                usage: {
                    input_tokens: 100,
                    output_tokens: 4,
                    prompt_tokens_details: { cached_tokens: 20 },
                },
            });
        const result = await model().decide(request);
        expect(result).toMatchObject({
            success: true,
            data: {
                usage: {
                    prompt_tokens: 100,
                    completion_tokens: 4,
                    total_tokens: 104,
                    cached_tokens: 20,
                },
                decisionUsage: {
                    prompt_tokens: 100,
                    completion_tokens: 4,
                    cached_tokens: 20,
                },
            },
        });
        if (result.success)
            expect(result.data.decisionUsage?.total_tokens).toBeUndefined();
    });
    test.each(["azure", "copilot"] as const)(
        "malformed native confidence returns invalid_response for %s",
        async (provider) => {
            const payload = JSON.parse(
                JSON.stringify(provider === "azure" ? native : copilot),
            );
            if (provider === "azure") payload.answers.flag.confidence = -0.1;
            else payload.answers[0].confidence = null;
            let attempts = 0;
            globalThis.fetch = async () => {
                attempts++;
                return response(200, payload);
            };
            expect(
                await model(config(), provider).decide(request),
            ).toMatchObject({ success: false, code: "invalid_response" });
            expect(attempts).toBe(1);
        },
    );
    test.each([
        [{ input_tokens: 0 }, { prompt_tokens: 0 }],
        [{ output_tokens: 0 }, { completion_tokens: 0 }],
        [{ input_tokens: 100, output_tokens: -1 }, { prompt_tokens: 100 }],
        [
            { input_tokens: 100, output_tokens: "unknown" },
            { prompt_tokens: 100 },
        ],
    ])(
        "retains valid reported partial counts without filling absent or malformed fields %#",
        async (usage, expected) => {
            globalThis.fetch = async () => response(200, { ...native, usage });
            const result = await model().decide(request);
            expect(result).toMatchObject({
                success: true,
                data: { decisionUsage: expected },
            });
            if (!result.success) return;
            expect(result.data.decisionUsage).toEqual(expected);
            expect(result.data.usage).toBeUndefined();
        },
    );
    test("Azure identity acquisition uses existing token provider and honors auth failures", async () => {
        const c = config({
            AZURE_OPENAI_API_KEY_DECISION_1_EASTUS: "identity",
        });
        const tokenProvider = azureApiSettingsFromConfig(
            c,
            ModelType.Decision,
            "decision_1",
        ).tokenProvider!;
        const original = tokenProvider.getAccessToken;
        let calls = 0;
        globalThis.fetch = async (_, init) => {
            calls++;
            expect(init!.headers).toMatchObject({
                Authorization: "Bearer offline-identity",
            });
            return response();
        };
        try {
            tokenProvider.getAccessToken = async () => ({
                success: true,
                data: "offline-identity",
            });
            expect((await model(c).decide(request)).success).toBe(true);
            tokenProvider.getAccessToken = async () => ({
                success: false,
                message: "private credential failure",
            });
            expect(await model(c).decide(request)).toMatchObject({
                success: false,
                code: "authentication",
            });
            expect(calls).toBe(1);
        } finally {
            tokenProvider.getAccessToken = original;
        }
    });
    test("same-region PTU/PAYG pool members preserve their own exact endpoints and auth", async () => {
        const c = buildConfig({
            AZURE_OPENAI_ENDPOINT_DECISION_1_EASTUS_PTU:
                "https://ptu.example/providers/microsoft/v1/systemone",
            AZURE_OPENAI_API_KEY_DECISION_1_EASTUS_PTU: "ptu-offline",
            AZURE_OPENAI_ENDPOINT_DECISION_1_EASTUS:
                "https://payg.example/providers/microsoft/v1/systemone",
            AZURE_OPENAI_API_KEY_DECISION_1_EASTUS: "payg-offline",
        });
        const urls: string[] = [];
        globalThis.fetch = async (url, init) => {
            urls.push(url.toString());
            if (url.toString().includes("ptu.example")) {
                expect(init!.headers).toMatchObject({
                    "api-key": "ptu-offline",
                });
                return response(503);
            }
            expect(init!.headers).toMatchObject({ "api-key": "payg-offline" });
            return response();
        };
        expect(
            (await model(c).decide(request, { timeoutMs: 1000 })).success,
        ).toBe(true);
        expect(urls).toEqual([
            "https://ptu.example/providers/microsoft/v1/systemone",
            "https://payg.example/providers/microsoft/v1/systemone",
        ]);
    });
    test("Copilot native mapping preserves identity, ordered levels and normalized answers", async () => {
        globalThis.fetch = async (url, init) => {
            expect(url.toString()).toBe("https://copilot.example/v1/decisions");
            expect(JSON.parse(init!.body as string)).toEqual(
                buildCopilotDecisionRequest("gpt-6-luna-decisions", request),
            );
            return response(200, copilot);
        };
        expect(await model(config(), "copilot").decide(request)).toMatchObject({
            success: true,
            data: {
                answers: native.answers,
                provider: "copilot",
                requestedModel: "gpt-6-luna-decisions",
                reportedModel: copilot.model,
            },
        });
    });
    test("Copilot embeds binary criteria instead of discarding definitions", () => {
        const built = buildCopilotDecisionRequest("model", {
            state: "s",
            questions: {
                f: {
                    type: "noul",
                    instructions: "I",
                    criteria: { true: "Accepted", false: "No fit" },
                },
            },
        }) as any;
        expect(built.questions[0].instructions).toContain("Accepted");
        expect(built.questions[0].instructions).toContain("No fit");
    });
    test.each([401, 403])("Copilot refreshes %s once only", async (status) => {
        let count = 0;
        globalThis.fetch = async () => {
            count++;
            return response(count === 1 ? status : 200, copilot);
        };
        expect((await model(config(), "copilot").decide(request)).success).toBe(
            true,
        );
        expect(forceCalls).toEqual([false, true]);
        count = 0;
        forceCalls.length = 0;
        globalThis.fetch = async () => {
            count++;
            return response(status);
        };
        expect(await model(config(), "copilot").decide(request)).toMatchObject({
            success: false,
            code: status === 401 ? "authentication" : "authorization",
        });
        expect(count).toBe(2);
        expect(forceCalls).toEqual([false, true]);
    });
    test.each([400, 401, 403, 429, 500])(
        "classifies HTTP %s and never leaks provider text",
        async (status) => {
            globalThis.fetch = async () =>
                response(status, { error: { message: "private text" } });
            const result = await model().decide(request);
            expect(result.success).toBe(false);
            expect(JSON.stringify(result)).not.toContain("private text");
            if (!result.success) expect(result.httpStatus).toBe(status);
        },
    );
    test.each([false, true])(
        "Azure 429 respects Retry-After and bounds retries (exhaust=%s)",
        async (exhaust) => {
            const jest = import.meta.jest;
            jest.useFakeTimers();
            const jitter = jest
                .spyOn(Math, "random")
                .mockReturnValue(1 - Number.EPSILON);
            let calls = 0;
            try {
                globalThis.fetch = async () => {
                    const reply =
                        ++calls === 1 || exhaust
                            ? new Response("{}", {
                                  status: 429,
                                  headers: { "Retry-After": "1" },
                              })
                            : response();
                    // Body stream I/O is outside Jest's virtual retry clock.
                    jest.spyOn(reply, "text").mockResolvedValue("{}");
                    jest.spyOn(reply, "json").mockResolvedValue(native);
                    return reply;
                };
                const pending = model(
                    config({ AZURE_OPENAI_MAX_RETRYATTEMPTS: "1" }),
                ).decide(request);
                // Retry-After adds one second to the maximum five-second jitter.
                await jest.advanceTimersByTimeAsync(5999);
                expect(calls).toBe(1);
                await jest.advanceTimersByTimeAsync(1);
                const result = await pending;
                expect(calls).toBe(2);
                if (exhaust)
                    expect(result).toMatchObject({
                        success: false,
                        code: "rate_limit",
                        httpStatus: 429,
                    });
                else expect(result.success).toBe(true);
            } finally {
                jitter.mockRestore();
                jest.useRealTimers();
            }
        },
    );
    test("malformed JSON response is classified", async () => {
        globalThis.fetch = async () => new Response("not-json");
        expect(await model().decide(request)).toMatchObject({
            success: false,
            code: "invalid_response",
        });
    });
    test("network and credential errors retain bounded classifications", async () => {
        globalThis.fetch = async () => {
            throw Object.assign(new Error("private network text"), {
                code: "ECONNRESET",
            });
        };
        expect(await model().decide(request)).toMatchObject({
            success: false,
            code: "network",
            errorCategory: "network",
        });
        acquire = async () => {
            throw Object.assign(new Error("private authorization text"), {
                status: 403,
            });
        };
        expect(await model(config(), "copilot").decide(request)).toMatchObject({
            success: false,
            code: "authorization",
            httpStatus: 403,
        });
    });
    test("safe telemetry reports usage/counts/attempts without request or answer content", async () => {
        const attrs: Record<string, unknown> = {};
        let ended = false;
        const span = {
            setAttributes(value: object) {
                Object.assign(attrs, value);
                return span;
            },
            setAttribute(key: string, value: unknown) {
                attrs[key] = value;
                return span;
            },
            setStatus() {
                return span;
            },
            end() {
                ended = true;
            },
        };
        trace.setGlobalTracerProvider({
            getTracer: () => ({ startSpan: () => span }),
        } as any);
        try {
            globalThis.fetch = async () => response();
            expect((await model().decide(request)).success).toBe(true);
            expect(attrs).toMatchObject({
                "gen_ai.operation.name": "decision",
                "typeagent.decision.question_count": 3,
                "typeagent.decision.transport_attempts": 1,
                "typeagent.decision.outcome": "success",
                "gen_ai.usage.input_tokens": 10,
                "gen_ai.usage.output_tokens": 4,
            });
            expect(JSON.stringify(attrs)).not.toContain("hello");
            expect(JSON.stringify(attrs)).not.toContain("Does it fit?");
            expect(ended).toBe(true);
            for (const key of Object.keys(attrs)) delete attrs[key];
            globalThis.fetch = async () =>
                response(200, { ...native, usage: { input_tokens: 100 } });
            expect((await model().decide(request)).success).toBe(true);
            expect(attrs["gen_ai.usage.input_tokens"]).toBe(100);
            expect(attrs).not.toHaveProperty("gen_ai.usage.output_tokens");
        } finally {
            trace.disable();
        }
    });
    test("transient multi-endpoint failure rotates, non-transient auth does not", async () => {
        const c = config({
            AZURE_OPENAI_ENDPOINT_DECISION_1_WESTUS:
                "https://westus.example/providers/microsoft/v1/systemone",
            AZURE_OPENAI_API_KEY_DECISION_1_WESTUS: "offline-test",
        });
        let count = 0;
        const urls: string[] = [];
        globalThis.fetch = async (url) => {
            urls.push(url.toString());
            return response(++count === 1 ? 503 : 200);
        };
        expect(
            (await model(c).decide(request, { timeoutMs: 1000 })).success,
        ).toBe(true);
        expect(new Set(urls).size).toBe(2);
        count = 0;
        globalThis.fetch = async () => {
            count++;
            return response(401);
        };
        expect((await model(c).decide(request)).success).toBe(false);
        expect(count).toBe(1);
    });
    test("pre-cancelled requests acquire nothing", async () => {
        const controller = new AbortController();
        controller.abort("cancel");
        expect(
            await model(config(), "copilot").decide(request, {
                signal: controller.signal,
            }),
        ).toMatchObject({ success: false, code: "cancelled" });
        expect(forceCalls).toEqual([]);
    });
    test.each(["timeout", "cancelled"])(
        "bounds hanging credential acquisition by %s",
        async (kind) => {
            let release!: () => void;
            acquire = () =>
                new Promise<void>((resolve) => {
                    release = resolve;
                });
            let calls = 0;
            globalThis.fetch = async () => {
                calls++;
                return response();
            };
            const controller = new AbortController();
            const pending = model(config(), "copilot").decide(request, {
                timeoutMs: 20,
                signal: controller.signal,
            });
            if (kind === "cancelled") controller.abort();
            expect(await pending).toMatchObject({ success: false, code: kind });
            release();
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(calls).toBe(0);
        },
    );
    test("bounds fetch and response decoding even if transport ignores cancellation", async () => {
        globalThis.fetch = async () => new Promise<Response>(() => {});
        expect(await model().decide(request, { timeoutMs: 10 })).toMatchObject({
            success: false,
            code: "timeout",
        });
        globalThis.fetch = async () =>
            ({
                json: () => new Promise(() => {}),
                status: 200,
                headers: new Headers(),
            }) as unknown as Response;
        expect(await model().decide(request, { timeoutMs: 10 })).toMatchObject({
            success: false,
            code: "timeout",
        });
    });
    test("request budgets admit native decisions and count each attempt", async () => {
        globalThis.fetch = async () => response();
        const budget = new RequestBudget({
            inputTokens: 10000,
            outputTokens: 10000,
            safetyTokens: 10,
            chatAttempts: 1,
            reservedTokens: 20000,
            embeddingAttempts: 1,
            elapsedMs: 1000,
            tokenizer: "offline",
            countTokens: (s) => s.length,
        });
        const m = model();
        expect(
            (await runWithRequestBudget(budget, () => m.decide(request)))
                .success,
        ).toBe(true);
        expect(budget.receipts[0].kind).toBe("decision");
        expect(
            await runWithRequestBudget(budget, () => m.decide(request)),
        ).toMatchObject({ success: false, code: "budget" });
    });
    test("output reservations follow answer shape, not arbitrary instruction length", () => {
        const nativeBody = { model: "decision-1", ...request };
        const changed = {
            ...request,
            questions: {
                ...questions,
                flag: {
                    ...questions.flag,
                    instructions: "x".repeat(10000),
                },
            },
        };
        expect(decisionOutputReservation(nativeBody)).toBe(
            decisionOutputReservation({ model: "decision-1", ...changed }),
        );
        expect(decisionOutputReservation(nativeBody)).toBe(
            decisionOutputReservation(
                buildCopilotDecisionRequest("gpt-6-luna-decisions", request),
            ),
        );
    });
    test("configured provider constraints reject before egress", async () => {
        let calls = 0;
        globalThis.fetch = async () => {
            calls++;
            return response();
        };
        const c = config({
            TYPEAGENT_MODEL_REQUEST_CONSTRAINTS: JSON.stringify({
                "azure:decision:decision_1": { inputTokens: 1 },
            }),
        });
        expect(await model(c).decide(request)).toMatchObject({
            success: false,
            code: "budget",
        });
        expect(calls).toBe(0);
    });
    test.each(["azure", "copilot"] as const)(
        "packing preflight enforces %s wire constraints without acquiring credentials",
        (provider) => {
            let calls = 0;
            globalThis.fetch = async () => {
                calls++;
                return response();
            };
            const key =
                provider === "azure"
                    ? "azure:decision:decision_1"
                    : `copilot:decision:${model(config(), "copilot").model}`;
            const nativeModel = model(
                config({
                    TYPEAGENT_MODEL_REQUEST_CONSTRAINTS: JSON.stringify({
                        [key]: { outputTokens: 1 },
                    }),
                }),
                provider,
            );
            expect(() => nativeModel.checkRequest!(request)).toThrow(
                "request constraints",
            );
            expect(calls).toBe(0);
            expect(acquisitions).toBe(0);
        },
    );
    test("configured Azure character guard rejects without truncating native input", async () => {
        let calls = 0;
        globalThis.fetch = async () => {
            calls++;
            return response();
        };
        expect(
            await model(config({ AZURE_OPENAI_MAX_CHARS: "1" })).decide(
                request,
            ),
        ).toMatchObject({ success: false, code: "budget" });
        expect(calls).toBe(0);
    });
    test.each([0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER])(
        "rejects invalid timeout %p",
        async (timeoutMs) => {
            expect(await model().decide(request, { timeoutMs })).toMatchObject({
                success: false,
                code: "invalid_request",
            });
        },
    );
    test.each([
        { state: null, questions },
        { state: 3, questions },
        { state: {}, questions: {} },
        { state: { x: undefined }, questions },
        { state: { x: NaN }, questions },
        { state: new Date(), questions },
        { state: "", questions: { f: { type: "noul", instructions: "" } } },
        {
            state: "",
            questions: {
                f: { type: "choice", instructions: "i", criteria: {} },
            },
        },
        {
            state: "",
            questions: {
                f: { type: "score", instructions: "i", criteria: [] },
            },
        },
        {
            state: "",
            questions: {
                f: {
                    type: "noul",
                    instructions: "i",
                    criteria: { other: "x" },
                },
            },
        },
    ])("rejects invalid request without egress %#", async (value) => {
        globalThis.fetch = async () => {
            throw new Error("no egress");
        };
        expect(
            await model().decide(value as unknown as DecisionRequest),
        ).toMatchObject({ success: false, code: "invalid_request" });
    });
    test("rejects cyclic input", async () => {
        const state: any = {};
        state.self = state;
        expect(await model().decide({ state, questions })).toMatchObject({
            success: false,
            code: "invalid_request",
        });
    });
});

describe("strict native decision validation", () => {
    test.each(["azure", "copilot"] as const)(
        "rejects malformed confidence on every %s answer variant",
        (provider) => {
            for (const name of ["flag", "pick", "fit"]) {
                for (const confidence of [
                    null,
                    undefined,
                    "0.5",
                    -0.1,
                    1.1,
                    NaN,
                    Infinity,
                    {},
                    [],
                ]) {
                    const payload = JSON.parse(
                        JSON.stringify(provider === "azure" ? native : copilot),
                    );
                    const answer =
                        provider === "azure"
                            ? payload.answers[name]
                            : payload.answers.find((a: any) => a.name === name);
                    answer.confidence = confidence;
                    expect(() =>
                        normalizeDecisionAnswers(payload, questions, provider),
                    ).toThrow();
                }
            }
        },
    );
    test("normal no-fit is successful data", () => {
        expect(
            normalizeDecisionAnswers(
                { answers: { f: { type: "noul", noul: 0 } } },
                { f: questions.flag },
                "azure",
            ),
        ).toEqual({ f: { type: "noul", noul: 0 } });
    });
    test.each([
        (p: any) => delete p.answers.flag,
        (p: any) => (p.answers.extra = p.answers.flag),
        (p: any) => (p.answers.flag.type = "choice"),
        (p: any) => (p.answers.flag.noul = NaN),
        (p: any) => (p.answers.flag.noul = 1.01),
        (p: any) => (p.answers.flag.noul = -1),
        (p: any) => (p.answers.pick.choice = "unknown"),
        (p: any) => (p.answers.pick.probabilities = { yes: 1 }),
        (p: any) => (p.answers.pick.probabilities = { yes: 0.2, no: 0.2 }),
        (p: any) => (p.answers.pick.probabilities = { yes: 0.8, no: 0.195 }),
        (p: any) => (p.answers.pick.probabilities = { yes: 1.1, no: -0.1 }),
        (p: any) => (p.answers.pick.probabilities = { yes: 0.8, unknown: 0.2 }),
        (p: any) => (p.answers.pick.probabilities = { yes: NaN, no: 0.2 }),
        (p: any) => (p.answers.fit.score = 2),
        (p: any) => (p.answers.fit.score = Infinity),
        (p: any) => (p.answers.fit.probabilities = { Bad: 0.3, Good: 0.7 }),
    ])("rejects malformed Azure answer %#", (mutate) => {
        const payload = JSON.parse(JSON.stringify(native));
        mutate(payload);
        expect(() =>
            normalizeDecisionAnswers(payload, questions, "azure"),
        ).toThrow();
    });
    test.each([
        (p: any) => p.answers.pop(),
        (p: any) => p.answers.push(p.answers[0]),
        (p: any) => (p.answers[0].name = "unknown"),
        (p: any) => (p.answers[0].probabilities[1].value = "no"),
        (p: any) => (p.answers[1].probabilities[0].value = "1"),
        (p: any) => (p.answers[1].probabilities[0].value = 0.5),
        (p: any) => (p.answers[1].probabilities[0].value = 2),
        (p: any) => (p.answers[2].type = "noul"),
    ])("rejects malformed Copilot answer %#", (mutate) => {
        const payload = JSON.parse(JSON.stringify(copilot));
        mutate(payload);
        expect(() =>
            normalizeDecisionAnswers(payload, questions, "copilot"),
        ).toThrow();
    });
    test("refusal is classified and never accepted as an ordinary answer", () => {
        expect(() =>
            normalizeDecisionAnswers(
                { answers: [{ name: "f", type: "refusal" }] },
                { f: questions.flag },
                "copilot",
            ),
        ).toThrow("refused");
    });
});
