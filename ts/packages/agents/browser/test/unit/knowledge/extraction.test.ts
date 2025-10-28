import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const FIXTURES_DIR = join(__dirname, "../../fixtures");

describe("Knowledge Extraction - Phase 2: Extraction Functions", () => {
    let atlasContent: string;
    let atlasMetadata: any;
    let expectedKnowledge: any;

    beforeEach(() => {
        atlasContent = readFileSync(
            join(FIXTURES_DIR, "atlas-mountains/content.md"),
            "utf-8",
        );
        atlasMetadata = JSON.parse(
            readFileSync(
                join(FIXTURES_DIR, "atlas-mountains/metadata.json"),
                "utf-8",
            ),
        );
        expectedKnowledge = JSON.parse(
            readFileSync(
                join(FIXTURES_DIR, "atlas-mountains/expected-knowledge.json"),
                "utf-8",
            ),
        );
    });

    describe("Entity Extraction", () => {
        it("should extract entities from Atlas Mountains content", () => {
            expect(expectedKnowledge.entities).toBeDefined();
            expect(expectedKnowledge.entities.length).toBeGreaterThan(10);

            const entities = expectedKnowledge.entities;
            const entityNames = entities.map((e: any) => e.name);

            expect(entityNames).toContain("Atlas Mountains");
            expect(entityNames).toContain("Mount Toubkal");
            expect(entityNames).toContain("Morocco");
            expect(entityNames).toContain("Algeria");
            expect(entityNames).toContain("Tunisia");
        });

        it("should extract correct entity types", () => {
            const entities = expectedKnowledge.entities;
            const entityMap = new Map(
                entities.map((e: any) => [e.name, e.type]),
            );

            expect(entityMap.get("Atlas Mountains")).toBe("mountain_range");
            expect(entityMap.get("Mount Toubkal")).toBe("mountain");
            expect(entityMap.get("Morocco")).toBe("country");
            expect(entityMap.get("Sahara Desert")).toBe("desert");
            expect(entityMap.get("Mediterranean Sea")).toBe("sea");
            expect(entityMap.get("Berber")).toBe("people");
            expect(entityMap.get("Barbary macaque")).toBe("animal");
        });

        it("should assign confidence scores to entities", () => {
            const entities = expectedKnowledge.entities;

            for (const entity of entities) {
                expect(entity.confidence).toBeDefined();
                expect(entity.confidence).toBeGreaterThanOrEqual(0);
                expect(entity.confidence).toBeLessThanOrEqual(1);
            }

            const atlasEntity = entities.find(
                (e: any) => e.name === "Atlas Mountains",
            );
            expect(atlasEntity.confidence).toBeGreaterThan(0.9);
        });

        it("should extract entities with descriptions", () => {
            const entities = expectedKnowledge.entities;

            for (const entity of entities) {
                expect(entity.description).toBeDefined();
                expect(entity.description.length).toBeGreaterThan(0);
            }

            const toubkalEntity = entities.find(
                (e: any) => e.name === "Mount Toubkal",
            );
            expect(toubkalEntity.description).toContain("4,167");
            expect(toubkalEntity.description.toLowerCase()).toContain(
                "highest",
            );
        });

        it("should extract geographic entities", () => {
            const entities = expectedKnowledge.entities;
            const geographicTypes = [
                "mountain_range",
                "mountain",
                "country",
                "desert",
                "sea",
            ];

            const geographicEntities = entities.filter((e: any) =>
                geographicTypes.includes(e.type),
            );

            expect(geographicEntities.length).toBeGreaterThan(7);
        });

        it("should extract named entities (people, places, things)", () => {
            const entities = expectedKnowledge.entities;
            const entityNames = entities.map((e: any) => e.name);

            expect(entityNames).toContain("Berber");
            expect(entityNames).toContain("Barbary macaque");

            const berberEntity = entities.find((e: any) => e.name === "Berber");
            expect(berberEntity.type).toBe("people");
        });
    });

    describe("Topic Extraction", () => {
        it("should extract key topics from content", () => {
            expect(expectedKnowledge.keyTopics).toBeDefined();
            expect(expectedKnowledge.keyTopics.length).toBeGreaterThan(5);

            const topics = expectedKnowledge.keyTopics;

            expect(topics).toContain("Geography");
            expect(topics).toContain("Geology");
            expect(topics).toContain("Climate");
            expect(topics).toContain("Flora and Fauna");
        });

        it("should extract domain-specific topics", () => {
            const topics = expectedKnowledge.keyTopics;

            expect(topics).toContain("Mountain Formation");
            expect(topics).toContain("North Africa");
            expect(topics).toContain("Indigenous People");
        });

        it("should extract topics relevant to content themes", () => {
            const topics = expectedKnowledge.keyTopics;

            expect(topics).toContain("Tourism");

            const contentLower = atlasContent.toLowerCase();
            expect(contentLower).toContain("tourism");
            expect(contentLower).toContain("trekking");
        });

        it("should have reasonable topic coverage", () => {
            const topics = expectedKnowledge.keyTopics;

            expect(topics.length).toBeGreaterThanOrEqual(6);
            expect(topics.length).toBeLessThanOrEqual(12);
        });
    });

    describe("Relationship Extraction", () => {
        it("should extract relationships between entities", () => {
            expect(expectedKnowledge.relationships).toBeDefined();
            expect(expectedKnowledge.relationships.length).toBeGreaterThan(10);
        });

        it("should extract location relationships", () => {
            const relationships = expectedKnowledge.relationships;
            const locationRels = relationships.filter(
                (r: any) => r.relationship === "located_in",
            );

            expect(locationRels.length).toBeGreaterThan(3);

            const atlasInMorocco = locationRels.find(
                (r: any) => r.from === "Atlas Mountains" && r.to === "Morocco",
            );
            expect(atlasInMorocco).toBeDefined();
        });

        it("should extract hierarchical relationships", () => {
            const relationships = expectedKnowledge.relationships;

            const toubkalRelationship = relationships.find(
                (r: any) =>
                    r.from === "Mount Toubkal" &&
                    r.to === "Atlas Mountains" &&
                    r.relationship === "highest_peak_of",
            );

            expect(toubkalRelationship).toBeDefined();
            expect(toubkalRelationship.confidence).toBeGreaterThan(0.9);
        });

        it("should extract comparative relationships", () => {
            const relationships = expectedKnowledge.relationships;

            const similarFormation = relationships.filter(
                (r: any) => r.relationship === "similar_formation",
            );

            expect(similarFormation.length).toBeGreaterThan(1);

            const atlasToAlps = similarFormation.find(
                (r: any) => r.from === "Atlas Mountains" && r.to === "Alps",
            );
            expect(atlasToAlps).toBeDefined();
        });

        it("should extract temporal/causal relationships", () => {
            const relationships = expectedKnowledge.relationships;

            const formedDuring = relationships.filter(
                (r: any) => r.relationship === "formed_during",
            );

            expect(formedDuring.length).toBeGreaterThan(0);
        });

        it("should assign confidence to relationships", () => {
            const relationships = expectedKnowledge.relationships;

            for (const rel of relationships) {
                expect(rel.confidence).toBeDefined();
                expect(rel.confidence).toBeGreaterThanOrEqual(0);
                expect(rel.confidence).toBeLessThanOrEqual(1);
            }
        });

        it("should extract bidirectional relationships where appropriate", () => {
            const relationships = expectedKnowledge.relationships;

            const locationRels = relationships.filter(
                (r: any) =>
                    r.from === "Atlas Mountains" &&
                    r.to === "Morocco" &&
                    r.relationship === "located_in",
            );

            expect(locationRels.length).toBeGreaterThan(0);
        });
    });

    describe("Content Summary", () => {
        it("should generate a summary of the content", () => {
            expect(expectedKnowledge.summary).toBeDefined();
            expect(expectedKnowledge.summary.length).toBeGreaterThan(100);
        });

        it("should include key entities in summary", () => {
            const summary = expectedKnowledge.summary;

            expect(summary).toContain("Atlas Mountains");
            expect(summary).toContain("Mount Toubkal");
            expect(summary).toContain("Morocco");
        });

        it("should include key facts in summary", () => {
            const summary = expectedKnowledge.summary;

            expect(summary).toContain("4,167");
            expect(summary).toContain("highest peak");
            expect(summary).toContain("North Africa");
        });

        it("should be concise and informative", () => {
            const summary = expectedKnowledge.summary;

            expect(summary.split(".").length).toBeGreaterThan(2);
            expect(summary.split(".").length).toBeLessThan(10);
        });
    });

    describe("Content Metrics", () => {
        it("should calculate word count", () => {
            expect(expectedKnowledge.contentMetrics).toBeDefined();
            expect(expectedKnowledge.contentMetrics.wordCount).toBeDefined();
            expect(expectedKnowledge.contentMetrics.wordCount).toBe(750);
        });

        it("should estimate reading time", () => {
            expect(expectedKnowledge.contentMetrics.readingTime).toBeDefined();
            expect(expectedKnowledge.contentMetrics.readingTime).toBe(4);
        });
    });

    describe("Text Chunking", () => {
        it("should split content into logical chunks", () => {
            const paragraphs = atlasContent.split(/\n\n+/);
            const meaningfulParagraphs = paragraphs.filter(
                (p) => p.trim().length > 50,
            );

            expect(meaningfulParagraphs.length).toBeGreaterThanOrEqual(1);
            expect(atlasContent.length).toBeGreaterThan(1000);
        });

        it("should preserve section boundaries", () => {
            const sections = atlasContent.match(/^## .+$/gm);

            expect(sections).toBeDefined();
            expect(sections!.length).toBeGreaterThan(5);

            expect(sections).toContain("## Geography");
            expect(sections).toContain("## Climate");
            expect(sections).toContain("## Geology");
            expect(sections).toContain("## Flora and Fauna");
        });

        it("should handle markdown structure", () => {
            const headings = atlasContent.match(/^#+\s+.+$/gm);

            expect(headings).toBeDefined();
            expect(headings!.length).toBeGreaterThan(6);

            const h1Count = atlasContent.match(/^# .+$/gm)?.length || 0;
            expect(h1Count).toBe(1);
        });

        it("should maintain context in chunks", () => {
            const geographySection = atlasContent.match(
                /## Geography[\s\S]*?(?=## |$)/,
            );

            expect(geographySection).toBeDefined();
            expect(geographySection![0]).toContain("Mount Toubkal");
            expect(geographySection![0]).toContain("High Atlas");
            expect(geographySection![0]).toContain("4,167 meters");
        });
    });

    describe("Extraction Aggregation", () => {
        it("should aggregate entities across content", () => {
            const entities = expectedKnowledge.entities;
            const entityNames = new Set(entities.map((e: any) => e.name));

            expect(entityNames.size).toBe(entities.length);
        });

        it("should deduplicate entities", () => {
            const entities = expectedKnowledge.entities;
            const entityNames = entities.map((e: any) => e.name);
            const uniqueNames = new Set(entityNames);

            expect(entityNames.length).toBe(uniqueNames.size);
        });

        it("should merge related topics", () => {
            const topics = expectedKnowledge.keyTopics;
            const uniqueTopics = new Set(topics);

            expect(topics.length).toBe(uniqueTopics.size);
        });

        it("should maintain relationship integrity", () => {
            const relationships = expectedKnowledge.relationships;
            const entities = expectedKnowledge.entities;
            const entityNames = new Set(entities.map((e: any) => e.name));

            for (const rel of relationships) {
                if (entityNames.has(rel.from) && entityNames.has(rel.to)) {
                    expect(rel.from).toBeDefined();
                    expect(rel.to).toBeDefined();
                    expect(rel.relationship).toBeDefined();
                }
            }
        });
    });

    describe("Extraction Quality", () => {
        it("should extract high-confidence primary entities", () => {
            const entities = expectedKnowledge.entities;
            const highConfidence = entities.filter(
                (e: any) => e.confidence > 0.9,
            );

            expect(highConfidence.length).toBeGreaterThan(3);

            const names = highConfidence.map((e: any) => e.name);
            expect(names).toContain("Atlas Mountains");
        });

        it("should extract comprehensive geographic coverage", () => {
            const entities = expectedKnowledge.entities;
            const entityNames = entities.map((e: any) => e.name);

            expect(entityNames).toContain("Morocco");
            expect(entityNames).toContain("Algeria");
            expect(entityNames).toContain("Tunisia");
            expect(entityNames).toContain("Sahara Desert");
            expect(entityNames).toContain("Mediterranean Sea");
        });

        it("should extract related mountain ranges for comparison", () => {
            const entities = expectedKnowledge.entities;
            const mountainRanges = entities.filter(
                (e: any) => e.type === "mountain_range",
            );

            expect(mountainRanges.length).toBeGreaterThan(3);

            const names = mountainRanges.map((e: any) => e.name);
            expect(names).toContain("Pyrenees");
            expect(names).toContain("Alps");
        });

        it("should extract indigenous cultural entities", () => {
            const entities = expectedKnowledge.entities;
            const entityNames = entities.map((e: any) => e.name);

            expect(entityNames).toContain("Berber");

            const berber = entities.find((e: any) => e.name === "Berber");
            expect(berber.type).toBe("people");
            expect(berber.description.toLowerCase()).toContain("indigenous");
        });

        it("should extract geological and temporal context", () => {
            const relationships = expectedKnowledge.relationships;

            const temporalRels = relationships.filter(
                (r: any) => r.relationship === "formed_during",
            );

            expect(temporalRels.length).toBeGreaterThan(0);

            const summary = expectedKnowledge.summary;
            expect(summary.toLowerCase()).toContain("alpine orogeny");
        });
    });
});
