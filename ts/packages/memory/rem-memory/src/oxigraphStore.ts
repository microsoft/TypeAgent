// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import oxigraph from "oxigraph";
import { RdfStore, RdfTerm, SparqlBindings } from "./rdfStore.js";

// Oxigraph-backed RdfStore.
//
// IMPORTANT: the Oxigraph JS (WASM) build is IN-MEMORY ONLY. Durability is
// provided here by snapshotting the whole store to an N-Quads file on flush()
// and reloading it on load(). This is adequate for a single-user v1; swapping
// to an on-disk quad engine later only requires another RdfStore implementation.

const NQUADS = "application/n-quads";

export class OxigraphStore implements RdfStore {
    private readonly store: oxigraph.Store;

    /**
     * @param snapshotPath Optional file path for N-Quads persistence. When
     * omitted the store is purely in-memory (flush/load are no-ops).
     */
    constructor(private readonly snapshotPath?: string) {
        this.store = new oxigraph.Store();
    }

    select(sparql: string): SparqlBindings[] {
        const results = this.store.query(sparql) as Array<
            Map<string, oxigraph.Term>
        >;
        return results.map((row) => {
            const out: SparqlBindings = new Map();
            for (const [variable, term] of row) {
                if (term !== undefined && term !== null) {
                    out.set(variable, term.value);
                }
            }
            return out;
        });
    }

    ask(sparql: string): boolean {
        return this.store.query(sparql) as boolean;
    }

    update(sparql: string): void {
        this.store.update(sparql);
    }

    addQuad(
        subject: string,
        predicate: string,
        object: RdfTerm,
        graph?: string,
    ): void {
        const quad = oxigraph.quad(
            oxigraph.namedNode(subject),
            oxigraph.namedNode(predicate),
            this.toTerm(object),
            graph ? oxigraph.namedNode(graph) : oxigraph.defaultGraph(),
        );
        this.store.add(quad);
    }

    async flush(): Promise<void> {
        if (this.snapshotPath === undefined) {
            return;
        }
        const data = this.store.dump({ format: NQUADS });
        await mkdir(dirname(this.snapshotPath), { recursive: true });
        await writeFile(this.snapshotPath, data, "utf8");
    }

    async load(): Promise<void> {
        if (this.snapshotPath === undefined || !existsSync(this.snapshotPath)) {
            return;
        }
        const data = await readFile(this.snapshotPath, "utf8");
        if (data.length > 0) {
            this.store.load(data, { format: NQUADS });
        }
    }

    private toTerm(term: RdfTerm): oxigraph.NamedNode | oxigraph.Literal {
        if (term.kind === "iri") {
            return oxigraph.namedNode(term.value);
        }
        if (term.language !== undefined) {
            return oxigraph.literal(term.value, term.language);
        }
        if (term.datatype !== undefined) {
            return oxigraph.literal(
                term.value,
                oxigraph.namedNode(term.datatype),
            );
        }
        return oxigraph.literal(term.value);
    }
}
