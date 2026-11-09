// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import {
    openai,
    type ChatModel,
    type StructuredOutputJsonSchema,
} from "@typeagent/aiclient";
import { createConfiguredViewSynthesisAdapter } from "../src/viewSynthesis.js";
import { hydrateSchemaAnswers } from "../src/schemaViewSynthesis.js";
import {
    resolveViewMaintenance,
    type MaintenanceSource,
} from "../src/viewMaintenance.js";
import type {
    ViewBuildSnapshot,
    ViewSupportReport,
    ViewSynthesisAdapter,
} from "../src/viewTypes.js";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

type Limits = {
    inputTokens?: number;
    contextTokens?: number;
    outputTokens?: number;
};
const signal = () => new AbortController().signal;
const answers = () => ({ answers: [{ slotId: "status", candidates: [] }] });

function snapshot(characters = 100): ViewBuildSnapshot {
    return {
        corpusId: "corpus",
        actor: "offline",
        expectedVersion: 0,
        bounds: {},
        pipeline: "schema-defined-v1",
        model: "offline",
        fingerprint: "frozen",
        definition: {
            viewId: "status",
            kind: "schemaView",
            selector: {
                kind: "sources",
                sources: ["first", "last"].map((sourceId) => ({
                    sourceId,
                    revisionId: "r1",
                })),
            },
            schemaView: {
                construction: "schema-defined-v1",
                title: "Status",
                template: "questions-v1",
                discovery: { enabled: false, maxProposals: 0 },
                slots: [
                    {
                        id: "status",
                        question: "What status is reported?",
                        cardinality: "singleton",
                        schema: { type: "string" },
                        rubric: {
                            version: 1,
                            selection: "mostRecent",
                            requireConfirmation: false,
                            authoritySourceIds: [],
                        },
                        approval: "approved",
                        discoveryCitations: [],
                    },
                ],
            },
        },
        inputs: ["first", "last"].map((sourceId) => ({
            sourceId,
            revisionId: "r1",
            title: sourceId,
            content: `${sourceId}: all original evidence. ${"é".repeat(characters)}`,
            contentHash: sourceId,
        })),
    };
}

function fixture(
    options: { constraints?: Limits | null; responses?: unknown[] } = {},
) {
    const model = openai.createChatModel(
        {
            provider: "azure",
            modelType: openai.ModelType.Chat,
            apiKey: "synthetic-key",
            endpoint: "https://synthetic.invalid/schema-request-admission",
            supportsResponseFormat: true,
            requestConstraints:
                options.constraints === null
                    ? undefined
                    : (options.constraints ?? {
                          inputTokens: 2000000,
                          contextTokens: 2200000,
                          outputTokens: 16000,
                      }),
        },
        { response_format: { type: "json_object" } },
    );
    const inspections: Array<{
        messages: Parameters<ChatModel["complete"]>[0];
        schema: StructuredOutputJsonSchema;
        result: ReturnType<NonNullable<ChatModel["inspectRequest"]>>;
    }> = [];
    const calls: Array<{
        messages: Parameters<ChatModel["complete"]>[0];
        schema: StructuredOutputJsonSchema;
    }> = [];
    const inspect = model.inspectRequest!.bind(model);
    model.inspectRequest = (messages, schema) => {
        if (!schema || Array.isArray(schema))
            throw new Error("Expected structured schema");
        const result = inspect(messages, schema);
        inspections.push({
            messages: structuredClone(messages),
            schema: structuredClone(schema),
            result,
        });
        return result;
    };
    model.complete = async (messages, _usage, schema) => {
        if (typeof messages === "string" || !schema || Array.isArray(schema))
            throw new Error("Expected complete structured wire request");
        calls.push({
            messages: structuredClone(messages),
            schema: structuredClone(schema),
        });
        let response: unknown;
        if (options.responses)
            response =
                options.responses[
                    Math.min(calls.length - 1, options.responses.length - 1)
                ];
        else if (schema.name === "schema_view_answers") response = answers();
        else {
            const payload = JSON.parse(String(messages[1].content));
            response = {
                supported: true,
                sections: payload.output.content.sections.map(
                    (section: { id: string }) => ({
                        sectionId: section.id,
                        supported: true,
                        reason: "Offline exact evidence",
                    }),
                ),
                relationships: [],
                missingContext: [],
                reasons: [],
            };
        }
        return { success: true, data: JSON.stringify(response) };
    };
    return {
        model,
        inspect,
        inspections,
        calls,
        adapter: createConfiguredViewSynthesisAdapter(undefined, 4000, model),
    };
}

