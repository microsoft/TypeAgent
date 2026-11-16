// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeDecisionAnswers } from "../../packages/aiclient/dist/decisionModels.js";
import { identity, sha256 } from "./quality-contract.mjs";
import {
    arms,
    families,
    freezeProtocol,
    loadInventory,
    messages,
    responseSchema,
    schedule,
    validateAnswer,
    validatePacket,
} from "./wiki-schema-contract.mjs";
import {
    prepareReplay,
    runReplay,
    sdkTransport,
} from "./wiki-schema-replay.mjs";
import { scorecard } from "./wiki-schema-scorecard.mjs";

const normalize = normalizeDecisionAnswers;
function packet(family = "editorial", ordinal = 0) {
    const requestJson = JSON.stringify({
        state: `Synthetic ${family}/${ordinal}: ${"context ".repeat(ordinal + 1)}`,
        questions: {
            q: {
                type: "choice",
                instructions: "Is the synthetic assertion supported?",
                criteria: {
                    yes: "Supported",
                    no: "Unsupported",
                    uncertain: "Insufficient evidence",
                },
            },
        },
    });
    return {
        id: `${family}-${ordinal}`,
        family,
        cohort: "synthetic-only",
        sourceGroups: [`synthetic-${family}-${ordinal}`],
        requestJson,
        requestHash: sha256(requestJson),
        nativeAnswers: {
            q: {
                type: "choice",
                choice: "yes",
                probabilities: { yes: 0.8, no: 0.1, uncertain: 0.1 },
                ...(ordinal % 2 ? {} : { confidence: 0.7 }),
            },
        },
        labels: {
            q: {
                kind: "deterministic-control",
                choice: "yes",
                critical: true,
                provenance: "synthetic unit test; not experimental evidence",
            },
        },
    };
}
const inventory = () => ({
    schemaVersion: 1,
    sourceRevision: "a".repeat(40),
    driverHash: "b".repeat(64),
    packets: families.flatMap((family) =>
        Array.from({ length: 6 }, (_, index) => packet(family, index)),
    ),
});
const choices = (p) => ({
    answers: { q: { type: "choice", choice: p.nativeAnswers.q.choice } },
});

