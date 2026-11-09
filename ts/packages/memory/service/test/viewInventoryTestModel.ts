// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const {
    evidenceArray,
    evidenceRecord,
    evidenceText,
}: typeof import("../src/viewSynthesisEvidence.js") = await import(
    new URL("../../dist/viewSynthesisEvidence.js", import.meta.url).href
);

// Controlled protocol responses for offline tests, never live qualification.
export function inventoryTestAnswer(
    name: string,
    value: unknown,
    prose = "Inspect pressure.\n\nPreserve approval boundaries.\n",
): unknown {
    const raw = evidenceRecord(value);
    if (name === "memory_source_fact_inventory") {
        const sources = evidenceArray(raw.inputs).map(evidenceRecord);
        const items = sources.flatMap((source, sourceIndex) =>
            evidenceArray(source.passages).map((value, index) => {
                const passage = evidenceRecord(value);
                return {
                    key: `source-${sourceIndex}-fact-${index}`,
                    kind: "unresolved",
                    status: "unknown",
                    statement: evidenceText(passage.excerpt),
                    measurements: [],
                    occurredAt: "",
                    learnedAt: "",
                    passageIds: [evidenceText(passage.passageId)],
                };
            }),
        );
        return {
            items,
            sourceDecisions: sources.map((source, index) => ({
                sourceId: source.sourceId,
                passageIds: evidenceArray(source.passages).map(
                    (passage) => evidenceRecord(passage).passageId,
                ),
                disposition: "represented",
                itemKeys: items
                    .filter((item) => item.key.startsWith(`source-${index}-`))
                    .map((item) => item.key),
                reason: "Controlled source-only assessment",
            })),
        };
    }
    const inventory =
        raw.inventory === undefined ? undefined : evidenceRecord(raw.inventory);
    if (name === "memory_source_inventory_check") {
        if (!inventory) throw new Error("Missing controlled inventory");
        return {
            supported: true,
            items: evidenceArray(inventory.items).map((item) => ({
                itemId: evidenceRecord(item).id,
                supported: true,
                reason: "Controlled source check",
            })),
            decisions: evidenceArray(inventory.sourceDecisions).map(
                (decision) => ({
                    decisionId: evidenceRecord(decision).id,
                    supported: true,
                    reason: "Controlled source decision check",
                }),
            ),
            missingFacts: [],
            reasons: [],
        };
    }
    if (name === "memory_inventory_guide_construction") {
        if (!inventory) throw new Error("Missing controlled inventory");
        return {
            content: {
                title: "Controlled conditional guide",
                summary: "Controlled diagnostic-only fixture",
                sections: [
                    "description",
                    "prerequisites",
                    "diagnostic",
                    "guard",
                    "verification",
                    "recovery",
                    "context",
                ].map((role) => ({
                    id: role,
                    role,
                    heading: role,
                    prose,
                    inventoryIds: evidenceArray(inventory.items).map(
                        (item) => evidenceRecord(item).id,
                    ),
                })),
            },
            exclusions: [],
            outcome: "diagnosticOnly",
            missingEvidence: ["No verified recovery"],
        };
    }
    if (name === "memory_inventory_artifact_support") {
        const output = evidenceRecord(raw.output);
        return {
            supported: true,
            missingContext: [],
            reasons: [],
            exclusions: [],
            sections: evidenceArray(
                evidenceRecord(output.content).sections,
            ).map((section) => ({
                sectionId: evidenceRecord(section).id,
                supported: true,
                reason: "Controlled support check",
            })),
            relationships: evidenceArray(output.relationships).map((edge) => ({
                edgeId: evidenceRecord(edge).id,
                supported: true,
                reason: "Controlled edge check",
            })),
        };
    }
    throw new Error(`Unsupported controlled model schema: ${name}`);
}
