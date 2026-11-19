// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { hydrateInformational } from "../src/informationalWiki.js";
import { hydrateProjectSummary } from "../src/informationalProject.js";
import { projectSectionCitations } from "./informationalProjectTestModel.js";
import { indexedLocator } from "../src/indexedFragments.js";
import {
    assertInformationalSupport,
    informationalFields,
    informationalAuditFields,
    InformationalAssessmentError,
    readInformationalAssessment,
} from "../src/informationalSupport.js";
import {
    validateSupport,
    ViewSupportRejection,
    validateOrRepairInformationalOutput,
    createConfiguredViewSynthesisAdapter,
} from "../src/viewSynthesis.js";
import {
    assertPublicationProof,
    publicationProof,
} from "../src/viewPublication.js";
import { ViewBuildRunner } from "../src/viewBuilds.js";
import { wikiIndex } from "../src/viewContent.js";
import { versionRelationships } from "../src/viewRelationships.js";
import type {
    ViewBuildJob,
    ViewBuildSnapshot,
    ViewSupportReport,
    ViewSynthesisOutput,
    ViewVersion,
} from "../src/viewTypes.js";
import { controlledInformationalSupport } from "./informationalSupportTestModel.js";
import type { ChatModel } from "@typeagent/aiclient";

function fixture(project = false) {
    const text =
        "Atlas is an active reference project. Its owner is not identified.";
    const block = {
        sourceId: "source",
        revisionId: "r1",
        blockOrdinal: 0,
        text,
        score: 1,
    };
    const input: ViewBuildSnapshot = {
        corpusId: "corpus",
        actor: "test",
        expectedVersion: 0,
        bounds: {},
        pipeline: project
            ? "informational-project-summary-v1"
            : "informational-wiki-v1",
        model: "test",
        fingerprint: "frozen",
        definition: {
            viewId: "atlas",
            kind: project ? "projectBrief" : "wiki",
            selector: {
                kind: "sources",
                sources: [{ sourceId: "source", revisionId: "r1" }],
            },
            ...(project
                ? {
                      projectSummary: {
                          construction:
                              "informational-project-summary-v1" as const,
                          query: "Atlas",
                          aliases: [],
                          excludedSourceIds: [],
                      },
                  }
                : {
                      wiki: {
                          construction: "informational-wiki-v1" as const,
                          query: "Atlas",
                          aliases: [],
                          excludedSourceIds: [],
                      },
                  }),
        },
        inputs: [
            {
                sourceId: "source",
                revisionId: "r1",
                title: "Atlas",
                content: text,
                contentHash: "frozen-source",
                passages: [
                    {
                        sourceId: "source",
                        revisionId: "r1",
                        locator: indexedLocator(block, 0, text.length),
                        excerpt: text,
                    },
                ],
            },
        ],
    };
    const common = {
        title: "Atlas",
        summary: "Atlas is an active reference project.",
        limits: null,
        citationIds: ["f0"],
    };
    const output = project
        ? hydrateProjectSummary(input, {
              ...common,
              completeness: "partial",
              goalsScope: common.summary,
              owners: "Owner unknown in supplied evidence.",
              status: "Active.",
              milestones: "No milestone identified.",
              decisions: "No decision identified.",
              risks: "No risk identified.",
              context: "Original reference.",
              projectState: "active",
              incidentState: "unknown",
              capacityState: "unknown",
              assignments: [],
              milestoneItems: [],
              decisionItems: [],
              sectionCitationIds: projectSectionCitations(),
              openQuestions: [],
              riskItems: [],
          })
        : hydrateInformational(input, {
              ...common,
              status: "partial",
              prose: common.summary,
          });
    return { input, output };
}

function rejection(output: ViewSynthesisOutput): ViewSupportReport {
    const report = controlledInformationalSupport(output);
    report.supported = false;
    report.informational!.fields.find(
        (field) => field.path === "/content/summary",
    )!.supported = false;
    report.informational!.issues.push({
        category: "unsupported",
        path: "/content/summary",
        quote: output.content.summary!,
        evidenceIds: [],
        reason: "Injected unsupported summary",
        correction: "Use only the original supported project statement.",
    });
    return report;
}

