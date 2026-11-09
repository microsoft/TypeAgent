// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import { sha256, identity } from "./quality-contract.mjs";
import {
    prepareFreshWiki,
    relativeAssetPath,
    decodeUtf8,
    retainedText,
} from "./quality-freshwiki.mjs";

function fixture() {
    const article = {
        title: "Example widget",
        url: "https://example.org/wiki/widget",
        summary: "EVALUATOR SUMMARY ONLY",
        content: [
            {
                section_title: "EVALUATOR SECTION",
                section_content: [
                    {
                        sentence: "EVALUATOR SENTENCE ONLY",
                        refs: ["https://example.org/source"],
                    },
                ],
            },
        ],
    };
    const values = {
        "json/widget.json": JSON.stringify(article),
        "schema.txt":
            "Original test evidence: refs is an array of URL strings.",
        "snapshots/widget.txt": "Widget evidence.\r\nCafé 😀 final.",
    };
    const assets = Object.entries(values).map(([path, value]) => ({
        path,
        bytes: Buffer.from(value),
    }));
    const plan = {
        schemaVersion: 1,
        dataset: "freshwiki",
        custody: "development",
        release: {
            repository: "https://example.org/original-fixture",
            revision: "a".repeat(40),
            files: assets.map(({ path, bytes }) => ({
                path,
                sha256: sha256(bytes),
            })),
            license: {
                id: "original-fixture",
                terms: "Original authored test data only",
                reviewed: true,
            },
        },
        selection: [
            { path: "json/widget.json", recordIndex: 0, split: "development" },
        ],
        referenceSchema: {
            format: "url-string-array",
            evidenceVerified: true,
            evidencePath: "schema.txt",
            evidenceSha256: sha256(values["schema.txt"]),
        },
        sources: [
            {
                id: "widget-source",
                url: "https://example.org/source",
                path: "snapshots/widget.txt",
                sha256: sha256(values["snapshots/widget.txt"]),
                version: "snapshot-v1",
                title: "Widget source",
                availability: "available",
                license: {
                    id: "original-fixture",
                    terms: "Original source text",
                    reviewed: true,
                },
            },
        ],
    };
    return { article, assets, plan };
}

function replaceArticle(f, update) {
    update(f.article);
    const asset = f.assets.find((row) => row.path === "json/widget.json");
    asset.bytes = Buffer.from(JSON.stringify(f.article));
    f.plan.release.files.find((row) => row.path === asset.path).sha256 = sha256(
        asset.bytes,
    );
}

test("FreshWiki emits exact deterministic construction schema with no reference prose", () => {
    const f = fixture();
    const before = identity(f);
    const result = prepareFreshWiki(f.assets, f.plan);
    assert.deepEqual(result, prepareFreshWiki(f.assets, f.plan));
    assert.equal(identity(f), before);
    assert.deepEqual(Object.keys(result.construction), [
        "schemaVersion",
        "purpose",
        "dataset",
        "release",
        "bundles",
    ]);
    const bundle = result.construction.bundles[0];
    assert.deepEqual(Object.keys(bundle), [
        "id",
        "kind",
        "query",
        "aliases",
        "sources",
    ]);
    assert.equal(bundle.kind, "wiki");
    assert.equal(bundle.query, "Example widget");
    assert.doesNotMatch(JSON.stringify(result.construction), /EVALUATOR/);
    assert.equal(
        result.evaluator.cases[0].reference.summary,
        "EVALUATOR SUMMARY ONLY",
    );
    assert.equal(
        result.manifest.constructionHash,
        identity(result.construction),
    );
    assert.equal(result.manifest.evaluatorHash, identity(result.evaluator));
    assert.equal(
        result.manifest.availabilityHash,
        identity(result.availability),
    );
    assert.equal(result.manifest.cases[0].split, "development");
});

