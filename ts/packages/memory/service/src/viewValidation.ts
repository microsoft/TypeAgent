// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewSaveRequest,
    ViewCitation,
    ViewEndpoint,
    ViewSourceSelector,
    ViewSection,
    ViewRelationshipInput,
    ViewArchiveRequest,
} from "./viewTypes.js";
import {
    assertViewIdentifier,
    viewSourceKey as sourceKey,
} from "./viewContent.js";
import { projectBriefRoles, validateProjectBrief } from "./projectBrief.js";
import { validateTimeline } from "./timeline.js";
import { validateWiki } from "./wiki.js";
import { validateMaintenanceDefinition } from "./viewMaintenance.js";

function text(value: unknown, label: string): asserts value is string {
    if (typeof value !== "string" || !value.trim())
        throw new Error(`${label} is required`);
}

function onlyKeys(value: object, keys: string[], label: string): void {
    if (Object.keys(value).some((key) => !keys.includes(key)))
        throw new Error(`Unsupported ${label} field or operation`);
}

function validateSelector(selector: ViewSourceSelector): Set<string> {
    if (
        !["sources", "timelineEvidence"].includes(selector?.kind) ||
        !Array.isArray(selector.sources)
    )
        throw new Error(
            "Only explicit revision-aware source selectors are supported",
        );
    onlyKeys(
        selector,
        [
            "kind",
            "sources",
            ...(selector.kind === "timelineEvidence" ? ["events"] : []),
        ],
        "source selector",
    );
    const sources = new Set<string>();
    for (const source of selector.sources) {
        if (!source || typeof source !== "object")
            throw new Error("Invalid selected source");
        assertViewIdentifier("source ID", source.sourceId);
        assertViewIdentifier("revision ID", source.revisionId);
        onlyKeys(source, ["sourceId", "revisionId"], "selected source");
        const key = sourceKey(source);
        if (sources.has(key))
            throw new Error("Duplicate selected source revision");
        sources.add(key);
    }
    if (selector.kind === "timelineEvidence") {
        if (!Array.isArray(selector.events))
            throw new Error(
                "Timeline selection requires an explicit events array",
            );
        for (const event of selector.events) {
            onlyKeys(event, ["eventId"], "selected event");
            assertViewIdentifier("event ID", event.eventId);
            const key = `event:${event.eventId}`;
            if (sources.has(key))
                throw new Error("Duplicate selected canonical event");
            sources.add(key);
        }
    }
    return sources;
}

function validateSections(sections: ViewSection[], kind: string): Set<string> {
    if (!Array.isArray(sections) || !sections.length)
        throw new Error("At least one guide section is required");
    const ids = new Set<string>();
    for (const section of sections) {
        if (!section || typeof section !== "object")
            throw new Error("Invalid guide section");
        assertViewIdentifier("section ID", section.id);
        onlyKeys(
            section,
            [
                "id",
                "role",
                "heading",
                "body",
                ...(kind !== "troubleshootingGuide" ? ["details"] : []),
            ],
            "view section",
        );
        if (ids.has(section.id)) throw new Error("Duplicate section ID");
        ids.add(section.id);
        const allowed: readonly string[] =
            kind === "timeline"
                ? ["event"]
                : kind === "wiki"
                  ? ["page"]
                  : kind === "projectBrief"
                    ? projectBriefRoles
                    : [
                          "description",
                          "prerequisites",
                          "diagnostic",
                          "guard",
                          "verification",
                          "recovery",
                          "context",
                      ];
        if (!allowed.includes(section.role))
            throw new Error("Unsupported guide section role");
        text(section.heading, "Section heading");
        text(section.body, "Section content");
    }
    return ids;
}

function validateCanonicalEvidence(
    value: Extract<ViewEndpoint, { kind: "source" }> | ViewCitation,
    label: string,
): void {
    if (value.evidence === undefined) return;
    if (
        !value.evidence ||
        typeof value.evidence !== "object" ||
        value.evidence.kind !== "event" ||
        value.evidence.eventId !== value.sourceId ||
        typeof value.revisionId !== "string" ||
        !/^[0-9a-f]{64}$/.test(value.revisionId)
    )
        throw new Error(`Invalid canonical event ${label} provenance`);
    onlyKeys(value.evidence, ["kind", "eventId"], "event evidence");
    assertViewIdentifier("event ID", value.evidence.eventId);
}