test("configured factual repair preserves every section of a combined wiki", async () => {
    const { input, output } = fixture();
    if (output.content.kind !== "wiki")
        throw new Error("Expected wiki fixture");
    const original = {
        ...output,
        content: {
            ...output.content,
            sections: [
                ...output.content.sections,
                {
                    ...output.content.sections[0],
                    id: "atlas:qualifications",
                    heading: "Qualifications",
                    body: "Its owner is not identified.",
                },
            ],
        },
    };
    const responses: string[] = [];
    original.content.index = wikiIndex(original.content.sections);
    const adapter = createConfiguredViewSynthesisAdapter(undefined, 4000, {
        completionSettings: {},
        complete: async (_messages, _usage, schema) => {
            if (!schema || Array.isArray(schema))
                throw new Error("Expected a structured repair schema");
            responses.push(schema.name);
            return {
                success: true,
                data: JSON.stringify({
                    summary: original.content.summary,
                    sections: original.content.sections.map(({ id, body }) => ({
                        id,
                        body,
                    })),
                }),
            };
        },
    });
    const repaired = await adapter.repairInformationalSupport!(
        input,
        original,
        rejection(original),
        new AbortController().signal,
    );
    expect(responses).toEqual(["wiki_consolidation_repair"]);
    expect(repaired).toEqual(original);
    expect(repaired).not.toBe(original);
});

function wireAssessment(output: ViewSynthesisOutput) {
    return {
        policy: "informational-field-support-v2",
        fields: informationalAuditFields(output)
            .filter((field) => field.authority === "source")
            .map((field) => ({
                fieldId: field.id,
                reason: "Original evidence supports the supplied claims",
                issues: [] as Array<{
                    spanId: string;
                    category: string;
                    evidenceIds: string[];
                    reason: string;
                    correction: string;
                }>,
            })),
    };
}

test("host metadata is separated without exempting nonempty notes or typed project state", () => {
    const { output, input } = fixture();
    const fields = informationalAuditFields(output);
    expect(
        fields
            .filter((field) => field.authority === "host-metadata")
            .map((field) => field.path),
    ).toEqual(["/content/index", "/content/sections/0/details"]);
    expect(
        readInformationalAssessment(output, input, wireAssessment(output))
            .supported,
    ).toBe(true);
    const details = output.content.sections[0].details;
    if (details.kind !== "page") throw new Error("Missing page details");
    details.note = "The owner approved deployment.";
    expect(
        informationalAuditFields(output).find((field) =>
            field.path.endsWith("/details"),
        )!.authority,
    ).toBe("source");
    const project = fixture(true);
    expect(
        informationalAuditFields(project.output).filter(
            (field) => field.authority === "host-metadata",
        ),
    ).toEqual([]);
});

test.each([
    "missing",
    "duplicate",
    "unknown-span",
    "foreign-span",
    "unknown-source",
])("wire report rejects malformed references: %s", (mode) => {
    const { output, input } = fixture();
    const raw = wireAssessment(output);
    const fields = informationalAuditFields(output);
    if (mode === "missing") raw.fields.pop();
    else if (mode === "duplicate") raw.fields.push(raw.fields[0]);
    else
        raw.fields[0].issues.push({
            spanId:
                mode === "unknown-span"
                    ? "invented"
                    : mode === "foreign-span"
                      ? fields[1].spans[0].id
                      : fields[0].spans[0].id,
            category: "state",
            evidenceIds: mode === "unknown-source" ? ["f99"] : ["f0"],
            reason: "Unsupported state",
            correction: "Use the original state",
        });
    expect(() => readInformationalAssessment(output, input, raw)).toThrow(
        InformationalAssessmentError,
    );
});

test("host resolves canonical spans without copying or normalizing quotations", () => {
    const { output, input } = fixture();
    output.content.summary =
        "The latest update says the owner approved deployment.";
    const field = informationalAuditFields(output).find(
        (field) => field.path === "/content/summary",
    )!;
    const raw = wireAssessment(output);
    raw.fields
        .find((entry) => entry.fieldId === field.id)!
        .issues.push({
            spanId: field.spans[0].id,
            category: "state",
            evidenceIds: ["f0"],
            reason: "Approval is not established",
            correction: "Retain the supported unknown owner",
        });
    const report = readInformationalAssessment(output, input, raw);
    expect(report.informational!.issues[0].quote).toBe(output.content.summary);
    expect(() => validateSupport(output, report, input)).toThrow(
        ViewSupportRejection,
    );
});

