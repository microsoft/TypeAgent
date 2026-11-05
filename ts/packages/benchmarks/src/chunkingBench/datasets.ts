// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
    bytesHash,
    list,
    object,
    string,
    text,
} from "../memoryBench/storage.js";
import {
    datasetSchema,
    type Dataset,
    type DatasetName,
    type Document,
    type Span,
} from "./types.js";

export function codePointOffsets(value: string): number[] {
    const offsets = [0];
    for (const point of value)
        offsets.push(offsets[offsets.length - 1] + point.length);
    return offsets;
}

export function validateSpan(
    span: Span,
    documents: ReadonlyMap<string, Document>,
) {
    const document = documents.get(span.documentId);
    if (!document)
        throw new Error(`Unknown evidence document: ${span.documentId}`);
    const boundaries = [span.start, span.end];
    if (
        !boundaries.every(Number.isSafeInteger) ||
        span.start < 0 ||
        span.end <= span.start ||
        span.end > document.text.length ||
        boundaries.some(
            (offset) =>
                offset > 0 &&
                offset < document.text.length &&
                /[\uDC00-\uDFFF]/u.test(document.text[offset]) &&
                /[\uD800-\uDBFF]/u.test(document.text[offset - 1]),
        )
    )
        throw new Error(
            `Invalid Unicode evidence range: ${JSON.stringify(span)}`,
        );
}

export function validateDataset(value: unknown): Dataset {
    const dataset = datasetSchema.parse(value);
    const documents = new Map(dataset.documents.map((doc) => [doc.id, doc]));
    if (documents.size !== dataset.documents.length)
        throw new Error("Duplicate document ID");
    const questions = new Set<string>();
    for (const doc of dataset.documents)
        for (const section of doc.sections)
            validateSpan({ documentId: doc.id, ...section }, documents);
    for (const question of dataset.questions) {
        if (questions.has(question.id))
            throw new Error("Duplicate question ID");
        questions.add(question.id);
        for (const span of question.gold) validateSpan(span, documents);
    }
    return dataset;
}

function renderDocument(id: string, title: string) {
    const document: Document = { id, title, text: "", sections: [] };
    const append = (value: string, heading = "") => {
        const start = document.text.length;
        document.text += value;
        document.sections.push({ start, end: document.text.length, heading });
        return { documentId: id, start, end: document.text.length };
    };
    return { document, append };
}

type Adapted = Pick<
    Dataset,
    "documents" | "questions" | "exclusions" | "annotationPolicy"
>;

export function adaptQasper(value: unknown): Adapted {
    const result: Adapted = {
        documents: [],
        questions: [],
        exclusions: [],
        annotationPolicy:
            "first answerable annotation with entirely unambiguous paragraph evidence; no answer text indexed",
    };
    for (const [id, raw] of Object.entries(object(value)).sort(([a], [b]) =>
        a.localeCompare(b),
    )) {
        const paper = object(raw);
        const { document, append } = renderDocument(id, text(paper.title));
        append(`# ${document.title}\n\n`);
        if (string(paper.abstract))
            append(`${string(paper.abstract)}\n\n`, "Abstract");
        const evidence = new Map<string, Span[]>();
        for (const rawSection of list(paper.full_text)) {
            const section = object(rawSection);
            const heading =
                section.section_name === null
                    ? ""
                    : string(section.section_name);
            if (heading) append(`## ${heading}\n\n`, heading);
            for (const paragraph of list(section.paragraphs).map(string)) {
                if (!paragraph) continue;
                const span = append(paragraph, heading);
                evidence.set(paragraph, [
                    ...(evidence.get(paragraph) ?? []),
                    span,
                ]);
                append("\n\n", heading);
            }
        }
        result.documents.push(document);
        for (const rawQuestion of list(paper.qas)) {
            const question = object(rawQuestion);
            const questionId = `${id}:${text(question.question_id)}`;
            const gold = qasperGold(
                list(question.answers),
                evidence,
                questionId,
            );
            if (!gold) {
                result.exclusions.push({
                    id: questionId,
                    reason: "No answerable annotation with nonempty, unique paragraph evidence (includes figure/table or unresolved evidence)",
                });
                continue;
            }
            result.questions.push({
                id: questionId,
                text: text(question.question),
                groupId: id,
                gold,
            });
        }
    }
    return result;
}

function qasperGold(
    answers: unknown[],
    evidence: ReadonlyMap<string, Span[]>,
    questionId: string,
): Span[] | undefined {
    for (const rawAnswer of answers) {
        const answer = object(object(rawAnswer).answer);
        if (typeof answer.unanswerable !== "boolean")
            throw new Error(`Invalid Qasper answerability: ${questionId}`);
        if (answer.unanswerable) continue;
        const snippets = list(answer.evidence).map(string);
        if (
            !snippets.length ||
            snippets.some((snippet) => evidence.get(snippet)?.length !== 1)
        )
            continue;
        return snippets.map((snippet) => evidence.get(snippet)![0]);
    }
    return undefined;
}