test("configured schema generation above 120K retains every full source and inspects exact dispatch framing", async () => {
    const f = fixture();
    const input = snapshot(70000);
    await f.adapter.schemaRequestAdmission!.validate(input);
    const output = await f.adapter.generate(input, signal());
    await f.adapter.validate(input, output, signal());
    expect(f.adapter.identity).toContain("evidence-first-v23");
    expect(f.calls).toHaveLength(2);
    expect(f.inspections).toHaveLength(3);
    expect(f.inspections[0].result.serializedRequest).toBe(
        f.inspections[1].result.serializedRequest,
    );
    for (const [index, call] of f.calls.entries()) {
        const inspected = f.inspections[index + 1];
        expect(inspected.messages).toEqual(call.messages);
        expect(inspected.schema).toEqual(call.schema);
        expect(inspected.result.constraints).toMatchObject({
            metadata: "configured",
            outputTokens: 16000,
            safetyTokens: 1000,
        });
        const serialized = inspected.result.serializedRequest;
        for (const source of input.inputs)
            expect(serialized).toContain(source.content);
        expect(serialized).toContain('"response_format"');
        expect(serialized).toContain(JSON.stringify(call.schema.schema));
    }
});

test("configured boundaries include complete schema, reserved output and safety, not just source characters", async () => {
    const input = snapshot();
    const reference = fixture({
        constraints: {
            inputTokens: 2000000,
            contextTokens: 2200000,
            outputTokens: 256,
        },
    });
    await reference.adapter.schemaRequestAdmission!.validate(input);
    const inspected = reference.inspections[0];
    const { inputTokens, outputTokens, safetyTokens } =
        inspected.result.constraints;
    const withoutSchema = reference.inspect(inspected.messages);
    expect(withoutSchema.constraints.inputTokens).toBeLessThan(inputTokens);
    const exact = fixture({
        constraints: {
            inputTokens,
            outputTokens,
            contextTokens: inputTokens + outputTokens + safetyTokens,
        },
    });
    await expect(
        exact.adapter.generate(input, signal()),
    ).resolves.toBeDefined();
    expect(exact.calls).toHaveLength(1);
    for (const constraints of [
        { inputTokens: inputTokens - 1, outputTokens, contextTokens: 2200000 },
        {
            inputTokens,
            outputTokens,
            contextTokens: inputTokens + outputTokens + safetyTokens - 1,
        },
        {
            inputTokens: withoutSchema.constraints.inputTokens,
            outputTokens,
            contextTokens: 2200000,
        },
    ]) {
        const blocked = fixture({ constraints });
        await expect(blocked.adapter.generate(input, signal())).rejects.toThrow(
            "exceeds configured provider request constraints",
        );
        expect(blocked.calls).toHaveLength(0);
    }
});

