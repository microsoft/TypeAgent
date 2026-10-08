// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewBuildSnapshot,
    ViewSynthesisOutput,
} from "../src/viewTypes.js";
import {
    hydrateConstruction,
    retainedPassages,
    validateAuditedContext,
} from "../src/viewSynthesisEvidence.js";
import {
    assertSynthesisOutput,
    validateConstructedGuide,
} from "../src/viewSynthesis.js";
import {
    createViewConstructionSchema,
    createViewSupportSchema,
    viewContextTopics,
} from "../src/viewSynthesisSchemas.js";

const input: ViewBuildSnapshot = {
    corpusId: "synthetic",
    actor: "authenticated-test-owner",
    definition: {
        viewId: "guide",
        kind: "troubleshootingGuide",
        selector: {
            kind: "sources",
            sources: [
                { sourceId: "checkpoint", revisionId: "checkpoint-retained" },
                { sourceId: "constraints", revisionId: "constraints-retained" },
            ],
        },
    },
    expectedVersion: 0,
    bounds: {},
    pipeline: "troubleshooting-v1",
    model: "offline-test-only",
    fingerprint: "synthetic-fingerprint",
    inputs: [
        {
            sourceId: "checkpoint",
            revisionId: "checkpoint-retained",
            title: "Unresolved checkpoint",
            content:
                "# Checkpoint\r\nUnknown cause \ud83d\udd0e.\r\n\r\nRecovery is not verified.\r\n",
            contentHash: "synthetic-checkpoint",
        },
        {
            sourceId: "constraints",
            revisionId: "constraints-retained",
            title: "Recovery limits",
            content:
                "Approval is required.\n\n```text\nNo automatic action.\n```\n",
            contentHash: "synthetic-constraints",
        },
    ],
};
const roles = [
    "description",
    "prerequisites",
    "diagnostic",
    "guard",
    "verification",
    "recovery",
    "context",
] as const;
const passages = retainedPassages(input);

function construction() {
    return {
        content: {
            kind: "troubleshootingGuide",
            title: "Diagnostic-only checkpoint",
            summary: "Cause and verified recovery are missing.",
            sections: roles.map((role) => ({
                id: role,
                role,
                heading: role,
                body: "Recovery is unverified. Approval is required before any future change.",
            })),
            citations: [{ passageId: "p0-1" }, { passageId: "p1-0" }],
        },
        relationships: roles.map((role) => ({
            id: `support-${role}`,
            sectionId: role,
            citations: [{ passageId: "p0-1" }],
        })),
        outcome: "diagnosticOnly",
        missingEvidence: ["Cause and verified recovery are missing"],
    };
}

function output(): ViewSynthesisOutput {
    const result = hydrateConstruction(input, construction(), passages);
    assertSynthesisOutput(result);
    return result;
}

function review() {
    return {
        supported: true,
        sourceChecks: input.inputs.map((source, index) => ({
            sourceId: source.sourceId,
            reason: "Controlled offline source assessment",
            requiredFindings: [
                {
                    passageId: `p${index}-0`,
                    claim: "Controlled offline required context",
                    covered: true,
                    sectionIds: ["diagnostic"],
                    guidePassageIds: ["g2-0"],
                },
            ],
        })),
        contextChecks: viewContextTopics.map((topic) => ({
            topic,
            supported: true,
            reason: "Controlled offline context assessment",
            citations: [{ passageId: "p0-1" }],
            sectionIds: ["context"],
            guidePassageIds: ["g6-0"],
        })),
    };
}

describe("configured constructor retained passage references", () => {
    test("hydration retains exact UTF-16, CRLF and fenced passages without generated hashes or offsets", () => {
        for (const passage of passages) {
            const source = input.inputs.find(
                (entry) => entry.sourceId === passage.sourceId,
            )!;
            const [, start, end] = /^chars:(\d+)-(\d+)$/.exec(passage.locator)!;
            expect(source.content.slice(Number(start), Number(end))).toBe(
                passage.excerpt,
            );
        }
        expect(passages[0].excerpt).toBe(
            "# Checkpoint\r\nUnknown cause \ud83d\udd0e.",
        );
        expect(passages[3].excerpt).toBe("```text\nNo automatic action.\n```");
        const hydrated = output();
        expect(hydrated.content.citations[0]).toEqual({
            sourceId: "checkpoint",
            revisionId: "checkpoint-retained",
            locator: passages[1].locator,
            excerpt: "Recovery is not verified.",
        });
        expect(hydrated.relationships[0].to).toEqual({
            kind: "source",
            sourceId: "checkpoint",
            revisionId: "checkpoint-retained",
        });
        validateConstructedGuide(input, hydrated);
    });
    test("diagnosticOnly is representable but cannot omit recovery support or missing evidence", () => {
        const hydrated = output();
        validateConstructedGuide(input, hydrated);
        const duplicated = output();
        duplicated.relationships.push({
            ...duplicated.relationships[0],
            id: "duplicate-support",
        });
        expect(() => validateConstructedGuide(input, duplicated)).toThrow(
            "Duplicate semantic relationship",
        );
        hydrated.relationships = hydrated.relationships.filter(
            (edge) =>
                edge.from.kind !== "section" ||
                edge.from.sectionId !== "recovery",
        );
        expect(() => validateConstructedGuide(input, hydrated)).toThrow(
            "Guide section recovery lacks exact supporting evidence",
        );
        const missing = output();
        missing.missingEvidence = [];
        expect(() => validateConstructedGuide(input, missing)).toThrow(
            "must identify missing recovery evidence",
        );
    });
    test("unknown references and copied revision fields fail explicitly rather than repairing citations", () => {
        const unknown = construction();
        unknown.content.citations[0].passageId = "not-selected";
        expect(() => hydrateConstruction(input, unknown, passages)).toThrow(
            "Unknown retained passage reference",
        );
        const forged = construction();
        Object.assign(forged.content.citations[0], {
            revisionId: "invented-revision",
        });
        expect(() => hydrateConstruction(input, forged, passages)).toThrow(
            "Only retained passage references",
        );
    });
    test("one edge cannot silently combine different source revisions", () => {
        const mixed = construction();
        mixed.relationships[0].citations.push({ passageId: "p1-0" });
        expect(() => hydrateConstruction(input, mixed, passages)).toThrow(
            "must cite one exact retained source revision",
        );
    });
    test("wire schemas constrain passage references and require source and ten-topic audits", () => {
        const ids = passages.map((entry) => entry.passageId);
        const schema = createViewConstructionSchema(ids);
        expect(JSON.stringify(schema)).toContain(
            '"enum":["p0-0","p0-1","p1-0","p1-1"]',
        );
        expect(JSON.stringify(schema)).not.toContain("checkpoint-retained");
        const audit = createViewSupportSchema(
            ids,
            input.inputs.map((source) => source.sourceId),
            roles.map((_role, index) => `g${index}-0`),
        );
        expect(audit.schema.required).toEqual(
            expect.arrayContaining(["sourceChecks", "contextChecks"]),
        );
        for (const topic of viewContextTopics)
            expect(JSON.stringify(audit)).toContain(topic);
    });
});