test("FreshWiki retains exact UTF8 bytes and half-open UTF16 coordinates", () => {
    const f = fixture();
    const source = prepareFreshWiki(f.assets, f.plan).construction.bundles[0]
        .sources[0];
    assert.equal(source.text, "Widget evidence.\r\nCafé 😀 final.");
    assert.equal(source.sha256, sha256(f.assets[2].bytes));
    assert.equal(source.text.slice(23, 25), "😀");
    const mapping = source.coordinateMap[0];
    assert.equal(mapping.coordinate.end, source.text.length);
    assert.equal(
        source.text.slice(mapping.retainedStart, mapping.retainedEnd),
        source.text,
    );
    assert.equal(source.authoredAt, undefined);
    assert.equal(source.provenance.chronology, "unknown");
    assert.equal(source.provenance.temporalConfound, "unknown");
});

test("FreshWiki opaque schemas do not guess URLs, identifiers or object shapes", () => {
    const f = fixture();
    delete f.plan.referenceSchema;
    replaceArticle(f, (article) => {
        article.content[0].section_content[0].refs = [
            "https://example.org/source",
            { url: "https://example.org/source" },
            "ref-1",
            null,
        ];
    });
    const result = prepareFreshWiki(f.assets, f.plan);
    assert.deepEqual(
        result.availability.map((row) => row.status),
        ["opaque-ref", "opaque-ref", "opaque-ref", "malformed-ref"],
    );
    assert.equal(result.construction.bundles[0].sources.length, 0);
    assert.equal(
        result.manifest.cases[0].availability,
        "no-available-evidence",
    );
    assert.doesNotMatch(JSON.stringify(result.construction), /ref-1/);
});

test("FreshWiki pinned ID evidence resolves only explicit mappings", () => {
    const f = fixture();
    f.plan.referenceSchema.format = "id-string-array";
    f.plan.referenceSchema.idToUrl = { "ref-1": "https://example.org/source" };
    replaceArticle(f, (article) => {
        article.content[0].section_content[0].refs = [
            "ref-1",
            "unknown",
            {},
            "bad",
        ];
    });
    f.plan.referenceSchema.idToUrl.bad = "file:///private";
    assert.deepEqual(
        prepareFreshWiki(f.assets, f.plan).availability.map(
            (row) => row.status,
        ),
        ["available", "unresolved", "malformed-ref", "malformed-ref"],
    );
});

test("FreshWiki preserves explicit source availability and malformed/empty refs", () => {
    for (const status of [
        "dead-url",
        "paywall",
        "denied-access",
        "unresolved",
        "not-acquired",
    ]) {
        const f = fixture();
        f.plan.sources[0] = {
            id: "unavailable",
            url: "https://example.org/source",
            availability: status,
            reason: "Original test unavailable",
        };
        const result = prepareFreshWiki(f.assets, f.plan);
        assert.equal(result.availability[0].status, status);
        assert.equal(
            result.availability[0].reason,
            "Original test unavailable",
        );
        assert.equal(result.construction.bundles[0].sources.length, 0);
    }
    for (const [refs, status] of [
        [[], "empty-refs"],
        [undefined, "malformed-refs"],
        [123, "malformed-refs"],
    ]) {
        const f = fixture();
        replaceArticle(f, (article) => {
            article.content[0].section_content[0].refs = refs;
        });
        assert.equal(
            prepareFreshWiki(f.assets, f.plan).availability[0].status,
            status,
        );
    }
    const f = fixture();
    f.plan.sources = [];
    assert.equal(
        prepareFreshWiki(f.assets, f.plan).availability[0].status,
        "not-acquired",
    );
});

test("FreshWiki deduplicates retained content while keeping all snapshot provenance", () => {
    const f = fixture();
    f.plan.sources.push({
        ...structuredClone(f.plan.sources[0]),
        id: "copy",
        version: "snapshot-v2",
        url: "https://example.org/copy",
    });
    replaceArticle(f, (article) => {
        article.content[0].section_content[0].refs.push(
            "https://example.org/copy",
            "https://example.org/source",
        );
    });
    const result = prepareFreshWiki(f.assets, f.plan);
    assert.equal(result.construction.bundles[0].sources.length, 1);
    assert.deepEqual(
        result.construction.bundles[0].sources[0].provenance.snapshots.map(
            (row) => row.id,
        ),
        ["widget-source", "copy"],
    );
    assert.deepEqual(
        result.availability.map((row) => row.sourceId),
        ["widget-source", "widget-source", "widget-source"],
    );
});

