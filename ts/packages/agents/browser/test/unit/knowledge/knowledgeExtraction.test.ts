import { describe, it, expect, beforeEach } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import { setupTestMocks, resetAllMocks } from "../../mocks";

const FIXTURES_DIR = join(__dirname, "../../fixtures");

describe("Knowledge Extraction - Phase 1 Setup Verification", () => {
    let testContext: ReturnType<typeof setupTestMocks>;

    beforeEach(() => {
        resetAllMocks();
        testContext = setupTestMocks();
    });

    describe("Test Fixtures", () => {
        it("should load Atlas Mountains content fixture", () => {
            const content = readFileSync(
                join(FIXTURES_DIR, "atlas-mountains/content.md"),
                "utf-8",
            );

            expect(content).toBeDefined();
            expect(content).toContain("Atlas Mountains");
            expect(content).toContain("Mount Toubkal");
            expect(content.length).toBeGreaterThan(500);
        });

        it("should load Atlas Mountains metadata fixture", () => {
            const metadataRaw = readFileSync(
                join(FIXTURES_DIR, "atlas-mountains/metadata.json"),
                "utf-8",
            );
            const metadata = JSON.parse(metadataRaw);

            expect(metadata.url).toBe(
                "https://en.wikipedia.org/wiki/Atlas_Mountains",
            );
            expect(metadata.title).toBe("Atlas Mountains - Wikipedia");
            expect(metadata.wordCount).toBe(750);
            expect(metadata.readingTimeMinutes).toBe(4);
        });

        it("should load expected knowledge fixture", () => {
            const knowledgeRaw = readFileSync(
                join(FIXTURES_DIR, "atlas-mountains/expected-knowledge.json"),
                "utf-8",
            );
            const knowledge = JSON.parse(knowledgeRaw);

            expect(knowledge.entities).toBeDefined();
            expect(knowledge.entities.length).toBeGreaterThan(10);
            expect(knowledge.keyTopics).toBeDefined();
            expect(knowledge.relationships).toBeDefined();
            expect(knowledge.summary).toBeDefined();

            const atlasEntity = knowledge.entities.find(
                (e: any) => e.name === "Atlas Mountains",
            );
            expect(atlasEntity).toBeDefined();
            expect(atlasEntity.type).toBe("mountain_range");
            expect(atlasEntity.confidence).toBeGreaterThan(0.9);
        });

        it("should load expected Q&A fixture", () => {
            const qaRaw = readFileSync(
                join(FIXTURES_DIR, "atlas-mountains/expected-qa.json"),
                "utf-8",
            );
            const qa = JSON.parse(qaRaw);

            expect(qa.pageQuestions).toBeDefined();
            expect(qa.graphQuestions).toBeDefined();
            expect(qa.pageQuestions.length).toBeGreaterThan(0);
            expect(qa.graphQuestions.length).toBeGreaterThan(0);

            const pageQuestion = qa.pageQuestions[0];
            expect(pageQuestion.question).toBeDefined();
            expect(pageQuestion.scope).toBe("page");
            expect(pageQuestion.expectedAnswer).toBeDefined();

            const graphQuestion = qa.graphQuestions[0];
            expect(graphQuestion.scope).toMatch(/broader|related/);
            expect(graphQuestion.requiresTraversal).toBe(true);
        });
    });

    describe("Knowledge Graph Fixtures", () => {
        it("should load graph structure fixture", () => {
            const graphRaw = readFileSync(
                join(FIXTURES_DIR, "knowledge-graph/graph-structure.json"),
                "utf-8",
            );
            const graph = JSON.parse(graphRaw);

            expect(graph.entities).toBeDefined();
            expect(graph.relationships).toBeDefined();
            expect(graph.topics).toBeDefined();

            expect(graph.entities.length).toBeGreaterThan(10);
            expect(graph.relationships.length).toBeGreaterThan(10);

            const atlasEntity = graph.entities.find(
                (e: any) => e.name === "Atlas Mountains",
            );
            expect(atlasEntity).toBeDefined();
            expect(atlasEntity.outboundRelationships).toBeDefined();
        });

        it("should load related pages fixture", () => {
            const pagesRaw = readFileSync(
                join(FIXTURES_DIR, "knowledge-graph/related-pages.json"),
                "utf-8",
            );
            const pages = JSON.parse(pagesRaw);

            expect(pages.pages).toBeDefined();
            expect(pages.pages.length).toBeGreaterThan(5);

            const moroccoPage = pages.pages.find(
                (p: any) => p.url === "https://en.wikipedia.org/wiki/Morocco",
            );
            expect(moroccoPage).toBeDefined();
            expect(moroccoPage.entities).toBeDefined();
            expect(moroccoPage.topics).toBeDefined();
        });

        it("should load expected traversal fixture", () => {
            const traversalRaw = readFileSync(
                join(FIXTURES_DIR, "knowledge-graph/expected-traversal.json"),
                "utf-8",
            );
            const traversal = JSON.parse(traversalRaw);

            expect(traversal.traversalScenarios).toBeDefined();
            expect(traversal.traversalScenarios.length).toBeGreaterThan(0);

            const scenario = traversal.traversalScenarios[0];
            expect(scenario.seedEntities).toBeDefined();
            expect(scenario.depth).toBeDefined();
            expect(scenario.expectedEntities).toBeDefined();
            expect(scenario.expectedTopics).toBeDefined();
        });
    });

    describe("Mock Infrastructure", () => {
        it("should provide mock LLM responses", () => {
            const response =
                testContext.llm.getEntityExtractionResponse("Atlas Mountains");

            expect(response).toBeDefined();
            expect(response.entities).toBeDefined();
            expect(response.topics).toBeDefined();
            expect(response.success).toBe(true);
        });

        it("should provide mock embeddings", () => {
            const embedding =
                testContext.embeddings.generateDeterministicEmbedding(
                    "Atlas Mountains",
                );

            expect(embedding).toBeDefined();
            expect(Array.isArray(embedding)).toBe(true);
            expect(embedding.length).toBe(384);

            const sum = embedding.reduce((a, b) => a + b * b, 0);
            expect(Math.abs(Math.sqrt(sum) - 1)).toBeLessThan(0.01);
        });

        it("should provide deterministic embeddings for same text", () => {
            const text = "Atlas Mountains";
            const embedding1 =
                testContext.embeddings.generateDeterministicEmbedding(text);
            const embedding2 =
                testContext.embeddings.generateDeterministicEmbedding(text);

            expect(embedding1).toEqual(embedding2);
        });

        it("should calculate cosine similarity", () => {
            const vec1 =
                testContext.embeddings.generateDeterministicEmbedding(
                    "Atlas Mountains",
                );
            const vec2 =
                testContext.embeddings.generateDeterministicEmbedding(
                    "Atlas Mountains",
                );
            const vec3 = testContext.embeddings.generateDeterministicEmbedding(
                "Completely different text",
            );

            const similarity1 = testContext.embeddings.cosineSimilarity(
                vec1,
                vec2,
            );
            const similarity2 = testContext.embeddings.cosineSimilarity(
                vec1,
                vec3,
            );

            expect(similarity1).toBeCloseTo(1, 5);
            expect(similarity2).toBeLessThan(1);
            expect(similarity2).toBeGreaterThan(-1);
        });

        it("should provide mock knowledge store", () => {
            expect(testContext.knowledgeStore).toBeDefined();

            const entities = testContext.knowledgeStore.getAllEntities();
            expect(entities.length).toBeGreaterThan(0);

            const atlasEntity =
                testContext.knowledgeStore.getEntity("Atlas Mountains");
            expect(atlasEntity).toBeDefined();
            expect(atlasEntity?.type).toBe("mountain_range");
        });

        it("should support entity neighborhood queries", () => {
            const neighborhood =
                testContext.knowledgeStore.getEntityNeighborhood(
                    "Atlas Mountains",
                    2,
                    20,
                );

            expect(neighborhood).toBeDefined();
            expect(neighborhood.entities).toBeDefined();
            expect(neighborhood.relationships).toBeDefined();
            expect(neighborhood.entities.length).toBeGreaterThan(0);

            const distances = neighborhood.entities.map((e) => e.distance);
            expect(Math.max(...distances)).toBeLessThanOrEqual(2);
        });

        it("should support topic co-occurrence queries", () => {
            const relatedTopics = testContext.knowledgeStore.getRelatedTopics(
                "Geography",
                5,
            );

            expect(relatedTopics).toBeDefined();
            expect(Array.isArray(relatedTopics)).toBe(true);
            expect(relatedTopics.length).toBeGreaterThan(0);
        });
    });

    describe("Mock Integration", () => {
        it("should create mock website collection", () => {
            const collection = testContext.websiteCollection;

            expect(collection).toBeDefined();
            expect(collection.entities).toBeDefined();
            expect(collection.relationships).toBeDefined();
            expect(collection.topics).toBeDefined();

            const allEntities = collection.entities.getAll();
            expect(allEntities.length).toBeGreaterThan(0);
        });

        it("should support semantic search with mock embeddings", () => {
            const documents = [
                { text: "The Atlas Mountains are in North Africa" },
                { text: "Mount Toubkal is the highest peak" },
                { text: "The Pyrenees separate France and Spain" },
                { text: "Completely unrelated content about computers" },
            ];

            const results = testContext.embeddings.semanticSearch(
                "highest peak Atlas Mountains",
                documents,
                2,
            );

            expect(results.length).toBe(2);
            expect(results[0].score).toBeGreaterThan(results[1].score);

            const topResult = results[0];
            expect(topResult.text).toContain("Toubkal");
        });
    });
});
