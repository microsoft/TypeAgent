// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import type {
    ProcedureCandidateCreateRequest,
    ProcedureSection,
} from "./types.js";

interface Line {
    text: string;
    start: number;
    end: number;
    fenced: boolean;
}
interface Heading {
    title: string;
    level: number;
    line: number;
}

function scan(content: string): { lines: Line[]; headings: Heading[] } {
    const lines: Line[] = [];
    const headings: Heading[] = [];
    let fence: { character: string; length: number } | undefined;
    let frontmatter =
        content.startsWith("---\n") || content.startsWith("---\r");
    const pattern = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
    for (const match of content.matchAll(pattern)) {
        if (!match[0]) break;
        const text = match[0].replace(/[\r\n]+$/, "");
        const marker = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(text);
        const fenced = fence !== undefined || marker !== null;
        if (marker) {
            if (!fence)
                fence = { character: marker[1][0], length: marker[1].length };
            else if (
                marker[1][0] === fence.character &&
                marker[1].length >= fence.length &&
                !marker[2].trim()
            )
                fence = undefined;
        }
        if (frontmatter && lines.length > 0 && text === "---") {
            frontmatter = false;
        } else if (!frontmatter && !fenced) {
            const markdown = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(text);
            // Plain headings must be labels, not commands or continuation prose.
            const plain =
                /^(How to [^.!?]+|Steps|Procedure|Instructions|Checklist|Workflow):\s*$/i.exec(
                    text,
                );
            if (markdown || plain)
                headings.push({
                    title: markdown?.[2] ?? plain![1],
                    level: markdown?.[1].length ?? 2,
                    line: lines.length,
                });
        }
        lines.push({
            text,
            start: match.index,
            end: match.index + match[0].length,
            fenced,
        });
    }
    return { lines, headings };
}

function actionable(title: string): boolean {
    return /(?:^Guide:|\b(?:how to|steps?|procedure|instructions?|checklist|workflow|setup|install(?:ation)?|configur(?:e|ation)|deploy(?:ment)?|publish|troubleshoot(?:ing)?)\b)/i.test(
        title,
    );
}

interface Task {
    heading: Heading;
    endLine: number;
}
interface SourceStructure {
    content: string;
    lines: Line[];
    headings: Heading[];
}
interface SelectedSteps {
    steps: string[];
    firstStepLine: number;
    stepStart: number;
    procedure?: Heading;
}
interface ContextRange {
    start: number;
    end: number;
    heading: string;
}

function selectSteps(
    source: SourceStructure,
    task: Task,
    children: Heading[],
): SelectedSteps {
    const { content, lines } = source;
    const { heading, endLine } = task;
    const procedure = children.find((item) =>
        /^(Procedure|Steps|Instructions|Checklist)$/i.test(item.title),
    );
    const stepStart = procedure ? procedure.line + 1 : heading.line + 1;
    const stepEnd = procedure
        ? (children.find(
              (item) =>
                  item.line > procedure.line && item.level <= procedure.level,
          )?.line ?? endLine)
        : endLine;
    const tasks = children.filter(
        (item) =>
            item.line >= stepStart &&
            item.line < stepEnd &&
            /^\d+[.)]\s+/.test(item.title),
    );
    if (tasks.length)
        return {
            ...(procedure ? { procedure } : {}),
            stepStart,
            firstStepLine: tasks[0].line,
            steps: tasks.map((item, index) =>
                content
                    .slice(
                        lines[item.line].start,
                        lines[(tasks[index + 1]?.line ?? stepEnd) - 1].end,
                    )
                    .replace(/\r\n?/g, "\n")
                    .trimEnd(),
            ),
        };
    const starts = lines.flatMap((line, index) =>
        index >= stepStart &&
        index < stepEnd &&
        !line.fenced &&
        /^(?: {0,3}\d+[.)]\s+| {0,3}[-*+]\s+\[[ xX]\]\s+)/.test(line.text)
            ? [index]
            : [],
    );
    return {
        ...(procedure ? { procedure } : {}),
        stepStart,
        firstStepLine: starts[0] ?? stepStart,
        steps: starts.map((start, index) => {
            const end = starts[index + 1] ?? stepEnd;
            const first = lines[start].text.replace(
                /^(?: {0,3}\d+[.)]\s+| {0,3}[-*+]\s+\[[ xX]\]\s+)/,
                "",
            );
            const continuation = content.slice(
                lines[start].end,
                lines[end - 1].end,
            );
            return `${first}${continuation ? "\n" + continuation : ""}`
                .replace(/\r\n?/g, "\n")
                .trimEnd();
        }),
    };
}

