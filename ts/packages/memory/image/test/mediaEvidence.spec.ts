// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EmbeddingIdentity, embeddingIdentityKey } from "@typeagent/aiclient";
import { MediaEvidenceLane, mediaAssetHash } from "../src/mediaEvidence.js";

const documentIdentity: EmbeddingIdentity = {
    schemaVersion: 1,
    provider: "synthetic",
    model: "pixel-fixture",
    revision: "1",
    dimensions: 2,
    task: "document",
    prompt: "",
    pooling: "mean",
    normalization: "l2",
    preprocessing: "fixture",
    artifactHash: "a".repeat(64),
};
const queryIdentity: EmbeddingIdentity = { ...documentIdentity, task: "query" };
const pairing = {
    queryIdentity: embeddingIdentityKey(queryIdentity),
    documentIdentity: embeddingIdentityKey(documentIdentity),
    evidenceSha256: "b".repeat(64),
};

describe("saved-vector media evidence", () => {
    const records = [
        {
            sourceId: "self",
            revision: "1",
            assetHash: mediaAssetHash("self"),
            vector: [1, 0],
            locations: [{ kind: "image" as const }],
        },
        {
            sourceId: "allowed",
            revision: "1",
            assetHash: mediaAssetHash("allowed"),
            vector: [0, 1],
            locations: [{ kind: "image" as const }],
        },
        {
            sourceId: "allowed",
            revision: "1",
            assetHash: mediaAssetHash("allowed"),
            vector: [0, 1],
            locations: [{ kind: "text" as const, chunkOrdinal: 1 }],
        },
    ];
    test.each(["text", "image", "mixed"] as const)(
        "prefilters and deduplicates %s query preserving evidence",
        (kind) => {
            const lane = new MediaEvidenceLane(documentIdentity, records);
            const hits = lane.search({
                identity: queryIdentity,
                vector: [1, 0],
                kind,
                pairing,
                sourceIds: ["allowed"],
                maxResults: 1,
            });
            expect(hits).toHaveLength(1);
            expect(hits[0].sourceId).toBe("allowed");
            expect(hits[0].locations).toHaveLength(2);
            expect(hits[0].queryKind).toBe(kind);
            expect(
                lane.search({
                    identity: queryIdentity,
                    vector: [1, 0],
                    kind,
                    pairing,
                    excludeSourceId: "self",
                    excludeAssetHash: mediaAssetHash("allowed"),
                }),
            ).toEqual([]);
        },
    );
    test("rejects same-size wrong identity and invalid vectors", () => {
        const lane = new MediaEvidenceLane(documentIdentity, records);
        expect(() =>
            lane.search({
                identity: { ...queryIdentity, revision: "wrong" },
                vector: [1, 0],
                kind: "text",
                pairing,
            }),
        ).toThrow("pairing");
        expect(
            () =>
                new MediaEvidenceLane(documentIdentity, [
                    { ...records[0], vector: [0, 0] },
                ]),
        ).toThrow("normalized");
    });
});