test.each([
    "missing-inspector",
    "missing-metadata",
    "empty-constraints",
    "output-only",
    "missing-declared-limits",
    "invalid-declared-input",
    "invalid-declared-context",
    "declared-input-overrun",
    "declared-context-overrun",
    "unknown-metadata",
    "missing-output",
    "unknown-accounting",
])("%s fails closed before schema completion", async (failure) => {
    const f = fixture(
        failure === "missing-metadata"
            ? { constraints: null }
            : failure === "empty-constraints"
              ? { constraints: {} }
              : failure === "output-only"
                ? { constraints: { outputTokens: 16000 } }
                : {},
    );
    if (failure === "missing-inspector") delete f.model.inspectRequest;
    else if (failure !== "missing-metadata") {
        const inspect = f.model.inspectRequest!.bind(f.model);
        f.model.inspectRequest = (...args) => {
            const result = inspect(...args);
            if (failure === "unknown-metadata")
                result.constraints.metadata = "unknown" as "missing";
            if (failure === "missing-output")
                result.constraints.outputTokens = 0;
            if (failure === "missing-declared-limits")
                delete result.constraints.declaredLimits;
            if (failure === "invalid-declared-input")
                result.constraints.declaredLimits = {
                    inputTokens: Number.NaN,
                    contextTokens: 2200000,
                };
            if (failure === "invalid-declared-context")
                result.constraints.declaredLimits = {
                    inputTokens: 2000000,
                    contextTokens: Number.POSITIVE_INFINITY,
                };
            if (failure === "declared-input-overrun")
                result.constraints.declaredLimits = { inputTokens: 1 };
            if (failure === "declared-context-overrun")
                result.constraints.declaredLimits = {
                    contextTokens: result.constraints.inputTokens,
                };
            if (failure === "unknown-accounting")
                result.constraints.tokenAccounting =
                    "unknown" as "utf8-byte-upper-bound";
            return result;
        };
    }
    await expect(f.adapter.generate(snapshot(), signal())).rejects.toThrow(
        /requires complete configured model request inspection|requires configured complete-request constraints|requires positive declared input\/context|output.*(reservation|bound|limit)/i,
    );
    expect(f.calls).toHaveLength(0);
});

test.each(["input", "context"])(
    "a declared %s ceiling alone provides bounded schema admission without inventing the other",
    async (kind) => {
        const f = fixture({
            constraints:
                kind === "input"
                    ? { inputTokens: 2000000, outputTokens: 16000 }
                    : { contextTokens: 2200000, outputTokens: 16000 },
        });
        await expect(
            f.adapter.generate(snapshot(70000), signal()),
        ).resolves.toBeDefined();
        expect(f.calls).toHaveLength(1);
        expect(f.inspections[0].result.constraints.declaredLimits).toEqual(
            kind === "input"
                ? { inputTokens: 2000000 }
                : { contextTokens: 2200000 },
        );
    },
);

test.each(["output-only", "missing-metadata", "missing-declared-limits"])(
    "large schema %s cannot bypass admission at snapshot, generation, audit or support repair",
    async (mode) => {
        const f = fixture({
            constraints:
                mode === "missing-metadata"
                    ? null
                    : mode === "output-only"
                      ? { outputTokens: 16000 }
                      : { inputTokens: 2000000, outputTokens: 16000 },
        });
        if (mode === "missing-declared-limits") {
            const inspect = f.model.inspectRequest!.bind(f.model);
            f.model.inspectRequest = (...args) => {
                const result = inspect(...args);
                delete result.constraints.declaredLimits;
                return result;
            };
        }
        const input = snapshot(70000);
        const output = hydrateSchemaAnswers(input, answers());
        const report: ViewSupportReport = {
            supported: false,
            sections: [],
            relationships: [],
            missingContext: [],
            reasons: ["Verify exact evidence"],
        };
        for (const invoke of [
            () => f.adapter.schemaRequestAdmission!.validate(input),
            () => f.adapter.generate(input, signal()),
            () => f.adapter.validate(input, output, signal()),
            () =>
                f.adapter.repairSchemaAnswers!(input, output, report, signal()),
        ]) {
            await expect(
                Promise.resolve().then(async () => {
                    await invoke();
                }),
            ).rejects.toThrow(
                /requires configured complete-request constraints|requires positive declared input\/context/,
            );
        }
        expect(f.calls).toHaveLength(0);
    },
);

test("an oversized final artifact is rejected before a support-audit model call", async () => {
    const f = fixture({
        constraints: {
            inputTokens: 40000,
            contextTokens: 50000,
            outputTokens: 256,
        },
    });
    const input = snapshot();
    const output = hydrateSchemaAnswers(input, answers());
    output.content.title = "Proposed artifact ".repeat(12000);
    await expect(f.adapter.validate(input, output, signal())).rejects.toThrow(
        "exceeds configured provider request constraints",
    );
    expect(f.calls).toHaveLength(0);
});

