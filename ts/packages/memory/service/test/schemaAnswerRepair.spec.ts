// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ChatModel } from "@typeagent/aiclient";
import {
    createConfiguredViewSynthesisAdapter,
    validateConstructedGuide,
} from "../src/viewSynthesis.js";
import { hydrateSchemaAnswers } from "../src/schemaViewSynthesis.js";
import { ViewBuildRunner } from "../src/viewBuilds.js";
import type {
    ViewBuildJob,
    ViewBuildSnapshot,
    ViewSupportReport,
    ViewSynthesisOutput,
} from "../src/viewTypes.js";

function snapshot(): ViewBuildSnapshot {
    const inputs = ["08:10", "13:45"].map((time, index) => ({
        sourceId: `log-${index}`,
        revisionId: "revision",
        title: "Workshop log, common local clock",
        content: `Workshop log, common local clock. 2031-04-09 ${time}: active branch is ${index ? "beta" : "alpha"}.`,
        contentHash: `hash-${index}`,
    }));
    return {
        corpusId: "corpus",
        actor: "test",
        expectedVersion: 0,
        bounds: {},
        inputs,
        definition: {
            viewId: "branch",
            kind: "schemaView",
            selector: {
                kind: "sources",
                sources: inputs.map(({ sourceId, revisionId }) => ({
                    sourceId,
                    revisionId,
                })),
            },
            schemaView: {
                construction: "schema-defined-v1",
                title: "Active branch",
                template: "questions-v1",
                discovery: { enabled: false, maxProposals: 0 },
                slots: [
                    {
                        id: "branch",
                        question: "Which branch is active?",
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
        pipeline: "schema-defined-v1",
        model: "offline",
        fingerprint: "frozen",
    };
}

function answers(local = true) {
    return {
        answers: [
            {
                slotId: "branch",
                candidates: ["alpha", "beta"].map((value, index) => ({
                    valueJson: JSON.stringify(value),
                    effectiveAt: "",
                    localTimestamp: local
                        ? `2031-04-09T${index ? "13:45" : "08:10"}`
                        : "",
                    localTimeScope: local
                        ? "Workshop log common local clock"
                        : "",
                    passageIds: [`p${index}-0`],
                    opposingPassageIds: [] as string[],
                })),
            },
        ],
    };
}

function support(
    output: ViewSynthesisOutput,
    supported: boolean,
): ViewSupportReport {
    return {
        supported,
        sections: output.content.sections.map((section) => ({
            sectionId: section.id,
            supported,
            reason: supported
                ? "Exact retained report and chronology"
                : "Missing common local chronology binding",
        })),
        relationships: output.relationships.map((edge) => ({
            edgeId: edge.id,
            supported: true,
            reason: "Exact retained citation",
        })),
        missingContext: [],
        reasons: supported ? [] : ["Repair the source chronology binding"],
    };
}

test("mostRecent orders a common local chronology without inventing a timezone", () => {
    const input = snapshot();
    const output = hydrateSchemaAnswers(input, answers());
    validateConstructedGuide(input, output);
    const details = output.content.sections[0].details;
    if (details?.kind !== "question") throw new Error("Expected question");
    expect(details.answerState).toBe("answered");
    expect(
        details.candidates.find((c) =>
            details.selectedCandidateIds.includes(c.id),
        )?.value,
    ).toBe("beta");
    expect(details.candidates).toHaveLength(2);
    expect(output.content.sections[0].body).toContain(
        "historical observations only, not verified present-day status",
    );
    expect(output.content.sections[0].body).toContain("2031-04-09T13:45");
    expect(output.content.sections[0].body).toContain("timezone unspecified");
    expect(output.content.sections[0].body).toContain(
        "maintenance freshness: current",
    );
    for (const candidate of details.candidates) {
        expect(candidate.effectiveAt).toBeUndefined();
        expect(candidate.localChronology?.timestamp).not.toMatch(/Z|[+-]\d\d:/);
        expect(candidate.opposingCitations).toEqual([]);
        expect(candidate.support[0].localChronology).toEqual(
            candidate.localChronology,
        );
    }
});

test.each(["different-clock", "absolute", "unknown"] as const)(
    "mostRecent leaves %s chronology incomparable",
    (mode) => {
        const raw = answers();
        const second = raw.answers[0].candidates[1];
        if (mode === "different-clock") second.localTimeScope = "Remote clock";
        else {
            second.localTimestamp = "";
            second.localTimeScope = "";
            if (mode === "absolute")
                second.effectiveAt = "2031-04-09T13:45:00Z";
        }
        const output = hydrateSchemaAnswers(snapshot(), raw);
        const details = output.content.sections[0].details;
        expect(details?.kind === "question" && details.answerState).toBe(
            "conflicted",
        );
    },
);

test.each(["local", "mixed", "different-clock"] as const)(
    "coalesced equal values preserve %s support chronology without inventing a common clock",
    (mode) => {
        const input = snapshot();
        const raw = answers();
        const first = raw.answers[0].candidates[0];
        const second = raw.answers[0].candidates[1];
        second.valueJson = first.valueJson;
        if (mode === "mixed") {
            second.localTimestamp = "";
            second.localTimeScope = "";
            second.effectiveAt = "2031-04-09T13:45:00Z";
        }
        if (mode === "different-clock") second.localTimeScope = "Remote clock";
        const output = hydrateSchemaAnswers(input, raw);
        validateConstructedGuide(input, output);
        const details = output.content.sections[0].details;
        if (details?.kind !== "question") throw new Error("Expected question");
        expect(details.candidates).toHaveLength(1);
        const candidate = details.candidates[0];
        expect(candidate.support).toHaveLength(2);
        expect(candidate.effectiveAt).toBeUndefined();
        expect(candidate.localChronology).toEqual(
            mode === "local"
                ? {
                      timestamp: "2031-04-09T13:45",
                      scope: "Workshop log common local clock",
                  }
                : undefined,
        );
        if (mode === "mixed")
            expect(candidate.support[1].effectiveAt).toBe(
                "2031-04-09T13:45:00Z",
            );
    },
);

test.each(["2031-02-30T08:10", "2031-04-09T28:10", "2031-04-09T08:10Z"])(
    "invalid local chronology %s is rejected",
    (timestamp) => {
        const raw = answers();
        raw.answers[0].candidates[0].localTimestamp = timestamp;
        expect(() =>
            validateConstructedGuide(
                snapshot(),
                hydrateSchemaAnswers(snapshot(), raw),
            ),
        ).toThrow(/local chronology/);
    },
);

test.each(["confirmation", "opposition", "independentSupport"] as const)(
    "local chronology does not bypass %s requirements",
    (mode) => {
        const input = snapshot();
        const slot = input.definition.schemaView!.slots[0];
        const raw = answers();
        if (mode === "confirmation") slot.rubric.requireConfirmation = true;
        if (mode === "opposition")
            raw.answers[0].candidates[1].opposingPassageIds = ["p0-0"];
        if (mode === "independentSupport")
            slot.rubric.selection = "independentSupport";
        const output = hydrateSchemaAnswers(input, raw);
        const details = output.content.sections[0].details;
        expect(details?.kind === "question" && details.answerState).toBe(
            mode === "confirmation" ? "pending" : "conflicted",
        );
    },
);

test("an answered question still repairs an unsupported clause in an unselected candidate", async () => {
    const input = snapshot();
    let generations = 0;
    const model: ChatModel = {
        completionSettings: {},
        complete: async (messages, _options, schema) => {
            if (typeof messages === "string")
                throw new Error("Expected labeled messages");
            const payload = JSON.parse(String(messages[1].content));
            if (
                schema &&
                !Array.isArray(schema) &&
                "name" in schema &&
                schema.name === "schema_view_answers"
            ) {
                generations++;
                const raw = answers();
                if (generations === 1)
                    raw.answers[0].candidates[0].valueJson = JSON.stringify(
                        "alpha; no prize decision was made",
                    );
                else {
                    expect(
                        payload.previousArtifact.sections[0].details.candidates,
                    ).toHaveLength(2);
                    expect(payload.supportReport.reasons).toContain(
                        "An unselected candidate's prize assertion is unsupported by its own citations",
                    );
                    expect(String(messages[0].content)).toContain(
                        "narrow/remove only unsupported clauses",
                    );
                }
                return { success: true, data: JSON.stringify(raw) };
            }
            const output: ViewSynthesisOutput = {
                content: payload.output.content,
                relationships: payload.output.relationships,
                outcome: "schemaAnswers",
                missingEvidence: [],
            };
            const supported = !output.content.sections.some(
                (section) =>
                    section.details?.kind === "question" &&
                    section.details.candidates.some((candidate) =>
                        String(candidate.value).includes("prize"),
                    ),
            );
            const report = support(output, supported);
            if (!supported)
                report.reasons.push(
                    "An unselected candidate's prize assertion is unsupported by its own citations",
                );
            return { success: true, data: JSON.stringify(report) };
        },
    };
    const adapter = createConfiguredViewSynthesisAdapter(
        undefined,
        4000,
        model,
    );
    const signal = new AbortController().signal;
    const output = await adapter.generate(input, signal);
    expect(output.content.sections[0].details).toMatchObject({
        answerState: "answered",
    });
    const rejected = await adapter.validate(input, output, signal);
    expect(rejected.supported).toBe(false);
    const repaired = await adapter.repairSchemaAnswers!(
        input,
        output,
        rejected,
        signal,
    );
    validateConstructedGuide(input, repaired);
    expect((await adapter.validate(input, repaired, signal)).supported).toBe(
        true,
    );
    expect(repaired.content.sections[0].details).toMatchObject({
        answerState: "answered",
        candidates: [{ value: "alpha" }, { value: "beta" }],
    });
    expect(generations).toBe(2);
});

test.each(["repaired", "unsupported", "incompleteAudit", "transportFailure"])(
    "configured question repair is bounded and revalidated (%s)",
    async (mode) => {
        const repairSupported = mode === "repaired";
        const input = snapshot();
        let generationCalls = 0;
        let validationCalls = 0;
        const model: ChatModel = {
            completionSettings: {},
            complete: async (messages, _options, schema) => {
                if (typeof messages === "string")
                    throw new Error("Expected labeled messages");
                const payload = JSON.parse(String(messages[1].content));
                if (
                    schema &&
                    !Array.isArray(schema) &&
                    "name" in schema &&
                    schema.name === "schema_view_answers"
                ) {
                    generationCalls++;
                    if (mode === "transportFailure")
                        throw new Error("Synthetic transport failure");
                    if (generationCalls === 2) {
                        expect(payload.input.inputs).toHaveLength(2);
                        expect(payload.previousArtifact.kind).toBe(
                            "schemaView",
                        );
                        expect(payload.supportReport.supported).toBe(false);
                        expect(String(messages[0].content)).toContain(
                            "not evidence",
                        );
                        expect(String(messages[0].content)).toContain(
                            "including unselected and rejected candidates",
                        );
                        expect(String(messages[0].content)).toContain(
                            "candidate's own passageIds",
                        );
                    }
                    return {
                        success: true,
                        data: JSON.stringify(answers(generationCalls > 1)),
                    };
                }
                validationCalls++;
                const report = support(
                    {
                        content: payload.output.content,
                        relationships: payload.output.relationships,
                        outcome: "schemaAnswers",
                        missingEvidence: [],
                    },
                    validationCalls > 1 && repairSupported,
                );
                if (mode === "incompleteAudit") report.sections = [];
                return {
                    success: true,
                    data: JSON.stringify(report),
                };
            },
        };
        const adapter = createConfiguredViewSynthesisAdapter(
            undefined,
            4000,
            model,
        );
        const job: ViewBuildJob = {
            jobId: "job",
            corpusId: input.corpusId,
            fingerprint: input.fingerprint,
            request: {
                corpusId: input.corpusId,
                expectedHead: null,
                targets: [{ definition: input.definition, expectedVersion: 0 }],
                publication: false,
            },
            actor: "test",
            createdAt: "2031-04-09T00:00:00Z",
            updatedAt: "2031-04-09T00:00:00Z",
            state: "running",
            results: [
                {
                    viewId: input.definition.viewId,
                    snapshot: input,
                    state: "pending",
                    reason: "",
                },
            ],
            publication: false,
        };
        let materializations = 0;
        let finish!: () => void;
        const finished = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const runner = new ViewBuildRunner(adapter, {
            update: async (_corpusId, _jobId, update) => {
                update(job);
                if (job.state !== "running") finish();
                return job;
            },
            current: async () => undefined,
            materialize: async (_job, result, candidate) => {
                materializations++;
                expect(candidate.content.sections[0].details).toMatchObject({
                    answerState: "answered",
                });
                result.state = "draft";
            },
        });
        try {
            runner.start(job);
            await finished;
            await runner.close();
            expect(generationCalls).toBe(
                mode === "incompleteAudit" || mode === "transportFailure"
                    ? 1
                    : 2,
            );
            expect(validationCalls).toBe(
                mode === "transportFailure"
                    ? 0
                    : mode === "incompleteAudit"
                      ? 1
                      : repairSupported
                        ? 3
                        : 2,
            );
            expect(materializations).toBe(repairSupported ? 1 : 0);
            expect(job.results[0].state).toBe(
                mode === "transportFailure"
                    ? "failed"
                    : repairSupported
                      ? "draft"
                      : "blocked",
            );
        } finally {
            await runner.close();
        }
    },
);
