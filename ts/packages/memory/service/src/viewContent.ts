// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import type { ProcedureDocument, ProcedureVersion } from "./types.js";
import type {
    ProcedureViewContent,
    ViewVersion,
    ViewSection,
} from "./viewTypes.js";
import { canonicalizeProcedure } from "./agentEdition.js";
import { procedureToMarkdown } from "./procedureMarkdown.js";

export function viewSourceKey(source: {
    sourceId: string;
    revisionId: string;
}): string {
    return `${source.sourceId}\n${source.revisionId}`;
}

function sectionRole(heading: string): ViewSection["role"] {
    if (/prerequisites|preconditions/i.test(heading)) return "prerequisites";
    if (/verification|expected result/i.test(heading)) return "verification";
    if (/rollback|recovery/i.test(heading)) return "recovery";
    if (/guard|triage|risk|safety/i.test(heading)) return "guard";
    if (/purpose|scope|description/i.test(heading)) return "description";
    return "context";
}

export function guideFromProcedure(
    document: ProcedureDocument,
    previous?: ViewVersion,
): ProcedureViewContent {
    const previousSteps =
        previous?.content.sections.filter(
            (section) => section.role === "diagnostic",
        ) ?? [];
    const previousContext =
        previous?.content.sections.filter(
            (section) => section.role !== "diagnostic",
        ) ?? [];
    return {
        kind: "procedure",
        title: document.title,
        ...(document.summary === undefined
            ? {}
            : { summary: document.summary }),
        citations: structuredClone(document.citations),
        sections: [
            ...document.steps.map(
                (body, index): ViewSection => ({
                    id: previousSteps[index]?.id ?? `step-${index + 1}`,
                    role: "diagnostic",
                    heading: "",
                    body,
                }),
            ),
            ...(document.additionalSections ?? []).map(
                (section): ViewSection => ({
                    id:
                        previousContext.find(
                            (item) => item.heading === section.heading,
                        )?.id ??
                        `section:${createHash("sha256").update(section.heading.trim().toLowerCase()).digest("hex").slice(0, 16)}`,
                    role: sectionRole(section.heading),
                    heading: section.heading,
                    body: section.content,
                }),
            ),
        ],
        ...(document.agentEdition === undefined
            ? {}
            : { agentEdition: structuredClone(document.agentEdition) }),
        compatibilityFields: Object.fromEntries(
            Object.entries(document).filter(
                ([key]) =>
                    ![
                        "title",
                        "summary",
                        "steps",
                        "citations",
                        "additionalSections",
                        "agentEdition",
                    ].includes(key),
            ),
        ),
    };
}

export function procedureFromGuide(version: ViewVersion): ProcedureVersion {
    if (!version.compatibility)
        throw new Error("Draft views are not saved procedures");
    const content = version.content;
    const sections = content.sections.filter(
        (section) => section.role !== "diagnostic",
    );
    const document: ProcedureDocument = {
        ...content.compatibilityFields,
        title: content.title,
        ...(content.summary === undefined ? {} : { summary: content.summary }),
        steps: content.sections
            .filter((section) => section.role === "diagnostic")
            .map((section) => section.body),
        citations: structuredClone(content.citations),
        ...(sections.length
            ? {
                  additionalSections: sections.map((section) => ({
                      heading: section.heading,
                      content: section.body,
                  })),
              }
            : {}),
        ...(content.agentEdition === undefined
            ? {}
            : { agentEdition: structuredClone(content.agentEdition) }),
    };
    const canonicalJson = canonicalizeProcedure(document);
    const markdown = procedureToMarkdown(document);
    const hash = (text: string) =>
        createHash("sha256").update(text).digest("hex");
    return {
        corpusId: version.corpusId,
        procedureId: version.viewId,
        version: version.version,
        ...version.compatibility,
        createdAt: version.createdAt,
        document,
        canonicalJson,
        markdown,
        jsonHash: hash(canonicalJson),
        markdownHash: hash(markdown),
    };
}

export function assertViewIdentifier(kind: string, value: string): void {
    if (
        typeof value !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)
    )
        throw new Error(`Invalid ${kind} '${value}'`);
}