test("structural repair inspects the full rejected response before another model call", async () => {
    const f = fixture({
        constraints: {
            inputTokens: 40000,
            contextTokens: 50000,
            outputTokens: 256,
        },
        responses: [{ answers: [], rejectedDiagnostics: "x".repeat(100000) }],
    });
    await expect(f.adapter.generate(snapshot(), signal())).rejects.toThrow(
        "exceeds configured provider request constraints",
    );
    expect(f.calls).toHaveLength(1);
});

test("support repair inspects every original passage and the full support report", async () => {
    const f = fixture({
        constraints: {
            inputTokens: 40000,
            contextTokens: 50000,
            outputTokens: 256,
        },
    });
    const input = snapshot();
    const output = hydrateSchemaAnswers(input, answers());
    const report: ViewSupportReport = {
        supported: false,
        sections: [],
        relationships: [],
        missingContext: [],
        reasons: ["x".repeat(100000)],
    };
    await expect(
        f.adapter.repairSchemaAnswers!(input, output, report, signal()),
    ).rejects.toThrow("exceeds configured provider request constraints");
    expect(f.calls).toHaveLength(0);
});

test("admitted structural and support repairs inspect their exact complete request and retain all evidence", async () => {
    const input = snapshot(70000);
    const f = fixture({ responses: [{ answers: [] }, answers(), answers()] });
    const output = await f.adapter.generate(input, signal());
    await f.adapter.repairSchemaAnswers!(
        input,
        output,
        {
            supported: false,
            sections: [],
            relationships: [],
            missingContext: [],
            reasons: ["Verify exact evidence"],
        },
        signal(),
    );
    expect(f.calls).toHaveLength(3);
    expect(f.inspections).toHaveLength(3);
    for (const [index, call] of f.calls.entries()) {
        expect(f.inspections[index].messages).toEqual(call.messages);
        expect(f.inspections[index].schema).toEqual(call.schema);
        for (const source of input.inputs)
            expect(f.inspections[index].result.serializedRequest).toContain(
                source.content,
            );
    }
});

test("planner bypass is schema-only and requires the explicit complete-request capability; source limits remain", () => {
    const input = snapshot(70000);
    const definition = {
        ...input.definition,
        maintenance: {
            schemaVersion: 1 as const,
            scope: {
                mode: "currentSources" as const,
                sourceIds: ["first", "last"],
            },
        },
    };
    const sources: MaintenanceSource[] = input.inputs.map((source) => ({
        sourceId: source.sourceId,
        corpusId: "corpus",
        sourceType: "text",
        title: source.title,
        activeRevisionId: source.revisionId,
        revisions: [
            {
                revisionId: source.revisionId,
                content: source.content,
                state: "ready",
                contentHash: "hash",
                pipelineVersion: "1",
            },
        ],
    }));
    const capability = fixture().adapter.schemaRequestAdmission;
    expect(
        resolveViewMaintenance(definition, sources, "model", {}).reason,
    ).toContain("120000");
    expect(
        resolveViewMaintenance(
            definition,
            sources,
            "model",
            {},
            undefined,
            undefined,
            capability,
        ).state,
    ).toBe("rebuild");
    expect(
        resolveViewMaintenance(
            { ...definition, kind: "troubleshootingGuide" },
            sources,
            "model",
            {},
            undefined,
            undefined,
            capability,
        ).reason,
    ).toContain("120000");
    expect(
        resolveViewMaintenance(
            definition,
            sources,
            "model",
            {},
            undefined,
            undefined,
            {
                kind: "unqualified" as "configured-complete-request-v1",
                validate() {},
            },
        ).reason,
    ).toContain("120000");
    expect(
        resolveViewMaintenance(
            {
                ...definition,
                maintenance: {
                    schemaVersion: 1,
                    scope: { mode: "scopedSources" },
                },
            },
            Array.from({ length: 33 }, (_unused, index) => ({
                ...sources[0],
                sourceId: `source-${index}`,
            })),
            "model",
            {},
            undefined,
            undefined,
            capability,
        ).reason,
    ).toContain("32");
});

