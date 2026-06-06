// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OxigraphStore } from "../src/oxigraphStore.js";
import { iri, literal } from "../src/rdfStore.js";

const EX = "http://example.org/";

describe("OxigraphStore", () => {
    test("adds quads and answers a SPARQL SELECT", () => {
        const store = new OxigraphStore();
        store.addQuad(`${EX}alice`, `${EX}name`, literal("Alice"));
        store.addQuad(`${EX}alice`, `${EX}knows`, iri(`${EX}bob`));

        const rows = store.select(
            `SELECT ?name WHERE { <${EX}alice> <${EX}name> ?name }`,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].get("name")).toBe("Alice");
    });

    test("ask returns booleans", () => {
        const store = new OxigraphStore();
        store.addQuad(`${EX}a`, `${EX}p`, iri(`${EX}b`));
        expect(store.ask(`ASK { <${EX}a> <${EX}p> <${EX}b> }`)).toBe(true);
        expect(store.ask(`ASK { <${EX}a> <${EX}p> <${EX}z> }`)).toBe(false);
    });

    test("update inserts and deletes data", () => {
        const store = new OxigraphStore();
        store.update(`INSERT DATA { <${EX}x> <${EX}p> "v" }`);
        expect(store.ask(`ASK { <${EX}x> <${EX}p> "v" }`)).toBe(true);
        store.update(`DELETE DATA { <${EX}x> <${EX}p> "v" }`);
        expect(store.ask(`ASK { <${EX}x> <${EX}p> "v" }`)).toBe(false);
    });

    test("writes quads into named graphs (provenance)", () => {
        const store = new OxigraphStore();
        store.addQuad(`${EX}s`, `${EX}p`, iri(`${EX}o`), `${EX}graph/obs1`);
        const rows = store.select(
            `SELECT ?g WHERE { GRAPH ?g { <${EX}s> <${EX}p> <${EX}o> } }`,
        );
        expect(rows[0].get("g")).toBe(`${EX}graph/obs1`);
    });

    test("flush and load round-trip via N-Quads snapshot", async () => {
        const dir = mkdtempSync(join(tmpdir(), "rem-oxi-"));
        const snapshot = join(dir, "store.nq");
        try {
            const a = new OxigraphStore(snapshot);
            a.addQuad(`${EX}alice`, `${EX}name`, literal("Alice"));
            a.addQuad(`${EX}s`, `${EX}p`, iri(`${EX}o`), `${EX}g1`);
            await a.flush();

            const b = new OxigraphStore(snapshot);
            await b.load();
            const rows = b.select(
                `SELECT ?name WHERE { <${EX}alice> <${EX}name> ?name }`,
            );
            expect(rows[0].get("name")).toBe("Alice");
            expect(
                b.ask(`ASK { GRAPH <${EX}g1> { <${EX}s> <${EX}p> <${EX}o> } }`),
            ).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