test.each(["valid", "retry", "repeat", "provider", "abort"])(
    "configured checker bounds contract recovery independently of factual repair: %s",
    async (mode) => {
        const { output, input } = fixture();
        const control = new AbortController();
        const requests: string[] = [];
        const model: ChatModel = {
            completionSettings: {},
            complete: async (messages) => {
                requests.push(JSON.stringify(messages));
                if (mode === "provider")
                    return {
                        success: false,
                        message: "Injected provider failure",
                    };
                if (mode === "abort") {
                    control.abort(new Error("Injected cancellation"));
                    control.signal.throwIfAborted();
                }
                const raw = wireAssessment(output);
                if (
                    mode === "repeat" ||
                    (mode === "retry" && requests.length === 1)
                )
                    raw.fields.pop();
                return { success: true, data: JSON.stringify(raw) };
            },
        };
        const adapter = createConfiguredViewSynthesisAdapter(
            undefined,
            4000,
            model,
        );
        const work = adapter.validate(input, output, control.signal);
        if (mode === "valid" || mode === "retry")
            expect((await work).supported).toBe(true);
        else await expect(work).rejects.toThrow();
        expect(requests).toHaveLength(
            ["retry", "repeat"].includes(mode) ? 2 : 1,
        );
        expect(requests[0]).toContain("capacityState unknown");
        expect(requests[0]).toContain("generic pending review");
        expect(requests[0]).toContain(
            "no more specific enumerated state is supported",
        );
        expect(requests[0]).toContain(
            "internal inference limits, not additional source facts",
        );
        expect(requests[0]).toContain("retain source-supported distinctions");
        if (mode === "retry") expect(requests[1]).toContain("contractError");
        expect(output.content.summary).toBe(
            "Atlas is an active reference project.",
        );
    },
);

test.each([false, true])(
    "factual repair keeps inference constraints separate from source facts: project=%s",
    async (project) => {
        const { input, output } = fixture(project);
        const requests: string[] = [];
        const model: ChatModel = {
            completionSettings: {},
            complete: async (messages) => {
                requests.push(JSON.stringify(messages));
                return {
                    success: false,
                    message: "Controlled repair provider failure",
                };
            },
        };
        const adapter = createConfiguredViewSynthesisAdapter(
            undefined,
            4000,
            model,
        );
        await expect(
            adapter.repairInformationalSupport!(
                input,
                output,
                rejection(output),
                new AbortController().signal,
            ),
        ).rejects.toThrow("Controlled repair provider failure");
        expect(requests).toHaveLength(1);
        expect(requests[0]).toContain(
            "internal inference limits, not additional source facts",
        );
        expect(requests[0]).toContain(
            "Do not add a negative status assertion or generic contrast",
        );
        expect(requests[0]).toContain("retain source-supported distinctions");
    },
);

test.each(["accept", "repair", "repeat", "malformed", "conflict", "abort"])(
    "shared final-output gate used by canonical maintenance preserves bounded repair: %s",
    async (mode) => {
        const { input, output } = fixture();
        const control = new AbortController();
        let audits = 0,
            repairs = 0,
            reprepared = 0;
        const initial = {
            output,
            verification: "initial-editorial-verification",
        };
        const work = validateOrRepairInformationalOutput(
            {
                identity: "synthetic-shared-maintenance",
                generate: async () => {
                    throw new Error("Unused generation");
                },
                validate: async (_input, actual) => {
                    audits++;
                    if (mode === "malformed") {
                        const report = rejection(actual);
                        report.informational!.fields = [];
                        return report;
                    }
                    return mode === "accept" ||
                        (mode !== "repeat" && audits > 1)
                        ? controlledInformationalSupport(actual)
                        : rejection(actual);
                },
                repairInformationalSupport: async (_input, actual) => {
                    repairs++;
                    if (mode === "abort")
                        control.abort(
                            new Error("Controlled maintenance cancellation"),
                        );
                    return structuredClone(actual);
                },
            },
            input,
            initial,
            async (candidate) => {
                reprepared++;
                if (mode === "conflict")
                    throw new Error("Protected maintenance edit conflict");
                return {
                    output: candidate,
                    verification: "rechecked-editorial-verification",
                };
            },
            control.signal,
        );
        if (mode === "accept" || mode === "repair") {
            const result = await work;
            expect(result.prepared.verification).toBe(
                mode === "accept"
                    ? initial.verification
                    : "rechecked-editorial-verification",
            );
        } else await expect(work).rejects.toThrow();
        expect(repairs).toBe(["accept", "malformed"].includes(mode) ? 0 : 1);
        expect(audits).toBe(["repair", "repeat"].includes(mode) ? 2 : 1);
        expect(reprepared).toBe(
            ["repair", "repeat", "conflict"].includes(mode) ? 1 : 0,
        );
        expect(initial.verification).toBe("initial-editorial-verification");
    },
);