export function adaptQmsum(lines: string): Adapted {
    const result: Adapted = {
        documents: [],
        questions: [],
        exclusions: [],
        annotationPolicy:
            "specific-query inclusive utterance spans; original speakers; no topic annotations or answers indexed",
    };
    for (const [index, line] of lines.trim().split(/\r?\n/u).entries()) {
        const meeting = object(JSON.parse(line));
        const id = `meeting-${String(index).padStart(4, "0")}`;
        const { document, append } = renderDocument(id, id);
        const spans = list(meeting.meeting_transcripts).map((value) => {
            const turn = object(value);
            const span = append(
                `${text(turn.speaker)}: ${string(turn.content)}`,
            );
            append("\n");
            return span;
        });
        result.documents.push(document);
        for (const [number, rawQuery] of list(
            meeting.specific_query_list,
        ).entries()) {
            const query = object(rawQuery);
            const gold = list(query.relevant_text_span).map((rawSpan) => {
                const pair = list(rawSpan);
                if (
                    pair.length !== 2 ||
                    !pair.every(
                        (item) =>
                            typeof item === "string" && /^\d+$/u.test(item),
                    )
                )
                    throw new Error("Invalid QMSum utterance range");
                const [start, end] = pair.map(Number);
                if (start > end || !spans[start] || !spans[end])
                    throw new Error("QMSum utterance range is out of bounds");
                return {
                    documentId: id,
                    start: spans[start].start,
                    end: spans[end].end,
                };
            });
            const questionId = `${id}:specific-${number}`;
            if (!gold.length) {
                result.exclusions.push({
                    id: questionId,
                    reason: "Specific query without evidence",
                });
                continue;
            }
            result.questions.push({
                id: questionId,
                text: text(query.query),
                groupId: id,
                gold,
            });
        }
        for (const [number] of list(meeting.general_query_list).entries())
            result.exclusions.push({
                id: `${id}:general-${number}`,
                reason: "General query has no supplied evidence spans",
            });
    }
    return result;
}

async function filesUnder(root: string): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
        if (entry.isSymbolicLink())
            throw new Error("Dataset links are not supported");
        const file = path.join(root, entry.name);
        if (entry.isDirectory()) files.push(...(await filesUnder(file)));
        else if (entry.isFile()) files.push(file);
    }
    return files.sort();
}

export async function adaptLegalBench(
    root: string,
): Promise<Adapted & { hashes: [string, string][] }> {
    const corpus = path.join(root, "corpus");
    const result: Adapted & { hashes: [string, string][] } = {
        documents: [],
        questions: [],
        exclusions: [],
        hashes: [],
        annotationPolicy:
            "published snippet ranges in Python Unicode coordinates converted to UTF-16; all corpus files searched",
    };
    for (const file of await filesUnder(corpus)) {
        const bytes = await readFile(file);
        const id = path.relative(corpus, file).split(path.sep).join("/");
        result.hashes.push([`corpus/${id}`, bytesHash(bytes)]);
        result.documents.push({
            id,
            title: id,
            text: new TextDecoder("utf-8", { fatal: true })
                .decode(bytes)
                .replace(/\r\n?/gu, "\n"),
            sections: [],
        });
    }
    const documents = new Map(result.documents.map((doc) => [doc.id, doc]));
    for (const file of await filesUnder(path.join(root, "benchmarks"))) {
        if (!file.endsWith(".json")) continue;
        const bytes = await readFile(file);
        const name = path.relative(root, file).split(path.sep).join("/");
        result.hashes.push([name, bytesHash(bytes)]);
        for (const [index, raw] of list(
            object(JSON.parse(bytes.toString("utf8"))).tests,
        ).entries()) {
            const query = object(raw);
            const gold = list(query.snippets).map((rawSnippet) => {
                const snippet = object(rawSnippet);
                const id = text(snippet.file_path);
                const doc = documents.get(id);
                if (!doc)
                    throw new Error(`Unknown LegalBench corpus path: ${id}`);
                const pair = list(snippet.span);
                const offsets = codePointOffsets(doc.text);
                if (
                    pair.length !== 2 ||
                    !pair.every(
                        (n) =>
                            typeof n === "number" &&
                            Number.isSafeInteger(n) &&
                            n >= 0 &&
                            n < offsets.length,
                    )
                )
                    throw new Error(`Invalid LegalBench span: ${id}`);
                const [start, end] = pair.map(Number);
                return {
                    documentId: id,
                    start: offsets[start],
                    end: offsets[end],
                };
            });
            if (!gold.length) {
                result.exclusions.push({
                    id: `${name}:${index}`,
                    reason: "No published snippets",
                });
                continue;
            }
            result.questions.push({
                id: `${name}:${index}`,
                text: text(query.query),
                groupId: gold
                    .map((span) => span.documentId)
                    .sort()
                    .join("|"),
                gold,
            });
        }
    }
    return result;
}

export async function prepareDataset(
    dataset: DatasetName,
    input: string,
    split: string,
    source: string,
): Promise<Dataset> {
    let adapted: Adapted;
    let sha256: string;
    if (dataset === "legalbenchrag") {
        const result = await adaptLegalBench(input);
        adapted = result;
        sha256 = bytesHash(JSON.stringify(result.hashes));
    } else {
        const bytes = await readFile(input);
        sha256 = bytesHash(bytes);
        const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        adapted =
            dataset === "qasper"
                ? adaptQasper(JSON.parse(content))
                : adaptQmsum(content);
    }
    return validateDataset({
        version: "chunking-span-v1",
        protocol: "independent-not-article-parity",
        coordinateSpace: "utf16-code-point-boundaries",
        dataset,
        split,
        provenance: [{ source, sha256 }],
        documents: adapted.documents,
        questions: adapted.questions,
        exclusions: adapted.exclusions,
        annotationPolicy: adapted.annotationPolicy,
    });
}
