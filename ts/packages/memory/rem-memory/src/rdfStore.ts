// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Storage-agnostic RDF interface. The Oxigraph-backed implementation lives in
// oxigraphStore.ts. Keeping this interface separate lets us swap the engine
// (e.g. for an on-disk quad store) without touching the rest of REM.

/** A SPARQL SELECT result row: variable name -> term string value. */
export type SparqlBindings = Map<string, string>;

/**
 * Minimal RDF quad store surface used by REM. Existence and provenance live
 * here; the decay signal lives in the SQLite signal store.
 */
export interface RdfStore {
    /** Run a SPARQL 1.1 query. SELECT returns rows; ASK returns a boolean. */
    select(sparql: string): SparqlBindings[];
    ask(sparql: string): boolean;

    /** Run a SPARQL 1.1 UPDATE (INSERT/DELETE). */
    update(sparql: string): void;

    /** Add a single quad (subject, predicate, object[, graph]). */
    addQuad(
        subject: string,
        predicate: string,
        object: RdfTerm,
        graph?: string,
    ): void;

    /**
     * Persist the current store contents to durable storage. For the in-memory
     * Oxigraph engine this writes an N-Quads snapshot to disk.
     */
    flush(): Promise<void>;

    /** Load durable contents into the store (inverse of {@link flush}). */
    load(): Promise<void>;
}

/** An RDF object term: either an IRI reference or a typed/plain literal. */
export type RdfTerm =
    | { kind: "iri"; value: string }
    | {
          kind: "literal";
          value: string;
          datatype?: string | undefined;
          language?: string | undefined;
      };

/** Convenience: build an IRI object term. */
export function iri(value: string): RdfTerm {
    return { kind: "iri", value };
}

/** Convenience: build a literal object term. */
export function literal(
    value: string | number | boolean,
    datatype?: string,
): RdfTerm {
    return { kind: "literal", value: String(value), datatype };
}
