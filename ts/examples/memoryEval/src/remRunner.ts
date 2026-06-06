// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    EntityResolver,
    KnowledgeExtractionFeeder,
    OxigraphStore,
    RemAnswerGenerator,
    RemMemory,
    SignalStore,
} from "rem-memory";

// A memory system the benchmark can drive: ingest a corpus, then answer
// questions from it. Keeping this minimal interface lets a KnowProSystem
// adapter slot in later without touching the harness.
export interface MemorySystem {
    readonly name: string;
    ingest(text: string, source?: string): Promise<void>;
    answer(question: string): Promise<string>;
}

export type RemSystemOptions = {
    /** Characters per ingestion chunk handed to the extractor. */
    chunkSize?: number;
    /** Relations pulled into the answer context. */
    answerTopK?: number;
};

// End-to-end REM wiring: in-memory Oxigraph RDF graph + SQLite decay signals
// + entity resolver, fed by the knowledge-extraction feeder, answered by REM's
// native answer generator.
export class RemSystem implements MemorySystem {
    readonly name = "REM";

    private readonly memory: RemMemory;
    private readonly feeder: KnowledgeExtractionFeeder;
    private readonly answerer: RemAnswerGenerator;
    private readonly chunkSize: number;
    private readonly answerTopK: number;

    constructor(options: RemSystemOptions = {}) {
        const rdf = new OxigraphStore();
        const signals = new SignalStore(":memory:");
        const resolver = new EntityResolver();
        this.memory = new RemMemory(rdf, signals, resolver);
        this.feeder = new KnowledgeExtractionFeeder();
        this.answerer = new RemAnswerGenerator(this.memory);
        this.chunkSize = options.chunkSize ?? 2000;
        this.answerTopK = options.answerTopK ?? 12;
    }

    async ingest(text: string, source?: string): Promise<void> {
        const chunks = chunkText(text, this.chunkSize);
        for (let i = 0; i < chunks.length; i++) {
            const chunkSource =
                source !== undefined ? `${source}#${i}` : undefined;
            await this.memory.ingestFrom(this.feeder, {
                text: chunks[i],
                ...(chunkSource !== undefined ? { source: chunkSource } : {}),
            });
        }
    }

    async answer(question: string): Promise<string> {
        const result = await this.answerer.answer(question, {
            topK: this.answerTopK,
        });
        return result.answer;
    }
}

// Split text into chunks no larger than `size`, breaking on paragraph
// boundaries where possible so the extractor sees coherent passages.
export function chunkText(text: string, size: number): string[] {
    const paragraphs = text.split(/\n\s*\n/);
    const chunks: string[] = [];
    let current = "";
    for (const para of paragraphs) {
        const piece = para.trim();
        if (piece.length === 0) {
            continue;
        }
        if (current.length + piece.length + 2 > size && current.length > 0) {
            chunks.push(current);
            current = "";
        }
        if (piece.length > size) {
            // A single oversized paragraph: hard-split it.
            if (current.length > 0) {
                chunks.push(current);
                current = "";
            }
            for (let i = 0; i < piece.length; i += size) {
                chunks.push(piece.slice(i, i + size));
            }
            continue;
        }
        current = current.length > 0 ? `${current}\n\n${piece}` : piece;
    }
    if (current.length > 0) {
        chunks.push(current);
    }
    return chunks;
}
