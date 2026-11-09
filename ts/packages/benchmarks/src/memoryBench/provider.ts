// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { z } from "zod";
import type { Document, Evidence, Host } from "./types.js";
import {
    digest,
    list,
    object,
    readJson,
    saveJson,
    string,
    text,
} from "./storage.js";

const sourceSchema = z.object({
    id: z.string(),
    unit: z.string(),
    hash: z.string(),
    sourceId: z.string(),
    ready: z.boolean(),
    turns: z.number(),
    sourceIds: z.array(z.string()),
    ingestionSeconds: z.number().optional(),
});
const stateSchema = z.object({
    fingerprint: z.string(),
    units: z.record(z.string(), z.string()),
    documents: z.record(z.string(), sourceSchema),
});
type Source = z.infer<typeof sourceSchema>;
type State = z.infer<typeof stateSchema>;
export class MemoryProvider {
    private state: State;
    private file: string | undefined;
    constructor(
        private host: Host,
        fingerprint: string,
        private events = false,
    ) {
        this.state = { fingerprint, units: {}, documents: {} };
    }
    private async save() {
        if (!this.file) throw new Error("Provider prepare() has not run");
        await saveJson(this.file, this.state);
    }
    public async prepare(directory: string, units: Set<string>) {
        this.file = path.join(directory, "provider-state.json");
        const previous = await readJson(this.file);
        if (previous !== undefined) {
            const state = stateSchema.parse(previous);
            if (state.fingerprint !== this.state.fingerprint)
                throw new Error(
                    "Store fingerprint mismatch; choose a new run directory",
                );
            this.state = state;
        }
        for (const unit of [...units].sort())
            if (!this.state.units[unit]) {
                const corpus = object(
                    await this.host.execute({
                        operation: "createCorpus",
                        name: `benchmark-${digest(unit).slice(0, 20)}`,
                    }),
                );
                this.state.units[unit] = text(corpus.corpusId);
                await this.save();
            }
    }
    private corpus(unit: string, requireReady = false): string {
        const corpus = this.state.units[unit];
        if (!corpus) throw new Error(`Unknown benchmark unit: ${unit}`);
        if (
            requireReady &&
            Object.values(this.state.documents).some(
                (doc) => doc.unit === unit && !doc.ready,
            )
        )
            throw new Error("Cannot query an incomplete import");
        return corpus;
    }
    public async ingest(documents: Document[]) {
        const pending: { doc: Document; record: Source }[] = [];
        for (const doc of documents) {
            this.corpus(doc.unit);
            const sourceId = digest([doc.unit, doc.id]),
                hash = digest([doc.content, doc.messages, doc.timestamp]);
            const previous = this.state.documents[sourceId];
            if (previous && previous.hash !== hash)
                throw new Error("Source content changed within a pinned run");
            if (previous?.ready) continue;
            const record: Source = {
                id: doc.id,
                unit: doc.unit,
                hash,
                sourceId,
                ready: false,
                turns: doc.messages.length,
                sourceIds: doc.sourceIds,
            };
            this.state.documents[sourceId] = record;
            await this.save();
            pending.push({ doc, record });
        }
        if (this.events) await this.ingestEvents(pending);
        else await this.ingestContent(pending);
    }
    private async ingestEvents(pending: { doc: Document; record: Source }[]) {
        for (const { doc, record } of pending) {
            if (!doc.messages.length)
                throw new Error("Event import requires original turns");
            const started = performance.now();
            for (let offset = 0; offset < doc.messages.length; offset += 100)
                await this.host.execute({
                    operation: "appendEvents",
                    corpusId: this.corpus(doc.unit),
                    conversationId: doc.unit,
                    fingerprint: this.state.fingerprint,
                    turns: doc.messages
                        .slice(offset, offset + 100)
                        .map((turn) => ({ ...turn, documentId: doc.id })),
                });
            record.ready = true;
            record.ingestionSeconds = (performance.now() - started) / 1000;
            await this.save();
        }
        if (pending.length)
            await this.retrieve(
                "benchmark index readiness",
                pending[0].doc.unit,
            );
    }
    private async ingestContent(pending: { doc: Document; record: Source }[]) {
        let group: typeof pending = [],
            size = 0;
        for (const item of pending) {
            const bytes = Buffer.byteLength(
                JSON.stringify(this.payload(item)),
                "utf8",
            );
            if (bytes > 6 * 1024 * 1024)
                throw new Error(
                    "Individual source exceeds bounded import limit",
                );
            if (
                group.length &&
                (size + bytes > 6 * 1024 * 1024 ||
                    group[0].doc.unit !== item.doc.unit)
            ) {
                await this.batch(group);
                group = [];
                size = 0;
            }
            group.push(item);
            size += bytes;
        }
        if (group.length) await this.batch(group);
    }
    private payload({ doc, record }: { doc: Document; record: Source }) {
        return {
            sourceId: record.sourceId,
            title: doc.title,
            content: doc.content,
            timestamp: doc.timestamp,
        };
    }
    private async batch(group: { doc: Document; record: Source }[]) {
        const unit = group[0].doc.unit,
            started = performance.now();
        await this.host.execute({
            operation: "ingestBatch",
            corpusId: this.corpus(unit),
            fingerprint: digest([
                this.state.fingerprint,
                unit,
                group.map(({ record }) => [record.sourceId, record.hash]),
            ]),
            documents: group.map((item) => this.payload(item)),
        });
        for (const { record } of group) {
            record.ready = true;
            record.ingestionSeconds = (performance.now() - started) / 1000;
        }
        await this.save();
    }
    private record(sourceId: string, unit: string): Source {
        const record = this.state.documents[sourceId];
        if (!record || record.unit !== unit)
            throw new Error("Evidence belongs to an unknown or different unit");
        return record;
    }
    public async retrieve(query: string, unit: string): Promise<Evidence[]> {
        const response = object(
            await this.host.execute({
                operation: this.events ? "searchEvents" : "search",
                corpusId: this.corpus(unit, true),
                query,
                limit: 10,
                ...(this.events ? { conversationId: unit } : {}),
            }),
        );
        let remaining = 24000;
        const evidence: Evidence[] = [];
        for (const value of list(response.matches)) {
            const match = object(value);
            const { record, content } = this.matchEvidence(match, unit);
            if (remaining <= 0) break;
            if (!content) continue;
            const bounded = Array.from(content).slice(0, remaining).join("");
            remaining -= Array.from(bounded).length;
            evidence.push({
                id: record.id,
                content: bounded,
                sourceIds: record.sourceIds,
            });
        }
        return evidence;
    }
    private matchEvidence(match: Record<string, unknown>, unit: string) {
        if (!this.events)
            return {
                record: this.record(text(match.sourceId), unit),
                content: string(match.snippet),
            };
        const event = object(match.event),
            metadata = object(event.metadata);
        const record = Object.values(this.state.documents).find(
            (doc) => doc.id === metadata.sourceDocumentId && doc.unit === unit,
        );
        if (!record || event.conversationId !== unit)
            throw new Error(
                "Event evidence belongs to an unknown or different unit",
            );
        return { record, content: string(event.content) };
    }
    public async directAnswer(query: string, unit: string, timestamp?: string) {
        if (this.events)
            throw new Error("Native event answers are not implemented");
        const result = object(
            await this.host.execute({
                operation: "answer",
                corpusId: this.corpus(unit, true),
                question: timestamp
                    ? `Reference date for interpreting relative dates: ${timestamp}\n${query}`
                    : query,
            }),
        );
        if (result.mode !== "synthesized")
            throw new Error("Native answer unexpectedly became extractive");
        const aliases = new Set<string>(),
            snippets: string[] = [];
        for (const value of list(result.citations)) {
            const citation = object(value),
                record = this.record(text(citation.sourceId), unit);
            record.sourceIds.forEach((id) => aliases.add(id));
            snippets.push(string(citation.snippet));
        }
        return {
            answer: string(result.answer),
            context: snippets.join("\n\n"),
            nativeAnswer: result,
            retrievedSourceIds: [...aliases].sort(),
        };
    }
}