function validateCitation(value: ViewCitation, sources: Set<string>): void {
    if (
        !value ||
        !sources.has(
            value.evidence
                ? `event:${value.evidence.eventId}`
                : sourceKey(value),
        )
    )
        throw new Error("Citation is outside the selected source revisions");
    if (
        typeof value.locator !== "string" ||
        !/^chars:\d+-\d+$/.test(value.locator)
    )
        throw new Error("Exact UTF-16 citation offsets are required");
    text(value.excerpt, "Citation excerpt");
    onlyKeys(
        value,
        ["sourceId", "revisionId", "locator", "excerpt", "evidence"],
        "view citation",
    );
    validateCanonicalEvidence(value, "citation");
}

function endpointKey(
    value: ViewEndpoint,
    request: ViewSaveRequest,
    sources: Set<string>,
    sections: Set<string>,
): string {
    if (value?.kind === "source") {
        onlyKeys(
            value,
            ["kind", "sourceId", "revisionId", "evidence"],
            "source endpoint",
        );
        assertViewIdentifier("source ID", value.sourceId);
        assertViewIdentifier("revision ID", value.revisionId);
        validateCanonicalEvidence(value, "endpoint");
        if (
            !sources.has(
                value.evidence
                    ? `event:${value.evidence.eventId}`
                    : sourceKey(value),
            )
        )
            throw new Error(
                "Relationship endpoint is outside selected revisions",
            );
        return `source:${sourceKey(value)}`;
    }
    if (value?.kind === "section") {
        onlyKeys(value, ["kind", "viewId", "sectionId"], "section endpoint");
        if (value.viewId !== request.viewId || !sections.has(value.sectionId))
            throw new Error("Relationship section endpoint does not exist");
        return `section:${value.viewId}\n${value.sectionId}`;
    }
    throw new Error("Unsupported relationship endpoint");
}

function validateRelationshipDirection(
    edge: ViewRelationshipInput,
    kind: ViewSaveRequest["content"]["kind"],
): void {
    if (
        ![
            "supportedBy",
            "dependsOn",
            "corrects",
            "supersedes",
            "relatedTo",
            "contradicts",
        ].includes(edge.predicate)
    )
        throw new Error("Unsupported relationship predicate");
    const correction =
        edge.predicate === "corrects" || edge.predicate === "supersedes";
    const pageLink =
        edge.predicate === "relatedTo" || edge.predicate === "contradicts";
    if (
        edge.from?.kind !== "section" ||
        (correction || pageLink
            ? edge.to?.kind !== "section"
            : edge.to?.kind !== "source")
    )
        throw new Error(
            "Evidence relationships require section-to-source endpoints; corrections require section-to-section endpoints",
        );
    if (
        correction &&
        (kind !== "timeline" ||
            edge.from.sectionId ===
                (edge.to.kind === "section" ? edge.to.sectionId : undefined))
    )
        throw new Error(
            "Corrections require distinct existing timeline records",
        );
    if (
        pageLink &&
        (kind !== "wiki" ||
            edge.to.kind !== "section" ||
            edge.from.sectionId === edge.to.sectionId)
    )
        throw new Error("Wiki links require distinct current wiki pages");
}

function validateRelationships(
    edges: ViewRelationshipInput[],
    request: ViewSaveRequest,
    sources: Set<string>,
    sections: Set<string>,
): void {
    if (!Array.isArray(edges))
        throw new Error("View relationships must be an array");
    const ids = new Set<string>();
    const semantics = new Set<string>();
    for (const edge of edges) {
        if (!edge || typeof edge !== "object")
            throw new Error("Invalid view relationship");
        assertViewIdentifier("relationship ID", edge.id);
        onlyKeys(
            edge,
            ["id", "predicate", "from", "to", "citations"],
            "authored relationship",
        );
        if (ids.has(edge.id)) throw new Error("Duplicate relationship ID");
        ids.add(edge.id);
        validateRelationshipDirection(edge, request.content.kind);
        if (edge.id.startsWith("lineage:") || edge.id.startsWith("dependency:"))
            throw new Error("System relationship identities are reserved");
        const key = JSON.stringify([
            edge.predicate,
            endpointKey(edge.from, request, sources, sections),
            endpointKey(edge.to, request, sources, sections),
        ]);
        if (semantics.has(key))
            throw new Error("Duplicate semantic relationship");
        semantics.add(key);
        if (!Array.isArray(edge.citations) || !edge.citations.length)
            throw new Error("Relationships require exact supporting citations");
        for (const citation of edge.citations)
            validateCitation(citation, sources);
        const target = edge.to;
        if (
            (request.content.kind === "timeline" ||
                request.content.kind === "wiki") &&
            target.kind === "source" &&
            edge.citations.some(
                (citation) => sourceKey(citation) !== sourceKey(target),
            )
        )
            throw new Error(
                "Evidence relationship citations must match its exact target",
            );
    }
}

