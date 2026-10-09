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

function text(value: unknown, label: string): asserts value is string {
    if (typeof value !== "string" || !value.trim())
        throw new Error(`${label} is required`);
}

function onlyKeys(value: object, keys: string[], label: string): void {
    if (Object.keys(value).some((key) => !keys.includes(key)))
        throw new Error(`Unsupported ${label} field or operation`);
}

function validateSelector(selector: ViewSourceSelector): Set<string> {
    if (selector?.kind !== "sources" || !Array.isArray(selector.sources))
        throw new Error(
            "Only explicit revision-aware source selectors are supported",
        );
    onlyKeys(selector, ["kind", "sources"], "source selector");
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
    return sources;
}

function validateSections(
    sections: ViewSection[],
    project: boolean,
): Set<string> {
    if (!Array.isArray(sections) || !sections.length)
        throw new Error("At least one guide section is required");
    const ids = new Set<string>();
    for (const section of sections) {
        if (!section || typeof section !== "object")
            throw new Error("Invalid guide section");
        assertViewIdentifier("section ID", section.id);
        onlyKeys(
            section,
            ["id", "role", "heading", "body", ...(project ? ["details"] : [])],
            "view section",
        );
        if (ids.has(section.id)) throw new Error("Duplicate section ID");
        ids.add(section.id);
        const allowed: readonly string[] = project
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

function validateCitation(value: ViewCitation, sources: Set<string>): void {
    if (!value || !sources.has(sourceKey(value)))
        throw new Error("Citation is outside the selected source revisions");
    if (
        typeof value.locator !== "string" ||
        !/^chars:\d+-\d+$/.test(value.locator)
    )
        throw new Error("Exact UTF-16 citation offsets are required");
    text(value.excerpt, "Citation excerpt");
    onlyKeys(
        value,
        ["sourceId", "revisionId", "locator", "excerpt"],
        "view citation",
    );
}

function endpointKey(
    value: ViewEndpoint,
    request: ViewSaveRequest,
    sources: Set<string>,
    sections: Set<string>,
): string {
    if (value?.kind === "source") {
        onlyKeys(value, ["kind", "sourceId", "revisionId"], "source endpoint");
        if (!sources.has(sourceKey(value)))
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
        if (!["supportedBy", "dependsOn"].includes(edge.predicate))
            throw new Error("Unsupported relationship predicate");
        if (edge.from?.kind !== "section" || edge.to?.kind !== "source")
            throw new Error(
                "Supported guide relationships are directed from a section to a source revision",
            );
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
        !["troubleshootingGuide", "projectBrief"].includes(
            request.definition?.kind,
        ) ||
        request.content?.kind !== request.definition?.kind
    )
        throw new Error("Unsupported view kind or mismatched content kind");
    if (request.definition.viewId !== request.viewId)
        throw new Error("View definition identity does not match");
    onlyKeys(
        request.definition,
        ["viewId", "kind", "selector"],
        "view definition",
    );
    const sources = validateSelector(request.definition.selector);
    text(request.content.title, "Guide title");
    const sections = validateSections(
        request.content.sections,
        request.content.kind === "projectBrief",
    );
    if (request.content.kind === "projectBrief")
        validateProjectBrief(request.content);
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
        ["kind", "title", "summary", "sections", "citations"],
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

    validateRelationships(request.relationships, request, sources, sections);
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