test.each([false, true])(
    "informational audit covers summary, typed fields and exact relationships (project=%s)",
    (project) => {
        const { input, output } = fixture(project);
        const report = controlledInformationalSupport(output);
        expect(() => validateSupport(output, report, input)).not.toThrow();
        expect([...informationalFields(output).keys()]).toContain(
            "/content/summary",
        );
        expect([...informationalFields(output).keys()]).toContain(
            "/content/sections/0/details",
        );
        expect([...informationalFields(output).keys()]).toContain(
            "/content/sections/0/heading",
        );
        report.informational!.fields = report.informational!.fields.filter(
            (field) => field.path !== "/content/summary",
        );
        expect(() => validateSupport(output, report, input)).toThrow(
            "every exact field",
        );
    },
);

test.each([
    "missing-policy",
    "duplicate-field",
    "unknown-pointer",
    "invented-quote",
    "unsupplied-evidence",
    "affirmative-rejection",
    "unmatched-issue",
    "undiagnosed-field",
])("malformed informational assessment is not repairable: %s", (mode) => {
    const { input, output } = fixture();
    const report = rejection(output);
    if (mode === "missing-policy") delete report.informational;
    if (mode === "duplicate-field")
        report.informational!.fields.push(report.informational!.fields[0]);
    if (mode === "unknown-pointer")
        report.informational!.issues[0].path = "/invented";
    if (mode === "invented-quote")
        report.informational!.issues[0].quote = "Not in the artifact";
    if (mode === "unsupplied-evidence")
        report.informational!.issues[0].evidenceIds = ["f1"];
    if (mode === "affirmative-rejection") report.supported = true;
    if (mode === "unmatched-issue")
        report.informational!.issues[0].path = "/content/title";
    if (mode === "undiagnosed-field")
        report.informational!.fields[0].supported = false;
    expect(() => assertInformationalSupport(output, report, input)).toThrow();
});

test("valid claim-specific rejection remains a factual rejection", () => {
    const { input, output } = fixture();
    expect(() => validateSupport(output, rejection(output), input)).toThrow(
        ViewSupportRejection,
    );
});

test("typed-only unsupported project state is diagnosed even with unchanged supported prose", () => {
    const { input, output } = fixture(true);
    const section = output.content.sections.findIndex(
        (section) => section.role === "status",
    );
    const details = output.content.sections[section].details;
    if (details?.kind !== "status")
        throw new Error("Missing typed project state");
    details.project = "complete";
    const report = controlledInformationalSupport(output);
    const path = `/content/sections/${section}/details`;
    report.supported = false;
    report.informational!.fields.find(
        (field) => field.path === path,
    )!.supported = false;
    report.informational!.issues.push({
        path,
        category: "state",
        quote: '"project":"complete"',
        evidenceIds: ["f0"],
        reason: "Original evidence identifies an active project.",
        correction: "Retain the active project state.",
    });
    expect(() => validateSupport(output, report, input)).toThrow(
        `state at ${path}`,
    );
});