test("FreshWiki rejects unpinned/malformed sources, licenses, schema and custody", () => {
    const cases = [
        [
            (f) => {
                f.plan.release.revision = "main";
            },
            /Pinned full repository revision required/,
        ],
        [
            (f) => {
                f.plan.release.license.reviewed = false;
            },
            /terms review required/,
        ],
        [
            (f) => {
                f.plan.sources[0].license.reviewed = false;
            },
            /terms review required/,
        ],
        [
            (f) => {
                f.assets[2].bytes = Buffer.from("modified");
            },
            /Raw asset hash mismatch/,
        ],
        [
            (f) => {
                f.plan.sources[0].version = "";
            },
            /source version: required text/,
        ],
        [
            (f) => {
                f.plan.sources[0].sha256 = "b".repeat(64);
            },
            /Source pin mismatch/,
        ],
        [
            (f) => {
                f.plan.sources[0].availability = "guess";
            },
            /Unknown source availability/,
        ],
        [
            (f) => {
                f.plan.referenceSchema.format = "guessed";
            },
            /Unsupported reference schema/,
        ],
        [
            (f) => {
                f.plan.referenceSchema.evidenceSha256 = "b".repeat(64);
            },
            /Schema evidence pin mismatch/,
        ],
        [
            (f) => {
                f.plan.selection[0].split = "confirmation";
            },
            /split\/custody mismatch/,
        ],
        [
            (f) => {
                f.plan.selection.push(structuredClone(f.plan.selection[0]));
            },
            /Duplicate selected record/,
        ],
        [
            (f) => {
                f.plan.selection[0].recordIndex = 1;
            },
            /exactly one record/,
        ],
        [
            (f) => {
                f.plan.sources[0].path = f.plan.selection[0].path;
            },
            /Target reference article asset cannot be construction evidence/,
        ],
        [
            (f) => {
                replaceArticle(f, (article) => {
                    article.content[0].section_content.push(null);
                });
            },
            /Reference sentence must be an object/,
        ],
        [
            (f) => {
                replaceArticle(f, (article) => {
                    article.url = f.plan.sources[0].url;
                });
            },
            /Target reference article/,
        ],
        [
            (f) => {
                replaceArticle(f, (article) => {
                    delete article.content;
                });
            },
            /Article sections required/,
        ],
    ];
    for (const [mutate, message] of cases) {
        const f = fixture();
        mutate(f);
        assert.throws(() => prepareFreshWiki(f.assets, f.plan), message);
    }
});

test("UTF8 and path primitives reject lossy decoding, lone surrogates and traversal", () => {
    assert.throws(() => decodeUtf8(Uint8Array.of(0xff)), /encoded data/);
    assert.throws(
        () => retainedText("\ud800", "source"),
        /unpaired UTF-16 surrogate/,
    );
    assert.equal(decodeUtf8(Buffer.from("\uFEFFé")), "\uFEFFé");
    assert.equal(
        relativeAssetPath("snapshots\\widget.txt"),
        "snapshots/widget.txt",
    );
    for (const value of [
        "..\\private",
        "C:\\private",
        "\\absolute",
        "a/../b",
        "a//b",
        "file:stream",
        "a\0b",
        "NUL.txt",
        "snapshots\\CON",
        "a?.json",
        "file.txt ",
        "file.txt.",
    ]) {
        assert.throws(
            () => relativeAssetPath(value),
            /relative without traversal/,
        );
    }
});

test("FreshWiki authored time requires supplied pinned metadata, never acquisition clock", () => {
    const f = fixture();
    f.plan.sources[0].authoredAt = "2026-11-07T00:00:00Z";
    assert.throws(
        () => prepareFreshWiki(f.assets, f.plan),
        /asset path: required text/,
    );
    f.plan.sources[0].authoredAtEvidencePath = "schema.txt";
    const source = prepareFreshWiki(f.assets, f.plan).construction.bundles[0]
        .sources[0];
    assert.equal(source.authoredAt, "2026-11-07T00:00:00Z");
    assert.equal(source.provenance.chronology, "verified-source-metadata");
    f.plan.sources[0].authoredAt = "2026-11-07";
    assert.throws(
        () => prepareFreshWiki(f.assets, f.plan),
        /explicit timestamp/,
    );
});