function documentSections(
    source: SourceStructure,
    children: Heading[],
    endLine: number,
    procedure?: Heading,
): ProcedureSection[] {
    if (!procedure) return [];
    return children
        .filter((item) => item.level === procedure.level && item !== procedure)
        .map((item) => {
            const end =
                children.find(
                    (next) => next.line > item.line && next.level <= item.level,
                )?.line ?? endLine;
            return {
                heading: item.title,
                content: source.content
                    .slice(
                        source.lines[item.line].end,
                        source.lines[end - 1].end,
                    )
                    .replace(/\r\n?/g, "\n")
                    .trim(),
            };
        });
}

function taskContext(
    source: SourceStructure,
    task: Task,
    selection: SelectedSteps,
): ContextRange[] {
    const { content, lines, headings } = source;
    const { heading, endLine } = task;
    const { firstStepLine, stepStart } = selection;
    const ranges: ContextRange[] = [];
    if (firstStepLine > stepStart)
        ranges.push({
            start: lines[stepStart].start,
            end: lines[firstStepLine].start,
            heading: "Task context",
        });
    const parent = [...headings]
        .reverse()
        .find((item) => item.line < heading.line && item.level < heading.level);
    if (parent) {
        const earlierTask = headings.find(
            (item) =>
                item.line > parent.line &&
                item.line < heading.line &&
                item.level === heading.level &&
                actionable(item.title),
        );
        if (!earlierTask)
            ranges.push({
                start: lines[parent.line].end,
                end: lines[heading.line].start,
                heading: "Prerequisites and scope",
            });
        const nextTask = headings.find(
            (item) =>
                item.line >= endLine &&
                (item.level <= parent.level ||
                    (item.level === heading.level && actionable(item.title))),
        );
        const relatedEnd = nextTask?.line ?? lines.length;
        if (endLine < relatedEnd)
            ranges.push({
                start: lines[endLine].start,
                end: lines[relatedEnd - 1].end,
                heading: "Verification and recovery context",
            });
    }
    return ranges.filter((range) =>
        content.slice(range.start, range.end).trim(),
    );
}

export function detectProcedureCandidates(
    corpusId: string,
    sourceId: string,
    revisionId: string,
    content: string,
): ProcedureCandidateCreateRequest[] {
    const { lines, headings } = scan(content);
    const source: SourceStructure = { content, lines, headings };
    const selected: Task[] = [];
    for (const heading of headings) {
        if (
            !actionable(heading.title) ||
            selected.some(
                (item) =>
                    heading.line > item.heading.line &&
                    heading.line < item.endLine,
            )
        )
            continue;
        const endLine =
            headings.find(
                (next) =>
                    next.line > heading.line && next.level <= heading.level,
            )?.line ?? lines.length;
        selected.push({ heading, endLine });
    }
    return selected.flatMap(({ heading, endLine }) => {
        const children = headings.filter(
            (item) => item.line > heading.line && item.line < endLine,
        );
        const task = { heading, endLine };
        const selection = selectSteps(source, task, children);
        const { steps, procedure } = selection;
        if (steps.length < 2) return [];
        const sections = documentSections(source, children, endLine, procedure);
        const retainedContext = taskContext(source, task, selection);
        sections.push(
            ...retainedContext.map((range) => ({
                heading: range.heading,
                content: content
                    .slice(range.start, range.end)
                    .replace(/\r\n?/g, "\n")
                    .trim(),
            })),
        );
        const title = /^(steps?|instructions?|procedure|checklist)$/i.test(
            heading.title,
        )
            ? (headings.find(
                  (item) => item.level === 1 && item.line < heading.line,
              )?.title ?? heading.title)
            : heading.title;
        const start = lines[heading.line].start;
        const end = lines[endLine - 1].end;
        const excerpt = content.slice(start, end);
        const identity = createHash("sha256")
            .update(`${sourceId}\n${revisionId}\n${start}\n${excerpt}`)
            .digest("hex");
        return [
            {
                corpusId,
                candidateId: `auto:${identity.slice(0, 32)}`,
                state: "detected" as const,
                title,
                steps,
                citations: [
                    {
                        sourceId,
                        revisionId,
                        locator: `chars:${start}-${end}`,
                        excerpt,
                    },
                    ...retainedContext.map((range) => ({
                        sourceId,
                        revisionId,
                        locator: `chars:${range.start}-${range.end}`,
                        excerpt: content.slice(range.start, range.end),
                    })),
                ],
                ...(sections.length ? { additionalSections: sections } : {}),
            },
        ];
    });
}