describe("independent source and context audit coverage", () => {
    test("positive coverage must point into the claimed guide sections, not unrelated or unknown passages", () => {
        const unrelated = review();
        unrelated.sourceChecks[0].requiredFindings[0].guidePassageIds = [
            "g6-0",
        ];
        expect(() =>
            validateAuditedContext(input, output(), unrelated, passages),
        ).toThrow("does not belong to its claimed sections");
        const missing = review();
        missing.contextChecks[0].guidePassageIds = [];
        expect(() =>
            validateAuditedContext(input, output(), missing, passages),
        ).toThrow("requires exact unique guide passage references");
        const unknown = review();
        unknown.sourceChecks[0].requiredFindings[0].guidePassageIds = [
            "unknown",
        ];
        expect(() =>
            validateAuditedContext(input, output(), unknown, passages),
        ).toThrow("does not belong to its claimed sections");
    });
    test("a rubber-stamped measurement cannot be claimed as covered by generic prose", () => {
        const omitted = review();
        omitted.sourceChecks[0].requiredFindings[0].claim =
            "Acquisition took 37 milliseconds and execution 4 milliseconds.";
        expect(() =>
            validateAuditedContext(input, output(), omitted, passages),
        ).toThrow("quantitative finding is absent");
        const covered = output();
        covered.content.sections[2].body +=
            " Acquisition took 37 milliseconds and execution 4 milliseconds.";
        validateAuditedContext(input, covered, omitted, passages);
    });
    test("complete controlled coverage passes; this is not live semantic qualification", () => {
        validateAuditedContext(input, output(), review(), passages);
    });
    test("global supported:true cannot hide an omitted or duplicated source", () => {
        const omitted = review();
        omitted.sourceChecks.pop();
        expect(() =>
            validateAuditedContext(input, output(), omitted, passages),
        ).toThrow("every exact sourceId");
        const duplicate = review();
        duplicate.sourceChecks[1] = duplicate.sourceChecks[0];
        expect(() =>
            validateAuditedContext(input, output(), duplicate, passages),
        ).toThrow("every exact sourceId");
    });
    test("global supported:true cannot hide missing topic coverage or required source facts", () => {
        const omitted = review();
        omitted.contextChecks.pop();
        expect(() =>
            validateAuditedContext(input, output(), omitted, passages),
        ).toThrow("every exact topic");
        const missing = review();
        missing.sourceChecks[0].requiredFindings[0].covered = false;
        expect(() =>
            validateAuditedContext(input, output(), missing, passages),
        ).toThrow("Missing required source context");
        const unsafe = review();
        unsafe.contextChecks.find(
            (entry) => entry.topic === "authoritySimulation",
        )!.supported = false;
        expect(() =>
            validateAuditedContext(input, output(), unsafe, passages),
        ).toThrow("Missing required authoritySimulation context");
    });
    test("audit findings cannot cite another source or an unknown passage", () => {
        const foreign = review();
        foreign.sourceChecks[0].requiredFindings[0].passageId = "p1-0";
        expect(() =>
            validateAuditedContext(input, output(), foreign, passages),
        ).toThrow("different source");
        const unknown = review();
        unknown.contextChecks[0].citations[0].passageId = "not-selected";
        expect(() =>
            validateAuditedContext(input, output(), unknown, passages),
        ).toThrow("Unknown retained passage reference");
    });
    test("positive findings must name real, non-duplicated guide sections", () => {
        const missing = review();
        missing.sourceChecks[0].requiredFindings[0].sectionIds = ["unknown"];
        expect(() =>
            validateAuditedContext(input, output(), missing, passages),
        ).toThrow("missing or duplicate guide sections");
        const duplicate = review();
        duplicate.contextChecks[0].sectionIds = ["context", "context"];
        expect(() =>
            validateAuditedContext(input, output(), duplicate, passages),
        ).toThrow("missing or duplicate guide sections");
    });
});
