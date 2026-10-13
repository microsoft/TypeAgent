// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { validateBuildRequest } from "../src/viewBuildValidation.js";
import { createInventoryConstructionSchema } from "../src/viewSynthesisSchemas.js";
import { validateWiki } from "../src/wiki.js";
import { validateViewDraft } from "../src/viewValidation.js";
import type { ViewBuildRequest, WikiContent } from "../src/viewTypes.js";

function indexedRequest(): ViewBuildRequest {
    return {
        corpusId: "c",
        expectedHead: null,
        targets: [
            {
                expectedVersion: 0,
                definition: {
                    viewId: "page",
                    kind: "wiki",
                    selector: {
                        kind: "sources",
                        sources: [{ sourceId: "s", revisionId: "r" }],
                    },
                    wiki: {
                        construction: "informational-wiki-v1",
                        query: "payments",
                        aliases: [],
                        excludedSourceIds: [],
                    },
                },
            },
        ],
    };
}

test("strict construction accepts only indexed wiki definitions, not absent/obsolete versions or subject registries", () => {
    expect(() => validateBuildRequest(indexedRequest())).not.toThrow();
    const missing = indexedRequest();
    delete missing.targets[0].definition.wiki;
    expect(() => validateBuildRequest(missing)).toThrow(
        "informational-wiki-v1",
    );
    const obsolete = indexedRequest();
    Object.assign(obsolete.targets[0].definition.wiki!, {
        construction: "wiki-v1",
    });
    expect(() => validateBuildRequest(obsolete)).toThrow(
        "Invalid informational",
    );
    const registry = indexedRequest();
    Object.assign(registry.targets[0].definition, {
        maintenance: {
            schemaVersion: 1,
            scope: { mode: "pinned" },
            wikiDiscovery: {
                rules: "explicit-subjects-v1",
                createDraftPages: true,
                subjects: [],
            },
        },
    });
    expect(() => validateBuildRequest(registry)).toThrow(
        "informational-wiki-v1 family",
    );
    expect(() => createInventoryConstructionSchema(["fact"], "wiki")).toThrow(
        "informational-wiki-v1",
    );
});

test("old inventory-backed content rejects without a compatibility alias", () => {
    const old: WikiContent = {
        kind: "wiki",
        construction: "informational-wiki-v1",
        title: "Page",
        summary: "Limited summary: selected indexed fragments only;",
        index: [{ pageId: "page", title: "Page", taxonomy: "concept" }],
        sections: [
            {
                id: "page",
                role: "page",
                heading: "Page",
                body: "Evidence",
                details: {
                    kind: "page",
                    construction: "informational-wiki-v1",
                    taxonomy: "concept",
                    note: "",
                    mergedPageIds: [],
                },
            },
        ],
        citations: [],
    };
    Object.assign(old, { construction: "wiki-v1" });
    expect(() => validateWiki(old)).toThrow("informational-wiki-v1");
    Object.assign(old, { construction: "informational-wiki-v1" });
    Object.assign(old.sections[0].details, { inventoryIds: ["fact"] });
    expect(() => validateWiki(old)).toThrow("Invalid informational");
    Reflect.deleteProperty(old.sections[0].details, "inventoryIds");
    const citation = {
        sourceId: "s",
        revisionId: "r",
        locator: `indexed:0:${"a".repeat(64)}:0-8`,
        excerpt: "Evidence",
    };
    const edge = {
        id: "bundle-link",
        predicate: "supportedBy" as const,
        from: { kind: "section" as const, viewId: "page", sectionId: "page" },
        to: { kind: "source" as const, sourceId: "s", revisionId: "r" },
        citations: [citation],
    };
    Object.assign(edge, {
        predicate: "contradicts",
        to: { kind: "section", viewId: "page", sectionId: "page" },
    });
    expect(() =>
        validateViewDraft({
            corpusId: "c",
            viewId: "page",
            expectedHead: null,
            expectedVersion: 0,
            definition: indexedRequest().targets[0].definition,
            content: old,
            relationships: [edge],
        }),
    ).toThrow("Unsupported relationship predicate");
});

test("service rejects obsolete requests before source reads, jobs or synthesis", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wiki-cleanup-reject-"));
    let generated = 0;
    const service = new FileMemoryService(root, {
        viewSynthesisAdapter: {
            identity: "no-obsolete-construction",
            generate: async () => {
                generated++;
                throw new Error("Unexpected synthesis");
            },
            validate: async () => {
                throw new Error("Unexpected validation");
            },
        },
    });
    try {
        const { corpusId } = await service.createCorpus("Old wiki rejection");
        const request = indexedRequest();
        request.corpusId = corpusId;
        delete request.targets[0].definition.wiki;
        await expect(service.buildViews(request)).rejects.toThrow(
            "informational-wiki-v1",
        );
        expect(await service.listViewBuilds(corpusId)).toEqual([]);
        expect(generated).toBe(0);
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
});
