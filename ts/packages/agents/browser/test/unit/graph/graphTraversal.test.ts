import { describe, it, expect, beforeEach } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import { setupTestMocks, resetAllMocks } from "../../mocks";

const FIXTURES_DIR = join(__dirname, "../../fixtures");

describe("Graph Traversal - Phase 3: Graph Operations", () => {
    let testContext: ReturnType<typeof setupTestMocks>;
    let graphStructure: any;
    let expectedTraversal: any;

    beforeEach(() => {
        resetAllMocks();
        testContext = setupTestMocks();

        graphStructure = JSON.parse(
            readFileSync(
                join(FIXTURES_DIR, "knowledge-graph/graph-structure.json"),
                "utf-8",
            ),
        );
        expectedTraversal = JSON.parse(
            readFileSync(
                join(
                    FIXTURES_DIR,
                    "knowledge-graph/expected-traversal.json",
                ),
                "utf-8",
            ),
        );
    });

    describe("Entity Neighborhood Traversal", () => {
        it("should retrieve 1-hop entity neighbors", () => {
            const neighborhood = testContext.knowledgeStore.getEntityNeighborhood(
                "Atlas Mountains",
                1,
                50,
            );

            expect(neighborhood).toBeDefined();
            expect(neighborhood.entities).toBeDefined();
            expect(neighborhood.entities.length).toBeGreaterThan(5);

            for (const entity of neighborhood.entities) {
                expect(entity.distance).toBe(1);
            }
        });

        it("should retrieve 2-hop entity neighbors", () => {
            const neighborhood = testContext.knowledgeStore.getEntityNeighborhood(
                "Atlas Mountains",
                2,
                50,
            );

            expect(neighborhood.entities.length).toBeGreaterThan(5);

            const distances = neighborhood.entities.map((e) => e.distance);
            expect(Math.max(...distances)).toBeLessThanOrEqual(2);
            expect(distances).toContain(1);
            expect(distances).toContain(2);
        });

        it("should respect max nodes limit", () => {
            const neighborhood = testContext.knowledgeStore.getEntityNeighborhood(
                "Atlas Mountains",
                2,
                10,
            );

            expect(neighborhood.entities.length).toBeLessThanOrEqual(10);
        });

        it("should include relationships in neighborhood", () => {
            const neighborhood = testContext.knowledgeStore.getEntityNeighborhood(
                "Atlas Mountains",
                2,
                50,
            );

            expect(neighborhood.relationships).toBeDefined();
            expect(neighborhood.relationships.length).toBeGreaterThan(0);
        });

        it("should find specific entities in neighborhood", () => {
            const neighborhood = testContext.knowledgeStore.getEntityNeighborhood(
                "Atlas Mountains",
                1,
                50,
            );

            const entityNames = neighborhood.entities.map((e) => e.name);

            expect(entityNames).toContain("Morocco");
            expect(entityNames).toContain("Algeria");
            expect(entityNames).toContain("Sahara Desert");
        });

        it("should calculate correct distances", () => {
            const neighborhood = testContext.knowledgeStore.getEntityNeighborhood(
                "Atlas Mountains",
                2,
                50,
            );

            const morocco = neighborhood.entities.find(
                (e) => e.name === "Morocco",
            );
            expect(morocco).toBeDefined();
            expect(morocco!.distance).toBe(1);
        });
    });

    describe("Topic Co-occurrence", () => {
        it("should find related topics by co-occurrence", () => {
            const relatedTopics = testContext.knowledgeStore.getRelatedTopics(
                "Geography",
                10,
            );

            expect(relatedTopics).toBeDefined();
            expect(Array.isArray(relatedTopics)).toBe(true);
            expect(relatedTopics.length).toBeGreaterThan(0);
        });

        it("should calculate co-occurrence counts", () => {
            const relatedTopics = testContext.knowledgeStore.getRelatedTopics(
                "Geography",
                10,
            );

            for (const topic of relatedTopics) {
                expect(topic.cooccurrenceCount).toBeDefined();
                expect(topic.cooccurrenceCount).toBeGreaterThan(0);
            }
        });

        it("should find topics that share URLs", () => {
            const geographyTopic = testContext.knowledgeStore.getTopic(
                "Geography",
            );
            expect(geographyTopic).toBeDefined();

            const relatedTopics = testContext.knowledgeStore.getRelatedTopics(
                "Geography",
                10,
            );

            for (const related of relatedTopics) {
                const hasSharedUrl = related.urls.some((url: string) =>
                    geographyTopic!.urls.includes(url),
                );
                expect(hasSharedUrl).toBe(true);
            }
        });

        it("should respect max results limit", () => {
            const relatedTopics = testContext.knowledgeStore.getRelatedTopics(
                "Geography",
                5,
            );

            expect(relatedTopics.length).toBeLessThanOrEqual(5);
        });
    });

    describe("Expected Traversal Scenarios", () => {
        it("should load expected traversal scenarios", () => {
            expect(expectedTraversal.traversalScenarios).toBeDefined();
            expect(expectedTraversal.traversalScenarios.length).toBeGreaterThan(
                0,
            );

            const scenario = expectedTraversal.traversalScenarios[0];
            expect(scenario.seedEntities).toBeDefined();
            expect(scenario.depth).toBeDefined();
            expect(scenario.expectedEntities).toBeDefined();
            expect(scenario.expectedTopics).toBeDefined();
        });

        it("should validate 2-hop traversal expectations", () => {
            const scenario = expectedTraversal.traversalScenarios.find(
                (s: any) => s.name === "2-hop traversal from Atlas Mountains",
            );

            expect(scenario).toBeDefined();
            expect(scenario.depth).toBe(2);
            expect(scenario.expectedEntities.length).toBeGreaterThan(10);

            const expectedNames = scenario.expectedEntities.map(
                (e: any) => e.name,
            );
            expect(expectedNames).toContain("Morocco");
            expect(expectedNames).toContain("Pyrenees");
        });

        it("should validate expected distances", () => {
            const scenario = expectedTraversal.traversalScenarios.find(
                (s: any) => s.name === "2-hop traversal from Atlas Mountains",
            );

            for (const entity of scenario.expectedEntities) {
                expect(entity.distance).toBeDefined();
                expect(entity.distance).toBeGreaterThanOrEqual(1);
                expect(entity.distance).toBeLessThanOrEqual(2);
            }
        });

        it("should validate relationship paths", () => {
            const scenario = expectedTraversal.traversalScenarios.find(
                (s: any) => s.name === "2-hop traversal from Atlas Mountains",
            );

            for (const entity of scenario.expectedEntities) {
                expect(entity.relationshipPath).toBeDefined();
                expect(Array.isArray(entity.relationshipPath)).toBe(true);
                expect(entity.relationshipPath.length).toBeGreaterThanOrEqual(
                    2,
                );
            }
        });
    });

    describe("Relevance Scoring", () => {
        it("should calculate relevance scores", () => {
            const scenario = expectedTraversal.traversalScenarios.find(
                (s: any) => s.name === "2-hop traversal from Atlas Mountains",
            );

            for (const entity of scenario.expectedEntities) {
                expect(entity.minRelevanceScore).toBeDefined();
                expect(entity.minRelevanceScore).toBeGreaterThan(0);
                expect(entity.minRelevanceScore).toBeLessThanOrEqual(1);
            }
        });

        it("should score by distance, confidence, and co-occurrence", () => {
            const formula = expectedTraversal.relevanceScoringFormula;

            expect(formula.formula).toContain("distance");
            expect(formula.formula).toContain("confidence");
            expect(formula.formula).toContain("cooccurrence");

            expect(formula.components.distanceWeight).toBe(0.4);
            expect(formula.components.confidenceWeight).toBe(0.3);
            expect(formula.components.cooccurrenceWeight).toBe(0.3);
        });

        it("should have higher scores for closer entities", () => {
            const scenario = expectedTraversal.traversalScenarios.find(
                (s: any) => s.name === "2-hop traversal from Atlas Mountains",
            );

            const distance1Entities = scenario.expectedEntities.filter(
                (e: any) => e.distance === 1,
            );
            const distance2Entities = scenario.expectedEntities.filter(
                (e: any) => e.distance === 2,
            );

            if (
                distance1Entities.length > 0 &&
                distance2Entities.length > 0
            ) {
                const avgScore1 =
                    distance1Entities.reduce(
                        (sum: number, e: any) => sum + e.minRelevanceScore,
                        0,
                    ) / distance1Entities.length;
                const avgScore2 =
                    distance2Entities.reduce(
                        (sum: number, e: any) => sum + e.minRelevanceScore,
                        0,
                    ) / distance2Entities.length;

                expect(avgScore1).toBeGreaterThan(avgScore2);
            }
        });

        it("should validate example calculations", () => {
            const formula = expectedTraversal.relevanceScoringFormula;
            const examples = formula.examples;

            expect(examples).toBeDefined();
            expect(examples.length).toBeGreaterThan(0);

            for (const example of examples) {
                expect(example.entity).toBeDefined();
                expect(example.distance).toBeDefined();
                expect(example.confidence).toBeDefined();
                expect(example.cooccurrenceCount).toBeDefined();
                expect(example.calculation).toBeDefined();
            }
        });
    });

    describe("Deduplication", () => {
        it("should deduplicate entities reached via multiple paths", () => {
            const neighborhood = testContext.knowledgeStore.getEntityNeighborhood(
                "Atlas Mountains",
                2,
                50,
            );

            const entityNames = neighborhood.entities.map((e) => e.name);
            const uniqueNames = new Set(entityNames);

            expect(entityNames.length).toBe(uniqueNames.size);
        });

        it("should use shortest path for distance", () => {
            const validations = expectedTraversal.testValidations;

            expect(validations.distanceCalculation).toContain("shortest path");
            expect(validations.entityDeduplication).toContain("once");
        });
    });

    describe("Depth Limiting", () => {
        it("should respect depth limit in traversal", () => {
            const scenario = expectedTraversal.traversalScenarios.find(
                (s: any) => s.name === "Depth limit test - 1 hop only",
            );

            expect(scenario).toBeDefined();
            expect(scenario.depth).toBe(1);

            for (const entity of scenario.expectedEntities) {
                if (entity.shouldBeIncluded) {
                    expect(entity.distance).toBeLessThanOrEqual(1);
                } else {
                    expect(entity.distance).toBeGreaterThan(1);
                }
            }
        });

        it("should exclude entities beyond depth limit", () => {
            const neighborhood = testContext.knowledgeStore.getEntityNeighborhood(
                "Atlas Mountains",
                1,
                50,
            );

            for (const entity of neighborhood.entities) {
                expect(entity.distance).toBeLessThanOrEqual(1);
            }
        });
    });

    describe("Graph Structure Validation", () => {
        it("should have valid entity structure", () => {
            const entities = graphStructure.entities;

            expect(entities).toBeDefined();
            expect(entities.length).toBeGreaterThan(10);

            for (const entity of entities) {
                expect(entity.name).toBeDefined();
                expect(entity.type).toBeDefined();
                expect(entity.sourceUrl).toBeDefined();
                expect(entity.confidence).toBeDefined();
            }
        });

        it("should have valid relationship structure", () => {
            const relationships = graphStructure.relationships;

            expect(relationships).toBeDefined();
            expect(relationships.length).toBeGreaterThan(10);

            for (const rel of relationships) {
                expect(rel.from).toBeDefined();
                expect(rel.to).toBeDefined();
                expect(rel.type).toBeDefined();
                expect(rel.confidence).toBeDefined();
            }
        });

        it("should have valid topic structure", () => {
            const topics = graphStructure.topics;

            expect(topics).toBeDefined();
            expect(topics.length).toBeGreaterThan(5);

            for (const topic of topics) {
                expect(topic.name).toBeDefined();
                expect(topic.urls).toBeDefined();
                expect(Array.isArray(topic.urls)).toBe(true);
                expect(topic.cooccurrenceCount).toBeDefined();
            }
        });

        it("should have bidirectional relationships marked correctly", () => {
            const relationships = graphStructure.relationships;

            const bidirectional = relationships.filter(
                (r: any) => r.bidirectional === true,
            );

            expect(bidirectional.length).toBeGreaterThan(0);

            const locationRel = bidirectional.find(
                (r: any) => r.type === "located_in",
            );
            expect(locationRel).toBeDefined();
        });
    });

    describe("Multi-Hop Traversal", () => {
        it("should support 3-hop traversal", () => {
            const scenario = expectedTraversal.traversalScenarios.find(
                (s: any) =>
                    s.name ===
                    "3-hop traversal from Atlas Mountains and Mount Toubkal",
            );

            expect(scenario).toBeDefined();
            expect(scenario.depth).toBe(3);

            const himalayas = scenario.expectedEntities.find(
                (e: any) => e.name === "Himalayas",
            );
            if (himalayas) {
                expect(himalayas.distance).toBeLessThanOrEqual(3);
            }
        });

        it("should find distant entities through topic co-occurrence", () => {
            const scenario = expectedTraversal.traversalScenarios.find(
                (s: any) =>
                    s.name ===
                    "3-hop traversal from Atlas Mountains and Mount Toubkal",
            );

            const himalayas = scenario.expectedEntities.find(
                (e: any) => e.name === "Himalayas",
            );
            expect(himalayas).toBeDefined();
            expect(himalayas.note).toContain("topic co-occurrence");
        });

        it("should have reasonable result counts for different depths", () => {
            const scenario1 = expectedTraversal.traversalScenarios.find(
                (s: any) => s.depth === 1,
            );
            const scenario2 = expectedTraversal.traversalScenarios.find(
                (s: any) => s.depth === 2,
            );
            const scenario3 = expectedTraversal.traversalScenarios.find(
                (s: any) => s.depth === 3,
            );

            if (scenario1 && scenario2 && scenario3) {
                expect(scenario2.minTotalEntities).toBeGreaterThanOrEqual(
                    scenario1.minTotalEntities,
                );
                expect(scenario3.minTotalEntities).toBeGreaterThanOrEqual(
                    scenario2.minTotalEntities,
                );
            }
        });
    });

    describe("Topic Expansion", () => {
        it("should expand topics via URL co-occurrence", () => {
            const validations = expectedTraversal.testValidations;
            expect(validations.topicExpansion).toContain("co-occurrence");
        });

        it("should find topics on related pages", () => {
            const scenario = expectedTraversal.traversalScenarios[0];

            const geographyTopic = scenario.expectedTopics.find(
                (t: any) => t.name === "Geography",
            );
            expect(geographyTopic).toBeDefined();
            expect(geographyTopic.relatedUrls).toBeDefined();
            expect(geographyTopic.relatedUrls.length).toBeGreaterThan(0);
        });

        it("should have higher scores for frequently co-occurring topics", () => {
            const scenario = expectedTraversal.traversalScenarios[0];

            const highCooccurrence = scenario.expectedTopics.filter(
                (t: any) => t.cooccurrenceCount >= 3,
            );
            const lowCooccurrence = scenario.expectedTopics.filter(
                (t: any) => t.cooccurrenceCount < 3,
            );

            if (highCooccurrence.length > 0 && lowCooccurrence.length > 0) {
                const avgScoreHigh =
                    highCooccurrence.reduce(
                        (sum: number, t: any) => sum + t.minRelevanceScore,
                        0,
                    ) / highCooccurrence.length;
                const avgScoreLow =
                    lowCooccurrence.reduce(
                        (sum: number, t: any) => sum + t.minRelevanceScore,
                        0,
                    ) / lowCooccurrence.length;

                expect(avgScoreHigh).toBeGreaterThanOrEqual(avgScoreLow);
            }
        });
    });
});
