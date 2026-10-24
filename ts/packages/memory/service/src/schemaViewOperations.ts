// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryQuestion,
    QuestionEditRequest,
    SchemaViewPage,
    SchemaViewPageRequest,
    QuestionSection,
    QuestionEdit,
    SchemaViewDefinition,
} from "./schemaViewTypes.js";
import type {
    ViewSaveRequest,
    ViewSnapshot,
    ViewVersion,
} from "./viewTypes.js";
import {
    candidateIdentity,
    questionSection,
    resolveQuestion,
    schemaCitations,
    validateAnswerValue,
    validateQuestionSlot,
    questionContractRevision,
    schemaViewLimits,
} from "./schemaView.js";
import {
    derivedDefinitionInput,
    authoredRelationships,
} from "./viewRelationships.js";
import { viewHash } from "./viewMerge.js";
import { viewContentToText } from "./viewText.js";
import { assertViewIdentifier } from "./viewContent.js";

export function questionInventory(snapshot: ViewSnapshot): MemoryQuestion[] {
    return snapshot.views
        .flatMap((view) => {
            if (
                view.state === "archived" ||
                view.content.kind !== "schemaView" ||
                !view.definition.schemaView
            )
                return [];
            const content = view.content;
            return view.definition.schemaView.slots.map((slot) => {
                const stored = content.sections.find(
                    (section) => section.id === slot.id,
                )!.details;
                const details = resolveQuestion(
                    slot,
                    stored.candidates,
                    stored.evaluatedSources,
                );
                if (view.state === "stale") details.freshness = "stale";
                const attentionScore =
                    slot.approval === "rejected"
                        ? 0
                        : slot.approval === "proposed"
                          ? 30
                          : details.answerState === "conflicted"
                            ? 100
                            : details.candidates.some(
                                    (candidate) =>
                                        candidate.review === "unreviewed",
                                )
                              ? 70
                              : details.answerState === "pending"
                                ? 40
                                : details.freshness !== "current"
                                  ? 20
                                  : 0;
                return {
                    corpusId: view.corpusId,
                    viewId: view.viewId,
                    viewTitle: view.content.title,
                    viewVersion: view.version,
                    viewRevisionId: view.revisionId,
                    definitionRevision: questionContractRevision(
                        view.definition,
                        slot,
                    ),
                    slot: structuredClone(slot),
                    details,
                    attentionScore,
                    fingerprint: viewHash({ slot, details }),
                };
            });
        })
        .sort(
            (a, b) =>
                b.attentionScore - a.attentionScore ||
                a.viewId.localeCompare(b.viewId) ||
                a.slot.id.localeCompare(b.slot.id),
        );
}

function editDiscovery(
    schema: SchemaViewDefinition,
    edit: Extract<QuestionEdit, { kind: "discovery" }>,
): void {
    if (
        typeof edit.enabled !== "boolean" ||
        !Number.isSafeInteger(edit.maxProposals) ||
        edit.maxProposals < 0 ||
        edit.maxProposals > schemaViewLimits.proposals ||
        edit.maxProposals <
            schema.slots.filter((slot) => slot.discoveryCitations.length).length
    )
        throw new Error(
            "Discovery requires an allowance from 0 to 8, no smaller than already admitted proposals",
        );
    if (
        edit.enabled !== schema.discovery.enabled ||
        edit.maxProposals !== schema.discovery.maxProposals
    )
        delete schema.discovery.lastEvaluatedScope;
    schema.discovery.enabled = edit.enabled;
    schema.discovery.maxProposals = edit.maxProposals;
}