async function fixture(work) {
    const root = await mkdtemp(path.join(os.tmpdir(), "wiki-schema-test-"));
    try {
        const data = inventory();
        for (const p of data.packets) {
            const file = `${p.id}.json`;
            const archive = JSON.stringify({
                request: JSON.parse(p.requestJson),
                answers: p.nativeAnswers,
            });
            await writeFile(path.join(root, file), archive);
            p.origin = {
                file,
                recordId: p.id,
                sha256: sha256(archive),
                requestPointer: "/request",
                answersPointer: "/answers",
            };
        }
        const bytes = JSON.stringify(data);
        const filename = path.join(root, "inventory.json");
        await writeFile(filename, bytes);
        const options = {
            inventory: filename,
            inventoryHash: sha256(bytes),
            seed: "wiki-schema-unit-test",
            output: path.join(root, "prepared"),
        };
        const prepared = await prepareReplay(options, normalize);
        const runOptions = {
            ...options,
            protocol: prepared.protocol,
            protocolHash: prepared.protocolHash,
            output: path.join(root, "run"),
            live: true,
            maxCalls: 360,
            deadline: new Date(Date.now() + 60_000).toISOString(),
        };
        await work({ root, data, options, prepared, runOptions });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

function fakeTransport(onInvoke) {
    return {
        binding: { mode: "synthetic-test", httpAttemptCounts: "unavailable" },
        inspect(p, arm) {
            return {
                outputLimit: 4000,
                body: {
                    messages: messages(p),
                    temperature: 1,
                    max_completion_tokens: 4000,
                    response_format: {
                        type: "json_schema",
                        json_schema: responseSchema(p, arm),
                    },
                },
            };
        },
        async invoke(p, arm, signal) {
            signal.throwIfAborted();
            return onInvoke
                ? onInvoke(p, arm)
                : {
                      rawText: JSON.stringify(
                          arm === "luna-choice"
                              ? choices(p)
                              : { answers: p.nativeAnswers },
                      ),
                  };
        },
    };
}

test("native shape follows each observed confidence profile; choice ablation preserves caller bytes", () => {
    for (const p of [packet("editorial", 0), packet("editorial", 1)]) {
        validatePacket(p, normalize);
        const full = responseSchema(p, "luna-full");
        const choice = responseSchema(p, "luna-choice");
        const shape = full.schema.properties.answers.properties.q;
        assert.equal(
            Object.hasOwn(shape.properties, "confidence"),
            Object.hasOwn(p.nativeAnswers.q, "confidence"),
        );
        assert.equal(shape.additionalProperties, false);
        assert.deepEqual(shape.properties.probabilities.required, [
            "yes",
            "no",
            "uncertain",
        ]);
        assert.deepEqual(
            choice.schema.properties.answers.properties.q.required,
            ["type", "choice"],
        );
        assert.deepEqual(messages(p), messages(structuredClone(p)));
        assert.equal(messages(p)[1].content, p.requestJson);
        assert.ok(!messages(p)[1].content.includes("nativeAnswers"));
        assert.deepEqual(
            validateAnswer(
                p,
                "luna-full",
                { answers: p.nativeAnswers },
                normalize,
            ),
            { q: "yes" },
        );
        assert.deepEqual(
            validateAnswer(p, "luna-choice", choices(p), normalize),
            { q: "yes" },
        );
    }
});

test("strict output checking rejects missing/extra keys, confidence drift and invalid distributions without repair", () => {
    const p = packet();
    const mutations = [
        (v) => {
            v.answers.extra = v.answers.q;
        },
        (v) => {
            delete v.answers.q;
        },
        (v) => {
            v.metadata = "invented";
        },
        (v) => {
            v.answers.q.choice = "other";
        },
        (v) => {
            v.answers.q.reason = "not allowed";
        },
        (v) => {
            delete v.answers.q.confidence;
        },
        (v) => {
            v.answers.q.confidence = 1.1;
        },
        (v) => {
            v.answers.q.probabilities.yes = 0.7;
        },
        (v) => {
            v.answers.q.probabilities.no = -0.1;
        },
        (v) => {
            delete v.answers.q.probabilities.no;
        },
    ];
    for (const mutate of mutations) {
        const value = { answers: structuredClone(p.nativeAnswers) };
        mutate(value);
        const before = JSON.stringify(value);
        assert.throws(() => validateAnswer(p, "luna-full", value, normalize));
        assert.equal(JSON.stringify(value), before);
    }
    assert.throws(() =>
        validateAnswer(
            p,
            "luna-choice",
            { answers: p.nativeAnswers },
            normalize,
        ),
    );
    const noConfidence = packet("utility", 1);
    assert.throws(() =>
        validateAnswer(
            noConfidence,
            "luna-full",
            {
                answers: {
                    q: { ...noConfidence.nativeAnswers.q, confidence: 0.5 },
                },
            },
            normalize,
        ),
    );
});

test("request scope rejects wrong family/type and altered literal inputs", () => {
    for (const change of [
        (p) => {
            p.family = "writer";
        },
        (p) => {
            p.requestJson += " ";
        },
        (p) => {
            p.sourceGroups = [];
        },
        (p) => {
            p.requestJson = JSON.stringify({
                state: "data",
                questions: {
                    q: { type: "noul", instructions: "x", criteria: {} },
                },
            });
            p.requestHash = sha256(p.requestJson);
        },
    ]) {
        const p = packet();
        change(p);
        assert.throws(() => validatePacket(p, normalize));
    }
});

test("native sum tolerance is enforced at 1e-6 and special question IDs survive unchanged", () => {
    const p = packet();
    const close = { answers: structuredClone(p.nativeAnswers) };
    close.answers.q.probabilities.yes += 0.0000005;
    assert.deepEqual(validateAnswer(p, "luna-full", close, normalize), {
        q: "yes",
    });
    close.answers.q.probabilities.yes += 0.000002;
    assert.throws(() => validateAnswer(p, "luna-full", close, normalize));
    const request = JSON.parse(p.requestJson);
    request.questions = Object.fromEntries([
        ["__proto__", request.questions.q],
    ]);
    p.requestJson = JSON.stringify(request);
    p.requestHash = sha256(p.requestJson);
    p.nativeAnswers = Object.fromEntries([["__proto__", p.nativeAnswers.q]]);
    delete p.labels;
    const result = validateAnswer(
        p,
        "luna-full",
        { answers: p.nativeAnswers },
        normalize,
    );
    assert.equal(Object.hasOwn(result, "__proto__"), true);
    assert.equal(result["__proto__"], "yes");
});

test("freeze balances family sizes and arm positions without mixing cohorts", () => {
    const data = inventory();
    const frozen = freezeProtocol(data, identity(data), "fixed-seed");
    assert.deepEqual(
        frozen,
        freezeProtocol(data, identity(data), "fixed-seed"),
    );
    assert.equal(frozen.pilot.length, 24);
    assert.equal(frozen.confirmation.length, 12);
    assert.equal(frozen.confirmationKind, "source-disjoint");
    const plan = schedule(frozen);
    assert.equal(plan.length, 327);
    for (const family of families) {
        assert.ok(frozen.pilot.includes(`${family}-0`));
        assert.ok(frozen.pilot.includes(`${family}-5`));
    }
    for (const id of frozen.pilot)
        for (const arm of arms) {
            const rows = plan.filter(
                (row) => row.phase === "pilot" && row.id === id,
            );
            assert.deepEqual(
                [0, 1, 2].map(
                    (position) =>
                        rows.filter(
                            (row, index) =>
                                index % 3 === position && row.arm === arm,
                        ).length,
                ),
                [1, 1, 1],
            );
        }
    data.packets.forEach((p) => {
        p.sourceGroups = ["shared"];
    });
    assert.equal(
        freezeProtocol(data, identity(data), "fixed-seed").confirmationKind,
        "additional-diagnostic",
    );
    data.packets[0].cohort = "other-wrapper";
    assert.throws(
        () => freezeProtocol(data, identity(data), "fixed-seed"),
        /cohorts/,
    );
});

test("archive provenance binds byte hashes and actual request/answer pointers", async () => {
    await fixture(async ({ root, data, options }) => {
        const loaded = await loadInventory(
            options.inventory,
            options.inventoryHash,
            normalize,
        );
        assert.equal(loaded.packets.length, 36);
        await assert.rejects(
            loadInventory(options.inventory, "0".repeat(64), normalize),
            /byte hash/,
        );
        await writeFile(path.join(root, data.packets[0].origin.file), "{}");
        await assert.rejects(
            loadInventory(options.inventory, options.inventoryHash, normalize),
            /Archive byte hash/,
        );
    });
});

test("changed archive pointers and frozen protocol are rejected before model initialization", async () => {
    await fixture(async ({ root, data, options, runOptions }) => {
        data.packets[0].origin.requestPointer = "/answers";
        const bytes = JSON.stringify(data);
        await writeFile(options.inventory, bytes);
        await assert.rejects(
            loadInventory(options.inventory, sha256(bytes), normalize),
            /Archived caller request/,
        );
        const protocol = JSON.parse(
            await readFile(runOptions.protocol, "utf8"),
        );
        protocol.wrapper = "changed";
        const changed = JSON.stringify(protocol);
        const filename = path.join(root, "changed-protocol.json");
        await writeFile(filename, changed);
        await assert.rejects(
            runReplay(
                {
                    ...runOptions,
                    inventoryHash: sha256(bytes),
                    protocol: filename,
                    protocolHash: sha256(changed),
                },
                {
                    normalize,
                    createTransport: () => {
                        throw new Error("Must not initialize");
                    },
                },
            ),
            /Archived caller request/,
        );
        data.packets[0].origin.requestPointer = "/request";
        await writeFile(options.inventory, JSON.stringify(data));
        const inventoryHash = sha256(await readFile(options.inventory));
        await assert.rejects(
            runReplay(
                {
                    ...runOptions,
                    inventoryHash,
                    protocol: filename,
                    protocolHash: sha256(changed),
                },
                {
                    normalize,
                    createTransport: () => {
                        throw new Error("Must not initialize");
                    },
                },
            ),
            /Protocol changed/,
        );
    });
});

test("complete offline injected run persists every request/outcome; invalid packets remain in attempted denominators", async () => {
    await fixture(async ({ runOptions }) => {
        let calls = 0;
        const report = await runReplay(runOptions, {
            normalize,
            createTransport: async () =>
                fakeTransport((p, arm) => {
                    calls++;
                    if (calls > 3 && arm === "luna-full") {
                        const bad = structuredClone(p.nativeAnswers);
                        bad.q.probabilities.yes = 0.5;
                        return { rawText: JSON.stringify({ answers: bad }) };
                    }
                    return {
                        rawText: JSON.stringify(
                            arm === "luna-choice"
                                ? choices(p)
                                : { answers: p.nativeAnswers },
                        ),
                    };
                }),
        });
        assert.equal(report.state, "diagnostic-complete");
        assert.equal(calls, 327);
        assert.equal(report.panels.all.arms["luna-full"].attemptedPackets, 108);
        assert.equal(report.panels.all.arms["luna-full"].validPackets, 0);
        assert.equal(report.panels.all.arms["luna-full"].jsonValidPackets, 108);
        assert.equal(
            report.panels.all.arms["luna-full"].schemaValidPackets,
            108,
        );
        assert.equal(
            report.panels.all.arms["luna-full"].nativeContractValidPackets,
            0,
        );
        assert.ok(
            report.panels.all.arms["luna-full"].failures.every(
                (row) => row.failureStage === "native-contract",
            ),
        );
        assert.equal(report.panels.all.schemaOnly.attemptedPairs, 108);
        assert.equal(report.panels.all.schemaOnly.validPairs, 0);
        assert.ok(report.panels.all.schemaOnly.allAttemptLatencyRatio > 0);
        assert.equal(report.candidateQualified, false);
        assert.equal(report.hostConsequences.state, "unavailable");
        const files = await readdir(runOptions.output);
        assert.equal(
            files.filter((file) => file.endsWith("-result.json")).length,
            327,
        );
        await assert.rejects(
            runReplay(
                { ...runOptions, output: `${runOptions.output}-second` },
                {
                    normalize,
                    createTransport: () => {
                        throw new Error("Must not initialize twice");
                    },
                },
            ),
            /EEXIST/,
        );
    });
});

test("explicit approval, deadline and call caps are enforced before dispatch", async () => {
    await fixture(async ({ runOptions }) => {
        let initialized = 0;
        const dependencies = {
            normalize,
            createTransport: async () => {
                initialized++;
                return fakeTransport();
            },
        };
        for (const override of [
            { live: false },
            { deadline: "invalid" },
            { deadline: new Date(Date.now() - 1).toISOString() },
            { deadline: new Date(Date.now() + 91 * 60_000).toISOString() },
            { maxCalls: 361 },
        ])
            await assert.rejects(
                runReplay({ ...runOptions, ...override }, dependencies),
            );
        assert.equal(initialized, 0);
        const report = await runReplay(
            { ...runOptions, maxCalls: 4 },
            dependencies,
        );
        assert.equal(report.logicalCalls, 4);
        assert.equal(report.state, "incomplete");
        assert.equal(report.stopReason, "logical-call-cap");
    });
});

test("failed preflight is retained; no scored packets dispatch", async () => {
    await fixture(async ({ runOptions }) => {
        const report = await runReplay(runOptions, {
            normalize,
            createTransport: async () =>
                fakeTransport(() => ({ rawText: "not JSON" })),
        });
        assert.equal(report.logicalCalls, 3);
        assert.equal(report.completedScoredCalls, 0);
        assert.equal(report.stopReason, "preflight-failed");
    });
});

test("terminal provider failure and setup failure produce incomplete receipts, not success", async () => {
    await fixture(async ({ runOptions }) => {
        const report = await runReplay(runOptions, {
            normalize,
            createTransport: async () =>
                fakeTransport(() => ({
                    failure: { success: false, code: "authentication" },
                    terminal: true,
                })),
        });
        assert.equal(report.logicalCalls, 1);
        assert.equal(report.stopReason, "provider-failure");
    });
    await fixture(async ({ runOptions }) => {
        await assert.rejects(
            runReplay(runOptions, {
                normalize,
                createTransport: () => {
                    throw new Error("Configuration missing");
                },
            }),
            /Configuration missing/,
        );
        const report = JSON.parse(
            await readFile(path.join(runOptions.output, "scorecard.json")),
        );
        assert.equal(report.state, "incomplete");
        assert.equal(report.stopReason, "setup-or-persistence-failure");
    });
});

test("cancellation prevents dispatch and wire mismatches cannot enter the comparison", async () => {
    await fixture(async ({ runOptions }) => {
        const controller = new AbortController();
        controller.abort();
        let dispatched = 0;
        await assert.rejects(
            runReplay(
                { ...runOptions, signal: controller.signal },
                {
                    normalize,
                    createTransport: async () =>
                        fakeTransport(() => {
                            dispatched++;
                        }),
                },
            ),
        );
        assert.equal(dispatched, 0);
    });
    await fixture(async ({ runOptions }) => {
        const transport = fakeTransport();
        const inspect = transport.inspect;
        transport.inspect = (p, arm) => {
            const value = inspect(p, arm);
            if (arm === "luna-choice") value.body.temperature = 0;
            return value;
        };
        await assert.rejects(
            runReplay(runOptions, {
                normalize,
                createTransport: async () => transport,
            }),
            /wire settings/,
        );
    });
});

test("SDK transport uses actual schema wire and preserves observed metadata", async () => {
    let callback;
    const p = packet();
    const client = {
        createDecisionModel: () => ({
            success: true,
            data: {
                provider: "azure",
                model: "decision-1",
                decide: async () => ({
                    success: true,
                    data: {
                        answers: p.nativeAnswers,
                        reportedModel: "native-test",
                    },
                }),
            },
        }),
        openai: {
            GPT_6_LUNA: "gpt-6-luna",
            getChatModelSettings: () => ({ provider: "azure" }),
            createChatModel(_alias, completionSettings, onCompletion) {
                assert.equal(
                    completionSettings.response_format?.type,
                    "json_object",
                );
                callback = onCompletion;
                const body = (prompt, schema) => ({
                    messages: prompt,
                    response_format: {
                        type: "json_schema",
                        json_schema: schema,
                    },
                    max_completion_tokens: 4000,
                    temperature: 1,
                });
                return {
                    completionSettings,
                    inspectRequest: (prompt, schema) => ({
                        serializedRequest: JSON.stringify(body(prompt, schema)),
                        estimatedInputTokens: 100,
                    }),
                    async complete(prompt, usage, schema) {
                        const response = {
                            model: "gpt-test",
                            usage: { prompt_tokens: 1 },
                        };
                        callback(body(prompt, schema), response);
                        usage(response.usage);
                        return {
                            success: true,
                            data: JSON.stringify({ answers: p.nativeAnswers }),
                        };
                    },
                };
            },
        },
    };
    const transport = await sdkTransport(client);
    const inspection = transport.inspect(p, "luna-full");
    const result = await transport.invoke(
        p,
        "luna-full",
        new AbortController().signal,
        inspection,
    );
    assert.equal(result.reportedModel, "gpt-test");
    assert.equal(result.usage.prompt_tokens, 1);
    const native = await transport.invoke(
        p,
        "native",
        new AbortController().signal,
    );
    assert.equal(native.nativeReceipt.reportedModel, "native-test");
});

test("scorecard separates preflight, incomplete repeats, source labels and agreement", () => {
    const data = inventory(),
        protocol = freezeProtocol(data, identity(data), "fixed");
    const p = data.packets[0];
    const report = scorecard(data, protocol, [
        {
            phase: "preflight",
            id: p.id,
            arm: "native",
            repetition: 0,
            status: "valid",
            durationMs: 1,
            choices: { q: "yes" },
        },
        ...arms.map((arm) => ({
            phase: "pilot",
            id: p.id,
            arm,
            repetition: 0,
            status: "valid",
            durationMs: 10,
            choices: { q: "yes" },
        })),
    ]);
    assert.equal(report.panels.all.nativeVsFull.agreements, 1);
    assert.equal(
        report.panels.all.arms.native.repeatability.completeValidPackets,
        0,
    );
    assert.equal(
        report.panels.all.arms.native.labelComparisons[0].kind,
        "deterministic-control",
    );
    assert.equal(report.state, "incomplete");
});
