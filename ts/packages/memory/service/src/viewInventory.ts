// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewBuildSnapshot,
    ViewFactInventory,
    ViewInventoryItem,
    ViewSourceDecision,
    ViewInventoryAudit,
} from "./viewTypes.js";
import { assertViewIdentifier } from "./viewContent.js";
import { viewHash } from "./viewMerge.js";
import {
    retainedPassages,
    resolvePassages,
    evidenceRecord,
    evidenceArray,
    evidenceText,
    evidenceChoice,
    exactEvidenceCoverage,
    type ViewPassage,
} from "./viewSynthesisEvidence.js";

export const factKinds = [
    "goal",
    "measurement",
    "approach",
    "prerequisite",
    "authority",
    "recovery",
    "outcome",
    "unresolved",
    "reuseWarning",
    "timing",
    "background",
] as const;
export const factStatuses = [
    "observed",
    "proposed",
    "attempted",
    "rejected",
    "deferred",
    "confirmed",
    "unknown",
    "blocked",
    "notApplicable",
] as const;
export const sourceDispositions = [
    "represented",
    "metadata",
    "duplicate",
    "outsideScope",
] as const;

function optionalTiming(value: unknown): string {
    if (typeof value !== "string" || value.length > 200)
        throw new Error(
            "Inventory timing must be bounded text; empty denotes unknown",
        );
    return value;
}
function hydrateItem(
    value: unknown,
    passages: ViewPassage[],
): ViewInventoryItem {
    const raw = evidenceRecord(value);
    const selected = resolvePassages(raw.passageIds, passages);
    if (!selected.length)
        throw new Error("Inventory items require exact source grounding");
    const key = evidenceText(raw.key);
    assertViewIdentifier("inventory key", key);
    const sources = [
        ...new Set(selected.map((passage) => passage.sourceId)),
    ].sort();
    return {
        id: `fact:${viewHash([key, sources]).slice(0, 32)}`,
        key,
        kind: evidenceChoice(raw.kind, factKinds),
        status: evidenceChoice(raw.status, factStatuses),
        statement: evidenceText(raw.statement),
        measurements: evidenceArray(raw.measurements, 16).map((value) => {
            const measure = evidenceRecord(value);
            return {
                quantity: evidenceText(measure.quantity),
                unit: evidenceText(measure.unit),
                context: evidenceText(measure.context),
            };
        }),
        occurredAt: optionalTiming(raw.occurredAt),
        learnedAt: optionalTiming(raw.learnedAt),
        citations: selected.map(
            ({ sourceId, revisionId, locator, excerpt }) => ({
                sourceId,
                revisionId,
                locator,
                excerpt,
            }),
        ),
    };
}
function assertDecisionWitnesses(
    input: ViewBuildSnapshot,
    disposition: ViewSourceDecision["disposition"],
    selected: ViewPassage[],
    witnesses: ViewInventoryItem[],
): void {
    if (disposition === "metadata") {
        const source = input.inputs.find(
            (entry) => entry.sourceId === selected[0].sourceId,
        );
        if (
            witnesses.length ||
            selected.some((entry) => {
                const identity = entry.excerpt
                    .trim()
                    .replace(/^#{1,6} /, "")
                    .trim();
                return (
                    identity !== source?.title && identity !== source?.sourceId
                );
            })
        )
            throw new Error(
                "Metadata exclusions are limited to exact source identity/title passages",
            );
        return;
    }
    const grounded = (item: ViewInventoryItem, passage: ViewPassage) =>
        item.citations.some(
            (citation) =>
                citation.sourceId === passage.sourceId &&
                citation.revisionId === passage.revisionId &&
                citation.locator === passage.locator &&
                citation.excerpt === passage.excerpt,
        );
    if (
        selected.some(
            (passage) => !witnesses.some((item) => grounded(item, passage)),
        ) ||
        witnesses.some(
            (item) => !selected.some((passage) => grounded(item, passage)),
        )
    )
        throw new Error(
            "Source decision witnesses must cover exactly the selected retained passages",
        );
}
function hydrateDecision(
    input: ViewBuildSnapshot,
    value: unknown,
    index: number,
    items: ViewInventoryItem[],
    passages: ViewPassage[],
): ViewSourceDecision {
    const raw = evidenceRecord(value);
    const selected = resolvePassages(raw.passageIds, passages);
    const sourceId = evidenceText(raw.sourceId);
    if (
        !selected.length ||
        selected.some((entry) => entry.sourceId !== sourceId)
    )
        throw new Error("Source decisions require one exact selected source");
    const itemIds = evidenceArray(raw.itemKeys, 128).map((key) => {
        const item = items.find((entry) => entry.key === evidenceText(key));
        if (!item)
            throw new Error("Source decision references unknown inventory key");
        return item.id;
    });
    const disposition = evidenceChoice(raw.disposition, sourceDispositions);
    exactEvidenceCoverage(itemIds, [...new Set(itemIds)], (id) => id);
    if (["represented", "duplicate"].includes(disposition) && !itemIds.length)
        throw new Error(
            "Represented/duplicate evidence needs inventory witnesses",
        );
    if (
        disposition === "outsideScope" &&
        (!itemIds.length ||
            itemIds.some(
                (id) =>
                    items.find((item) => item.id === id)!.kind !== "background",
            ))
    )
        throw new Error(
            "Outside-scope decisions require independently checked background inventory witnesses",
        );
    assertDecisionWitnesses(
        input,
        disposition,
        selected,
        items.filter((item) => itemIds.includes(item.id)),
    );
    const reason = evidenceText(raw.reason);
    if (reason.length > 1800)
        throw new Error("Source decision justification exceeds bound");
    return {
        id: `decision:${index}`,
        sourceId,
        passageIds: selected.map((entry) => entry.passageId),
        disposition,
        itemIds,
        reason,
    };
}
export function hydrateInventory(
    input: ViewBuildSnapshot,
    value: unknown,
): ViewFactInventory {
    const raw = evidenceRecord(value);
    const passages = retainedPassages(input);
    const items = evidenceArray(raw.items, 128).map((item) =>
        hydrateItem(item, passages),
    );
    if (!items.length) throw new Error("Evidence-first inventory is empty");
    exactEvidenceCoverage(
        items,
        [...new Set(items.map((item) => item.key))],
        (item) => item.key,
    );
    const sourceDecisions = evidenceArray(raw.sourceDecisions).map(
        (decision, index) =>
            hydrateDecision(input, decision, index, items, passages),
    );
    exactEvidenceCoverage(
        sourceDecisions.flatMap((decision) => decision.passageIds),
        passages.map((passage) => passage.passageId),
        (id) => id,
    );
    const inventory = {
        schemaVersion: 1 as const,
        sourceFingerprint: input.fingerprint,
        items,
        sourceDecisions,
    };
    return { ...inventory, fingerprint: viewHash(inventory) };
}
export function parseInventoryAudit(value: unknown): ViewInventoryAudit {
    const raw = evidenceRecord(value);
    if (typeof raw.supported !== "boolean")
        throw new Error("Inventory audit requires explicit supported verdict");
    const checks = (value: unknown, key: string) =>
        evidenceArray(value).map((entry) => {
            const check = evidenceRecord(entry);
            if (typeof check.supported !== "boolean")
                throw new Error(
                    "Inventory audit requires explicit item/decision verdict",
                );
            return {
                id: evidenceText(check[key]),
                supported: check.supported,
                reason: evidenceText(check.reason),
            };
        });
    return {
        supported: raw.supported,
        items: checks(raw.items, "itemId").map(({ id, ...check }) => ({
            ...check,
            itemId: id,
        })),
        decisions: checks(raw.decisions, "decisionId").map(
            ({ id, ...check }) => ({ ...check, decisionId: id }),
        ),
        missingFacts: evidenceArray(raw.missingFacts).map((value) => {
            const fact = evidenceRecord(value);
            return {
                sourceId: evidenceText(fact.sourceId),
                passageIds: evidenceArray(fact.passageIds).map(evidenceText),
                description: evidenceText(fact.description),
            };
        }),
        reasons: evidenceArray(raw.reasons).map(evidenceText),
    };
}
export function validateInventoryAudit(
    input: ViewBuildSnapshot,
    inventory: ViewFactInventory,
    audit: ViewInventoryAudit,
): void {
    if (inventory.sourceFingerprint !== input.fingerprint)
        throw new Error("Inventory belongs to different frozen inputs");
    exactEvidenceCoverage(
        audit.items,
        inventory.items.map((item) => item.id),
        (item) => item.itemId,
    );
    exactEvidenceCoverage(
        audit.decisions,
        inventory.sourceDecisions.map((decision) => decision.id),
        (decision) => decision.decisionId,
    );
    for (const fact of audit.missingFacts) {
        if (!input.inputs.some((source) => source.sourceId === fact.sourceId))
            throw new Error("Inventory audit references outside source");
        const selected = resolvePassages(
            fact.passageIds,
            retainedPassages(input),
        );
        if (
            !selected.length ||
            selected.some((passage) => passage.sourceId !== fact.sourceId)
        )
            throw new Error(
                "Missing-fact assessments require exact passages from the named source",
            );
    }
    if (
        !audit.supported ||
        audit.missingFacts.length ||
        [...audit.items, ...audit.decisions].some((check) => !check.supported)
    )
        throw new Error(
            `Source-to-inventory check failed: ${[...audit.reasons, ...audit.missingFacts.map((fact) => fact.description), ...[...audit.items, ...audit.decisions].filter((check) => !check.supported).map((check) => check.reason)].join("; ")}`,
        );
}
export function renderInventoryItem(item: ViewInventoryItem): string {
    return [
        item.statement,
        ...(item.status === "notApplicable"
            ? []
            : [`Evidence status: ${item.status}.`]),
        ...item.measurements.map(
            (measure) =>
                `${measure.quantity} ${measure.unit}: ${measure.context}.`,
        ),
        ...(item.occurredAt ? [`Occurred: ${item.occurredAt}.`] : []),
        ...(item.learnedAt ? [`Known/recorded: ${item.learnedAt}.`] : []),
    ].join("\n");
}