export function editSchemaQuestion(
    view: ViewVersion,
    request: QuestionEditRequest,
): ViewSaveRequest {
    if (view.content.kind !== "schemaView" || !view.definition.schemaView)
        throw new Error("Question edits require a schema view");
    if (request.expectedVersion !== view.version)
        throw new Error("Question edit version conflict");
    if (!request.edit || typeof request.edit !== "object")
        throw new Error("Question edit is required");
    const definition = structuredClone(derivedDefinitionInput(view));
    const content = structuredClone(view.content);
    const schema = definition.schemaView!;
    const slot = schema.slots.find((slot) => slot.id === request.slotId);
    const section = content.sections.find(
        (section) => section.id === request.slotId,
    );
    if (!slot || !section) throw new Error("Unknown question slot");
    const edit = request.edit;
    switch (edit.kind) {
        case "discovery":
            editDiscovery(schema, edit);
            break;
        case "slot":
            validateQuestionSlot(edit.slot);
            if (edit.slot.id !== slot.id)
                throw new Error("Slot identity cannot change");
            if (
                viewHash(edit.slot.discoveryCitations) !==
                viewHash(slot.discoveryCitations)
            )
                throw new Error(
                    "Question editing cannot rewrite discovery evidence",
                );
            if (
                viewHash(edit.slot.rubric) !== viewHash(slot.rubric) &&
                edit.slot.rubric.version !== slot.rubric.version + 1
            )
                throw new Error("A changed rubric requires the next version");
            const meaningChanged =
                viewHash([
                    slot.question,
                    slot.schema,
                    slot.cardinality,
                    slot.itemKey,
                ]) !==
                viewHash([
                    edit.slot.question,
                    edit.slot.schema,
                    edit.slot.cardinality,
                    edit.slot.itemKey,
                ]);
            Object.assign(slot, structuredClone(edit.slot));
            if (meaningChanged) section.details.candidates = [];
            for (const candidate of section.details.candidates) {
                validateAnswerValue(slot.schema, candidate.value);
                candidate.review = "unreviewed";
            }
            break;
        case "review": {
            if (!["unreviewed", "confirmed", "rejected"].includes(edit.review))
                throw new Error("Unsupported review state");
            const candidate = section.details.candidates.find(
                (candidate) => candidate.id === edit.candidateId,
            );
            if (!candidate) throw new Error("Unknown candidate");
            candidate.review = edit.review;
            break;
        }
        case "assert": {
            validateAnswerValue(slot.schema, edit.value);
            const id = candidateIdentity(edit.value, edit.itemKey);
            const existing = section.details.candidates.find(
                (candidate) => candidate.id === id,
            );
            if (existing) {
                existing.review = "confirmed";
                existing.origin = "user";
                existing.citations = [];
                existing.opposingCitations = [];
                existing.support = [];
                existing.derivedFrom = [];
                delete existing.effectiveAt;
            } else
                section.details.candidates.push({
                    id,
                    value: structuredClone(edit.value),
                    ...(edit.itemKey === undefined
                        ? {}
                        : { itemKey: edit.itemKey }),
                    origin: "user",
                    review: "confirmed",
                    citations: [],
                    opposingCitations: [],
                    derivedFrom: [],
                    support: [],
                });
            break;
        }
        case "approval":
            if (!["proposed", "approved", "rejected"].includes(edit.approval))
                throw new Error("Unsupported approval state");
            slot.approval = edit.approval;
            break;
        default:
            throw new Error("Unsupported question edit");
    }
    Object.assign(
        section,
        questionSection(
            slot,
            resolveQuestion(
                slot,
                section.details.candidates,
                section.details.evaluatedSources,
            ),
        ),
    );
    content.citations = schemaCitations(schema, content.sections);
    return {
        corpusId: request.corpusId,
        viewId: request.viewId,
        expectedHead: request.expectedHead,
        expectedVersion: request.expectedVersion,
        definition,
        content,
        relationships: authoredRelationships(view),
    };
}

export function viewPageUri(request: SchemaViewPageRequest): string {
    const uri = new URL(
        `memory-view://${request.corpusId}/${encodeURIComponent(request.viewId)}`,
    );
    if (request.revisionId)
        uri.searchParams.set("revisionId", request.revisionId);
    if (request.slotId) uri.searchParams.set("slotId", request.slotId);
    if (request.itemKey !== undefined)
        uri.searchParams.set("itemKey", request.itemKey);
    return uri.toString();
}