export function validateViewDraft(request: ViewSaveRequest): void {
    if (!request || typeof request !== "object")
        throw new Error("View draft request is required");
    if ("actor" in request)
        throw new Error("View actor is assigned by the authenticated service");
    onlyKeys(
        request,
        [
            "corpusId",
            "viewId",
            "expectedVersion",
            "expectedHead",
            "definition",
            "content",
            "relationships",
        ],
        "view request",
    );
    assertViewIdentifier("view ID", request.viewId);
    if (
        !Number.isSafeInteger(request.expectedVersion) ||
        request.expectedVersion < 0
    )
        throw new Error("Expected view version must be a nonnegative integer");
    if (
        request.expectedHead !== null &&
        (typeof request.expectedHead !== "string" ||
            !/^[0-9a-f]{40}$/.test(request.expectedHead))
    )
        throw new Error("Expected view history head is required");
    if (
        !["troubleshootingGuide", "projectBrief", "timeline", "wiki"].includes(
            request.definition?.kind,
        ) ||
        request.content?.kind !== request.definition?.kind
    )
        throw new Error("Unsupported view kind or mismatched content kind");
    if (request.definition.viewId !== request.viewId)
        throw new Error("View definition identity does not match");
    onlyKeys(
        request.definition,
        ["viewId", "kind", "selector", "maintenance"],
        "view definition",
    );
    validateMaintenanceDefinition(request.definition);
    const sources = validateSelector(request.definition.selector);
    const sections = validateDraftContent(request, sources);
    validateRelationships(request.relationships, request, sources, sections);
}

function validateDraftContent(
    request: ViewSaveRequest,
    sources: Set<string>,
): Set<string> {
    if (
        (request.content.kind === "timeline") !==
        (request.definition.selector.kind === "timelineEvidence")
    )
        throw new Error(
            "Timeline requires discriminated canonical-event/document selection",
        );
    text(request.content.title, "Guide title");
    const sections = validateSections(
        request.content.sections,
        request.content.kind,
    );
    if (request.content.kind === "projectBrief")
        validateProjectBrief(request.content);
    if (request.content.kind === "timeline") validateTimeline(request.content);
    if (request.content.kind === "wiki") validateWiki(request.content);
    if (request.content.agentEdition !== undefined)
        throw new Error(
            "Agent editions are edited through the runbook compatibility workflow",
        );
    if (request.content.compatibilityFields !== undefined)
        throw new Error(
            "Compatibility fields are reserved for existing runbooks",
        );
    onlyKeys(
        request.content,
        [
            "kind",
            "title",
            "summary",
            "sections",
            "citations",
            ...(request.content.kind === "timeline" ? ["generatedAt"] : []),
            ...(request.content.kind === "wiki" ? ["index"] : []),
        ],
        "guide content",
    );
    if (request.content.summary !== undefined)
        text(request.content.summary, "Guide summary");
    if (!Array.isArray(request.content.citations))
        throw new Error("View citations must be an array");
    for (const citation of request.content.citations) {
        if (!citation?.locator || citation.excerpt === undefined)
            throw new Error("Exact citations require a locator and excerpt");
        validateCitation(
            {
                ...citation,
                locator: citation.locator,
                excerpt: citation.excerpt,
            },
            sources,
        );
    }
    return sections;
}

export function validateViewArchive(request: ViewArchiveRequest): void {
    if (!request || typeof request !== "object")
        throw new Error("View archive request is required");
    onlyKeys(
        request,
        ["corpusId", "viewId", "expectedVersion", "expectedHead"],
        "view archive",
    );
    assertViewIdentifier("view ID", request.viewId);
    if (
        !Number.isSafeInteger(request.expectedVersion) ||
        request.expectedVersion < 1
    )
        throw new Error("Expected archive version must be a positive integer");
    if (
        typeof request.expectedHead !== "string" ||
        !/^[0-9a-f]{40}$/.test(request.expectedHead)
    )
        throw new Error("Expected view history head is required");
}
