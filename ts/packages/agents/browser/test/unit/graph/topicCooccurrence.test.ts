// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, it, expect } from "@jest/globals";
import { buildTopicCooccurrenceEdges } from "../../../src/agent/knowledge/utils/topicCooccurrence.mjs";

const topic = (name: string, sourceIds: string[]) => ({
    name,
    mentionCount: sourceIds.length,
    sourceIds,
});

describe("buildTopicCooccurrenceEdges", () => {
    it("relates topics that share sources and counts shared sources", () => {
        const edges = buildTopicCooccurrenceEdges([
            topic("typescript", ["a", "b"]),
            topic("compilers", ["a", "b", "c"]),
            topic("gardening", ["z"]),
        ]);
        expect(edges).toHaveLength(1);
        expect(edges[0]).toMatchObject({
            from: "compilers",
            to: "typescript",
            strength: 2,
        });
        expect(edges[0].confidence).toBeCloseTo(2 / 3);
    });

    it("returns no edges when topics share no sources", () => {
        expect(
            buildTopicCooccurrenceEdges([topic("a", ["1"]), topic("b", ["2"])]),
        ).toEqual([]);
    });

    it("keeps each topic's strongest neighbors without duplicate edges", () => {
        const topics = [
            topic("hub", ["s1", "s2", "s3"]),
            topic("strong", ["s1", "s2", "s3"]),
            topic("medium", ["s1", "s2"]),
            topic("weak", ["s3"]),
        ];
        const edges = buildTopicCooccurrenceEdges(topics, {
            maxNeighborsPerTopic: 1,
        });
        const keys = edges.map((edge) => `${edge.from}|${edge.to}`);
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys).toContain("hub|strong");
    });

    it("bounds work for sources with many topics", () => {
        const many = Array.from({ length: 200 }, (_, i) =>
            topic(`topic-${i}`, ["big"]),
        );
        const edges = buildTopicCooccurrenceEdges(many, {
            maxSourceFanout: 10,
        });
        const names = new Set(edges.flatMap((e) => [e.from, e.to]));
        expect(names.size).toBeLessThanOrEqual(10);
    });
});