export function parseViewPageUri(value: string): SchemaViewPageRequest {
    const uri = new URL(value);
    if (
        uri.protocol !== "memory-view:" ||
        uri.username ||
        uri.password ||
        uri.port ||
        uri.hash
    )
        throw new Error("Invalid memory view page URI");
    const viewId = decodeURIComponent(uri.pathname.slice(1));
    assertViewIdentifier("view ID", viewId);
    assertViewIdentifier("corpus ID", uri.hostname);
    for (const key of uri.searchParams.keys())
        if (
            !["revisionId", "slotId", "itemKey"].includes(key) ||
            uri.searchParams.getAll(key).length !== 1
        )
            throw new Error("Unsupported memory view page parameter");
    return {
        corpusId: uri.hostname,
        viewId,
        ...(uri.searchParams.has("revisionId")
            ? { revisionId: uri.searchParams.get("revisionId")! }
            : {}),
        ...(uri.searchParams.has("slotId")
            ? { slotId: uri.searchParams.get("slotId")! }
            : {}),
        ...(uri.searchParams.has("itemKey")
            ? { itemKey: uri.searchParams.get("itemKey")! }
            : {}),
    };
}

function md(value: string): string {
    return value.replace(/[\\`*_[\]<>#]/g, "\\$&").replace(/[\r\n]/g, " ");
}

export function renderViewPage(
    view: ViewVersion,
    request: SchemaViewPageRequest,
): SchemaViewPage {
    if (request.itemKey !== undefined && !request.slotId)
        throw new Error("Item pages require a slot identity");
    const lines = [
        `# ${md(view.content.title)}`,
        `Revision: ${view.revisionId}; state: ${view.state}.`,
    ];
    if (view.content.kind !== "schemaView") {
        if (request.slotId || request.itemKey !== undefined)
            throw new Error("This view has no question item pages");
        lines.push(viewContentToText(view.content));
    } else {
        const sections = request.slotId
            ? view.content.sections.filter(
                  (section) => section.id === request.slotId,
              )
            : view.content.sections;
        if (!sections.length) throw new Error("Unknown question page");
        for (const section of sections)
            lines.push(...questionPageLines(view, request, section));
    }
    return {
        uri: viewPageUri(request),
        revisionId: view.revisionId,
        markdown: lines.join("\n\n"),
    };
}

function questionPageLines(
    view: ViewVersion,
    request: SchemaViewPageRequest,
    section: QuestionSection,
): string[] {
    const slot = view.definition.schemaView!.slots.find(
        (slot) => slot.id === section.id,
    )!;
    const details = resolveQuestion(
        slot,
        section.details.candidates,
        section.details.evaluatedSources,
    );
    const lines = [
        `## ${md(slot.question)}`,
        `Approval: ${slot.approval}; answer: ${details.answerState}; review: ${details.reviewState}; freshness: ${view.state === "stale" ? "stale" : details.freshness}.`,
        "Evidence freshness describes maintenance against retained sources, not whether a historical fact still holds today.",
        "Coverage: incomplete. Navigation links are not evidence.",
    ];
    const selected = details.candidates.filter((candidate) =>
        details.selectedCandidateIds.includes(candidate.id),
    );
    const items =
        request.itemKey === undefined
            ? selected
            : selected.filter(
                  (candidate) => candidate.itemKey === request.itemKey,
              );
    if (request.itemKey !== undefined && !items.length)
        throw new Error(
            "Collection item is absent, unresolved or no longer selected",
        );
    for (const candidate of items) {
        if (candidate.itemKey && request.itemKey === undefined)
            lines.push(
                `[${md(candidate.itemKey)}](${viewPageUri({ ...request, revisionId: view.revisionId, slotId: slot.id, itemKey: candidate.itemKey })})`,
            );
        lines.push(
            "```json",
            JSON.stringify(candidate.value, null, 2).replace(/`/g, "\\u0060"),
            "```",
            `Origin: ${candidate.origin}; review: ${candidate.review}.`,
        );
        for (const citation of candidate.citations)
            lines.push(
                `- Evidence: ${md(citation.sourceId)} @ ${md(citation.revisionId)}, ${md(citation.locator)}: ${md(citation.excerpt)}`,
            );
    }
    if (!items.length)
        lines.push("Unknown: no uniquely eligible selected value.");
    lines.push(
        `[Question page](${viewPageUri({ corpusId: view.corpusId, viewId: view.viewId, revisionId: view.revisionId, slotId: slot.id })})`,
    );
    return lines;
}