describe.each([false, true])(
    "initial build factual gate (project=%s)",
    (project) => {
        test.each([
            "accept",
            "reject",
            "repair",
            "repeat-rejection",
            "missing-checker-contract",
            "repair-aborted",
        ] as const)(
            "initial informational build audits actual output and bounded repair: %s",
            async (mode) => {
                const { input, output } = fixture(project);
                const job: ViewBuildJob = {
                    jobId: "job",
                    corpusId: "corpus",
                    fingerprint: "job",
                    actor: "test",
                    createdAt: "test",
                    updatedAt: "test",
                    state: "running",
                    publication: false,
                    request: {
                        corpusId: "corpus",
                        expectedHead: null,
                        targets: [],
                    },
                    results: [
                        {
                            viewId: "atlas",
                            state: "pending",
                            reason: "Pending",
                            snapshot: input,
                        },
                    ],
                };
                let audits = 0,
                    repairs = 0,
                    saves = 0;
                let finish!: () => void;
                const finished = new Promise<void>((resolve) => {
                    finish = resolve;
                });
                const runner = new ViewBuildRunner(
                    {
                        identity: "controlled",
                        generate: async () => structuredClone(output),
                        checkEditorial: async () => ({
                            safe: true,
                            failures: [],
                        }),
                        validate: async (_input, actual) => {
                            audits++;
                            if (mode === "missing-checker-contract") {
                                const report =
                                    controlledInformationalSupport(actual);
                                delete report.informational;
                                return report;
                            }
                            return mode === "accept" ||
                                (mode === "repair" && audits > 1)
                                ? controlledInformationalSupport(actual)
                                : rejection(actual);
                        },
                        ...(mode === "reject"
                            ? {}
                            : {
                                  repairInformationalSupport: async (
                                      _input: ViewBuildSnapshot,
                                      actual: ViewSynthesisOutput,
                                  ) => {
                                      repairs++;
                                      if (mode === "repair-aborted")
                                          throw new Error(
                                              "Injected repair cancellation",
                                          );
                                      expect(actual.content.summary).toBe(
                                          output.content.summary,
                                      );
                                      return structuredClone(output);
                                  },
                              }),
                    },
                    {
                        current: async () => undefined,
                        update: async (_corpus, _job, update) => {
                            update(job);
                            if (job.state !== "running") finish();
                            return job;
                        },
                        materialize: async (
                            _job,
                            target,
                            _candidate,
                            actual,
                            _conflicts,
                            _signal,
                            proof,
                        ) => {
                            saves++;
                            expect(proof).toEqual(
                                publicationProof(
                                    input.fingerprint,
                                    actual,
                                    controlledInformationalSupport(actual),
                                ),
                            );
                            target.state = "draft";
                        },
                    },
                );
                try {
                    runner.start(job);
                    await finished;
                    expect(saves).toBe(
                        mode === "accept" || mode === "repair" ? 1 : 0,
                    );
                    expect(repairs).toBe(
                        [
                            "repair",
                            "repeat-rejection",
                            "repair-aborted",
                        ].includes(mode)
                            ? 1
                            : 0,
                    );
                    expect(audits).toBe(
                        mode === "repair" || mode === "repeat-rejection"
                            ? 2
                            : 1,
                    );
                } finally {
                    await runner.close();
                }
            },
        );
    },
);

test("informational proof is exact and does not require legacy inventory", () => {
    const { input, output } = fixture();
    const version: ViewVersion = {
        corpusId: input.corpusId,
        viewId: input.definition.viewId,
        revisionId: "version",
        version: 1,
        state: "draft" as const,
        createdAt: "test",
        actor: "test",
        provenance: "generated" as const,
        definition: { ...input.definition, revisionId: "definition" },
        content: output.content,
        relationships: [],
        generation: {
            input,
            outcome: output.outcome,
            missingEvidence: output.missingEvidence,
            content: output.content,
            relationships: output.relationships,
            candidateId: "candidate",
            fingerprint: "generated",
        },
        validation: publicationProof(
            input.fingerprint,
            output,
            controlledInformationalSupport(output),
        ),
    };
    version.relationships = versionRelationships(
        version,
        output.relationships,
        true,
    );
    expect(() => assertPublicationProof(version)).not.toThrow();
    const legacy = structuredClone(version);
    delete legacy.validation;
    expect(() => assertPublicationProof(legacy)).toThrow(
        "no independent support proof",
    );
    expect(() =>
        assertPublicationProof(legacy, { allowLegacyInformational: true }),
    ).not.toThrow();
    version.content = {
        ...version.content,
        summary: "Different unvalidated summary",
    };
    expect(() => assertPublicationProof(version)).toThrow(
        "no independent support proof",
    );
    expect(() =>
        assertPublicationProof(version, { allowLegacyInformational: true }),
    ).toThrow("no independent support proof");
});
