// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewBuildSnapshot,
    ViewFactInventory,
    ViewInventoryCoverage,
    ViewInventoryItem,
    ViewRelationshipInput,
    ViewSynthesisOutput,
} from "./viewTypes.js";
import { viewHash } from "./viewMerge.js";
import { viewSourceKey } from "./viewContent.js";
import { renderInventoryItem } from "./viewInventory.js";
import {
    evidenceArray,
    evidenceChoice,
    evidenceRecord,
    evidenceText,
    exactEvidenceCoverage,
} from "./viewSynthesisEvidence.js";

const roles = [
    "description",
    "prerequisites",
    "diagnostic",
    "guard",
    "verification",
    "recovery",
    "context",
] as const;
export function inventoryEvidence(
    source: Pick<
        ViewSynthesisOutput,
        "inventory" | "inventoryAudit" | "coverage"
    >,
): Pick<ViewSynthesisOutput, "inventory" | "inventoryAudit" | "coverage"> {
    return {
        ...(source.inventory ? { inventory: source.inventory } : {}),
        ...(source.inventoryAudit
            ? { inventoryAudit: source.inventoryAudit }
            : {}),
        ...(source.coverage ? { coverage: source.coverage } : {}),
    };
}
function selectedItems(
    value: unknown,
    inventory: ViewFactInventory,
): ViewInventoryItem[] {
    return evidenceArray(value, 128).map((id) => {
        const item = inventory.items.find(
            (entry) => entry.id === evidenceText(id),
        );
        if (!item)
            throw new Error(
                "Construction references unknown inventory identity",
            );
        return item;
    });
}
function evidenceEdges(
    input: ViewBuildSnapshot,
    sectionId: string,
    items: ViewInventoryItem[],
): ViewRelationshipInput[] {
    const groups = new Map<string, ViewInventoryItem["citations"]>();
    for (const citation of items.flatMap((item) => item.citations)) {
        const key = viewSourceKey(citation);
        const group = groups.get(key) ?? [];
        if (
            !group.some(
                (entry) =>
                    entry.locator === citation.locator &&
                    entry.excerpt === citation.excerpt,
            )
        )
            group.push(citation);
        groups.set(key, group);
    }
    return [...groups.values()].map((citations) => ({
        id: `support:${viewHash([input.definition.viewId, sectionId, citations[0].sourceId, citations[0].revisionId]).slice(0, 32)}`,
        predicate: "supportedBy",
        from: { kind: "section", viewId: input.definition.viewId, sectionId },
        to: {
            kind: "source",
            sourceId: citations[0].sourceId,
            revisionId: citations[0].revisionId,
        },
        citations,
    }));
}
function exclusions(
    value: unknown,
    inventory: ViewFactInventory,
): ViewInventoryCoverage["items"] {
    return evidenceArray(value, 128).map((value) => {
        const raw = evidenceRecord(value);
        const itemId = evidenceText(raw.itemId);
        const item = inventory.items.find((entry) => entry.id === itemId);
        if (!item)
            throw new Error("Exclusion references unknown inventory item");
        const exclusion = evidenceChoice(raw.reason, [
            "duplicate",
            "outsideScope",
        ] as const);
        const justification = evidenceText(raw.justification);
        if (justification.length > 1800)
            throw new Error("Exclusion justification exceeds bound");
        if (typeof raw.duplicateOf !== "string")
            throw new Error("Exclusion duplicate identity must be explicit");
        const duplicate = inventory.items.find(
            (entry) => entry.id === raw.duplicateOf,
        );
        if (
            exclusion === "duplicate" &&
            (!duplicate ||
                duplicate.id === itemId ||
                renderInventoryItem(duplicate) !== renderInventoryItem(item))
        )
            throw new Error(
                "Duplicate exclusions require exactly equal independently grounded facts",
            );
        if (
            exclusion === "outsideScope" &&
            (item.kind !== "background" || raw.duplicateOf !== "")
        )
            throw new Error(
                "Only independently classified background may be excluded as outside scope",
            );
        return {
            itemId,
            state: "excluded" as const,
            exclusion,
            justification,
            ...(duplicate ? { duplicateOf: duplicate.id } : {}),
        };
    });
}
export function hydrateInventoryConstruction(
    input: ViewBuildSnapshot,
    inventory: ViewFactInventory,
    value: unknown,
): ViewSynthesisOutput {
    if (inventory.sourceFingerprint !== input.fingerprint)
        throw new Error("Construction inventory/input fingerprint mismatch");
    const raw = evidenceRecord(value);
    if (
        Object.keys(raw).some(
            (key) =>
                ![
                    "content",
                    "exclusions",
                    "outcome",
                    "missingEvidence",
                ].includes(key),
        )
    )
        throw new Error(
            "Unsupported evidence-first construction field; legacy relationships are not repaired",
        );
    const content = evidenceRecord(raw.content);
    const relationships: ViewRelationshipInput[] = [];
    const sections = evidenceArray(content.sections, 1000).map((value) => {
        const section = evidenceRecord(value);
        const id = evidenceText(section.id);
        const items = selectedItems(section.inventoryIds, inventory);
        if (!items.length)
            throw new Error(
                "Each constructed section needs explicit inventory provenance",
            );
        relationships.push(...evidenceEdges(input, id, items));
        return {
            id,
            role: evidenceChoice(section.role, roles),
            heading: evidenceText(section.heading),
            body: evidenceText(
                [
                    evidenceText(section.prose),
                    ...items.map(renderInventoryItem),
                ].join("\n\n"),
            ),
        };
    });
    const output: ViewSynthesisOutput = {
        content: {
            kind: "troubleshootingGuide",
            title: evidenceText(content.title),
            summary: evidenceText(content.summary),
            sections,
            citations: relationships.flatMap((edge) => edge.citations),
        },
        relationships,
        outcome: evidenceChoice(raw.outcome, [
            "diagnosticOnly",
            "verifiedRecovery",
        ] as const),
        missingEvidence: evidenceArray(raw.missingEvidence, 100).map(
            evidenceText,
        ),
        inventory,
        coverage: {
            inventoryFingerprint: inventory.fingerprint,
            items: exclusions(raw.exclusions, inventory),
            reuseEligibility: "diagnosticOnly",
        },
    };
    output.coverage = inventoryCoverage(output);
    return output;
}
export function inventoryCoverage(
    output: ViewSynthesisOutput,
): ViewInventoryCoverage {
    const inventory = output.inventory;
    if (!inventory)
        throw new Error("Evidence-first coverage requires frozen inventory");
    const excluded =
        output.coverage?.items.filter((item) => item.state === "excluded") ??
        [];
    exactEvidenceCoverage(
        excluded,
        [...new Set(excluded.map((item) => item.itemId))],
        (item) => item.itemId,
    );
    for (const exclusion of excluded) {
        const item = inventory.items.find(
            (entry) => entry.id === exclusion.itemId,
        );
        const duplicate = inventory.items.find(
            (entry) => entry.id === exclusion.duplicateOf,
        );
        if (
            !item ||
            !exclusion.justification ||
            exclusion.justification.length > 1800
        )
            throw new Error(
                "Excluded coverage requires a bounded justified inventory identity",
            );
        if (
            exclusion.exclusion === "outsideScope" &&
            item.kind !== "background"
        )
            throw new Error(
                "Required fact/context cannot be excluded as irrelevant",
            );
        if (
            exclusion.exclusion === "duplicate" &&
            (!duplicate ||
                duplicate.id === item.id ||
                renderInventoryItem(duplicate) !== renderInventoryItem(item))
        )
            throw new Error(
                "Coverage duplicate lacks exactly equal fact witness",
            );
        if (!["duplicate", "outsideScope"].includes(exclusion.exclusion ?? ""))
            throw new Error("Unsupported inventory exclusion");
    }
    const items = inventory.items.map(
        (item): ViewInventoryCoverage["items"][number] => {
            const exclusion = excluded.find(
                (entry) => entry.itemId === item.id,
            );
            if (exclusion) return exclusion;
            const rendered = renderInventoryItem(item);
            const section = output.content.sections.find((entry) =>
                entry.body.includes(rendered),
            );
            if (!section)
                throw new Error(
                    `Required inventory content is absent from final artifact: ${item.key}`,
                );
            const start = section.body.indexOf(rendered);
            return {
                itemId: item.id,
                state: "covered",
                sectionId: section.id,
                locator: `chars:${start}-${start + rendered.length}`,
                excerpt: rendered,
            };
        },
    );
    exactEvidenceCoverage(
        items,
        inventory.items.map((item) => item.id),
        (item) => item.itemId,
    );
    for (const exclusion of excluded) {
        if (!items.some((item) => item.itemId === exclusion.itemId))
            throw new Error("Coverage exclusion is outside frozen inventory");
        if (
            exclusion.duplicateOf &&
            !items.some(
                (item) =>
                    item.itemId === exclusion.duplicateOf &&
                    item.state === "covered",
            )
        )
            throw new Error(
                "Duplicate exclusion witness must be covered in actual artifact",
            );
    }
    return {
        inventoryFingerprint: inventory.fingerprint,
        items,
        reuseEligibility:
            output.outcome === "diagnosticOnly"
                ? "diagnosticOnly"
                : "requiresFreshEvidence",
    };
}