async function serviceFixture(adapter: ViewSynthesisAdapter) {
    const root = await mkdtemp(
        path.join(process.cwd(), ".schema-request-admission-"),
    );
    const service = new FileMemoryService(root, {
        maintenanceMode: "manual",
        automaticKnowledgeDiscovery: false,
        informationalViews: false,
        sourceSynopses: false,
        viewSynthesisAdapter: adapter,
        indexFactory: (_corpusId, directory) =>
            new FakeSemanticCorpusIndex(directory),
    });
    try {
        const { corpusId } = await service.createCorpus(
            "Complete schema admission",
        );
        const input = snapshot(70000);
        const sources = [];
        for (const source of input.inputs) {
            const admitted = await service.ingestDocument({
                corpusId,
                source: {
                    sourceId: source.sourceId,
                    sourceType: "text",
                    title: source.title,
                    text: source.content,
                },
            });
            expect(
                (await waitForMemoryJob(service, admitted.jobId)).state,
            ).toBe("complete");
            sources.push({
                sourceId: admitted.sourceId,
                revisionId: admitted.revisionId,
            });
        }
        return {
            service,
            root,
            corpusId,
            input,
            definition: {
                ...input.definition,
                selector: { kind: "sources" as const, sources },
            },
        };
    } catch (error) {
        await service.close();
        await rm(root, { recursive: true, force: true });
        throw error;
    }
}

test("production snapshot and maintenance planner admit complete schema inputs only after configured inspection", async () => {
    const f = fixture();
    const context = await serviceFixture(f.adapter);
    const { service, root, corpusId, definition } = context;
    definition.maintenance = {
        schemaVersion: 1,
        scope: { mode: "currentSources", sourceIds: ["first", "last"] },
    };
    try {
        const job = await service.buildViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            publication: false,
            targets: [{ definition, expectedVersion: 0 }],
        });
        let latest = job;
        for (
            let count = 0;
            count < 1000 && latest.state === "running";
            count++
        ) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            latest = (await service.getViewBuild(job))!;
        }
        expect(latest.results.map((result) => result.reason)).not.toEqual(
            expect.arrayContaining([
                expect.stringMatching(/120000|exceeds configured/),
            ]),
        );
        expect(latest.state).toBe("complete");
        expect(f.inspections.length).toBeGreaterThanOrEqual(3);
        expect(f.inspections[0].result.serializedRequest).toBe(
            f.inspections[1].result.serializedRequest,
        );
        const plan = await service.planViewMaintenance({
            corpusId,
            viewIds: [definition.viewId],
        });
        expect(plan.targets[0].state).not.toBe("blocked");
        for (const original of context.input.inputs)
            expect(f.inspections[1].result.serializedRequest).toContain(
                original.content,
            );
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
}, 30000);

test.each(["legacy-pinned", "legacy-maintained", "configured-over-budget"])(
    "%s blocks before snapshot admission or completion",
    async (mode) => {
        const f = fixture({
            constraints: {
                inputTokens: 40000,
                contextTokens: 50000,
                outputTokens: 256,
            },
        });
        if (mode.startsWith("legacy")) delete f.adapter.schemaRequestAdmission;
        const { service, root, corpusId, definition } = await serviceFixture(
            f.adapter,
        );
        if (mode === "legacy-maintained")
            definition.maintenance = {
                schemaVersion: 1,
                scope: { mode: "currentSources", sourceIds: ["first", "last"] },
            };
        try {
            await expect(
                service.buildViews({
                    corpusId,
                    expectedHead: (await service.listViews(corpusId)).head,
                    publication: false,
                    targets: [{ definition, expectedVersion: 0 }],
                }),
            ).rejects.toThrow(
                mode.startsWith("legacy")
                    ? /120000/
                    : /exceeds configured provider request constraints/,
            );
            expect(f.calls).toHaveLength(0);
            expect(await service.listViewBuilds(corpusId)).toHaveLength(0);
        } finally {
            await service.close();
            await rm(root, { recursive: true, force: true });
        }
    },
    30000,
);
