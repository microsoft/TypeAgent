// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ProcedureDocument, ProcedureSourceCitation } from "./types.js";
import {
    agentEditionFromMarkdown,
    agentEditionMarkdownMarker,
    agentEditionToMarkdown,
    validateAgentEdition,
} from "./agentEditionValidation.js";

function sortJson(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortJson);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, child]) => [key, sortJson(child)]),
        );
    }
    return value;
}

function validateIdentifier(kind: string, value: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) {
        throw new Error(`Invalid ${kind} '${value}'`);
    }
}

export function validateProcedureDocument(document: ProcedureDocument): void {
    if (document.title.trim().length === 0) {
        throw new Error("Procedure title cannot be empty");
    }
    if (
        document.steps.length === 0 ||
        document.steps.some((step) => step.trim().length === 0)
    ) {
        throw new Error("A procedure requires at least one non-empty step");
    }
    const headings = new Set<string>();
    if (document.agentEdition !== undefined) {
        validateAgentEdition(document.agentEdition);
        headings.add("agent edition");
    }
    for (const section of document.additionalSections ?? []) {
        const heading = section.heading.trim().toLowerCase();
        if (
            heading.length === 0 ||
            heading === "steps" ||
            heading === "sources" ||
            headings.has(heading)
        ) {
            throw new Error(
                `Invalid or duplicate section '${section.heading}'`,
            );
        }
        headings.add(heading);
    }
    for (const citation of document.citations) {
        validateIdentifier("source ID", citation.sourceId);
        validateIdentifier("revision ID", citation.revisionId);
    }
}

export function procedureToMarkdown(document: ProcedureDocument): string {
    validateProcedureDocument(document);
    const lines = [`# ${document.title.trim()}`, ""];
    if (document.summary !== undefined) lines.push(document.summary.trim(), "");
    lines.push("## Steps", "");
    document.steps.forEach((step, index) =>
        lines.push(`${index + 1}. ${step.trim().replace(/\n/g, "\n   ")}`),
    );
    lines.push("", "## Sources", "");
    for (const citation of document.citations) {
        lines.push(`- ${JSON.stringify(sortJson(citation))}`);
    }
    if (document.citations.length === 0) lines.push("_None_");
    for (const section of document.additionalSections ?? []) {
        lines.push(
            "",
            `## ${section.heading.trim()}`,
            "",
            section.content.trim(),
        );
    }
    if (document.agentEdition !== undefined) {
        lines.push(
            "",
            "## Agent Edition",
            "",
            agentEditionToMarkdown(document.agentEdition),
        );
    }
    return `${lines.join("\n").trimEnd()}\n`;
}

function preservedDocumentFields(
    previous?: ProcedureDocument,
): Partial<ProcedureDocument> {
    if (previous === undefined) return {};
    const retained = structuredClone(previous);
    delete retained.summary;
    delete retained.additionalSections;
    delete retained.agentEdition;
    return retained;
}

function parseProcedureSteps(content: string): string[] {
    const steps: string[] = [];
    for (const line of content.split("\n")) {
        const numbered = /^\d+[.)]\s+(.+)$/.exec(line);
        if (numbered !== null) {
            steps.push(numbered[1].trim());
            continue;
        }
        const continuation = /^ {3}(.*)$/.exec(line);
        if (continuation !== null && steps.length > 0) {
            steps[steps.length - 1] += `\n${continuation[1]}`;
            continue;
        }
        if (!line.trim()) continue;
        throw new Error(`Invalid procedure step '${line}'`);
    }
    return steps;
}

export function procedureFromMarkdown(
    markdown: string,
    previous?: ProcedureDocument,
): ProcedureDocument {
    const normalized = markdown.replace(/\r\n/g, "\n");
    if (
        previous !== undefined &&
        normalized === procedureToMarkdown(previous)
    ) {
        return structuredClone(previous);
    }
    const titleMatch = /^# ([^\n]+)\n/.exec(normalized);
    if (titleMatch === null)
        throw new Error("Procedure Markdown must start with a level-one title");
    const body = normalized.slice(titleMatch[0].length);
    const headingPattern = /^## ([^\n]+)$/gm;
    const headings = [...body.matchAll(headingPattern)];
    if (headings.length === 0)
        throw new Error(
            "Procedure Markdown requires Steps and Sources sections",
        );
    const preamble = body.slice(0, headings[0].index).trim();
    const sections = headings.map((match, index) => {
        const contentStart = (match.index ?? 0) + match[0].length;
        const contentEnd =
            index + 1 < headings.length
                ? (headings[index + 1].index ?? body.length)
                : body.length;
        return {
            heading: match[1].trim(),
            content: body.slice(contentStart, contentEnd).trim(),
        };
    });
    const sectionNames = sections.map((section) =>
        section.heading.toLowerCase(),
    );
    if (new Set(sectionNames).size !== sectionNames.length) {
        throw new Error("Procedure Markdown contains duplicate sections");
    }
    const stepsSection = sections.find(
        (section) => section.heading.toLowerCase() === "steps",
    );
    const sourcesSection = sections.find(
        (section) => section.heading.toLowerCase() === "sources",
    );
    if (stepsSection === undefined || sourcesSection === undefined) {
        throw new Error(
            "Procedure Markdown requires Steps and Sources sections",
        );
    }
    const steps = parseProcedureSteps(stepsSection.content);
    const citations: ProcedureSourceCitation[] =
        sourcesSection.content === "_None_"
            ? []
            : sourcesSection.content
                  .split("\n")
                  .filter((line) => line.trim().length > 0)
                  .map((line) => {
                      if (!line.startsWith("- "))
                          throw new Error(`Invalid source citation '${line}'`);
                      return JSON.parse(
                          line.slice(2),
                      ) as ProcedureSourceCitation;
                  });
    const editionSection = sections.find(
        (section) =>
            section.heading.toLowerCase() === "agent edition" &&
            section.content.startsWith(agentEditionMarkdownMarker),
    );
    const agentEdition =
        editionSection === undefined
            ? undefined
            : agentEditionFromMarkdown(editionSection.content);
    const additionalSections = sections
        .filter(
            (section) =>
                !["steps", "sources"].includes(section.heading.toLowerCase()) &&
                section !== editionSection,
        )
        .map((section) => {
            const retained = previous?.additionalSections?.find(
                (entry) =>
                    entry.heading.trim().toLowerCase() ===
                    section.heading.toLowerCase(),
            );
            return {
                ...structuredClone(retained ?? {}),
                heading:
                    retained !== undefined &&
                    retained.heading.trim() === section.heading
                        ? retained.heading
                        : section.heading,
                content:
                    retained !== undefined &&
                    retained.content.trim() === section.content
                        ? retained.content
                        : section.content,
            };
        });
    const document: ProcedureDocument = {
        ...preservedDocumentFields(previous),
        title: titleMatch[1].trim(),
        ...(preamble.length === 0 ? {} : { summary: preamble }),
        steps,
        citations,
        ...(additionalSections.length === 0 ? {} : { additionalSections }),
        ...(agentEdition === undefined ? {} : { agentEdition }),
    };
    validateProcedureDocument(document);
    return document;
}
