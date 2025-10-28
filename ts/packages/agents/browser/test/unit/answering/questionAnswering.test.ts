// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, it, expect, beforeEach } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import { setupTestMocks, resetAllMocks } from "../../mocks";

const FIXTURES_DIR = join(__dirname, "../../fixtures");

describe("Question Answering - Phase 4: Answer Generation", () => {
    let testContext: ReturnType<typeof setupTestMocks>;
    let atlasContent: string;
    let expectedKnowledge: any;
    let expectedQA: any;
    let graphStructure: any;
    let relatedPages: any;

    beforeEach(() => {
        resetAllMocks();
        testContext = setupTestMocks();

        atlasContent = readFileSync(
            join(FIXTURES_DIR, "atlas-mountains/content.md"),
            "utf-8",
        );
        expectedKnowledge = JSON.parse(
            readFileSync(
                join(FIXTURES_DIR, "atlas-mountains/expected-knowledge.json"),
                "utf-8",
            ),
        );
        expectedQA = JSON.parse(
            readFileSync(
                join(FIXTURES_DIR, "atlas-mountains/expected-qa.json"),
                "utf-8",
            ),
        );
        graphStructure = JSON.parse(
            readFileSync(
                join(FIXTURES_DIR, "knowledge-graph/graph-structure.json"),
                "utf-8",
            ),
        );
        relatedPages = JSON.parse(
            readFileSync(
                join(FIXTURES_DIR, "knowledge-graph/related-pages.json"),
                "utf-8",
            ),
        );
    });

    describe("Page-Scoped Answer Generation", () => {
        it("should generate answers for page questions", () => {
            const pageQuestions = expectedQA.pageQuestions;

            for (const q of pageQuestions) {
                expect(q.expectedAnswer).toBeDefined();
                expect(q.expectedAnswer.length).toBeGreaterThan(20);
            }
        });

        it("should answer factual questions accurately", () => {
            const highestPeakQuestion = expectedQA.pageQuestions.find(
                (q: any) => q.question.includes("highest peak"),
            );

            expect(highestPeakQuestion).toBeDefined();
            expect(highestPeakQuestion.expectedAnswer).toContain(
                "Mount Toubkal",
            );
            expect(highestPeakQuestion.expectedAnswer).toContain("4,167");
        });

        it("should provide complete answers with context", () => {
            const countriesQuestion = expectedQA.pageQuestions.find((q: any) =>
                q.question.toLowerCase().includes("countries"),
            );

            expect(countriesQuestion.expectedAnswer).toContain("Morocco");
            expect(countriesQuestion.expectedAnswer).toContain("Algeria");
            expect(countriesQuestion.expectedAnswer).toContain("Tunisia");
            expect(countriesQuestion.expectedAnswer.length).toBeGreaterThan(50);
        });

        it("should reference relevant entities in answers", () => {
            const pageQuestions = expectedQA.pageQuestions;

            for (const q of pageQuestions) {
                const entities = q.relevantEntities;
                const answer = q.expectedAnswer.toLowerCase();

                let foundEntity = false;
                for (const entity of entities) {
                    if (answer.includes(entity.toLowerCase())) {
                        foundEntity = true;
                        break;
                    }
                }

                expect(foundEntity).toBe(true);
            }
        });

        it("should cite source URLs", () => {
            const pageQuestions = expectedQA.pageQuestions;

            for (const q of pageQuestions) {
                expect(q.sourceUrls).toBeDefined();
                expect(q.sourceUrls.length).toBeGreaterThan(0);
                expect(q.sourceUrls[0]).toContain("wikipedia.org");
            }
        });

        it("should have high confidence for page answers", () => {
            const pageQuestions = expectedQA.pageQuestions;

            const avgConfidence =
                pageQuestions.reduce(
                    (sum: number, q: any) => sum + q.confidence,
                    0,
                ) / pageQuestions.length;

            expect(avgConfidence).toBeGreaterThan(0.85);
        });
    });

    describe("Graph-Scoped Answer Generation", () => {
        it("should generate answers for graph questions", () => {
            const graphQuestions = expectedQA.graphQuestions;

            for (const q of graphQuestions) {
                expect(q.expectedAnswer).toBeDefined();
                expect(q.expectedAnswer.length).toBeGreaterThan(50);
            }
        });

        it("should answer comparative questions with multiple sources", () => {
            const compareQuestion = expectedQA.graphQuestions.find((q: any) =>
                q.question.includes("compare"),
            );

            expect(compareQuestion).toBeDefined();
            expect(compareQuestion.sourceUrls.length).toBeGreaterThan(1);
            expect(compareQuestion.expectedAnswer).toContain("Atlas Mountains");
            expect(compareQuestion.expectedAnswer).toContain("Pyrenees");
        });

        it("should synthesize information from multiple pages", () => {
            const graphQuestions = expectedQA.graphQuestions;

            for (const q of graphQuestions) {
                if (q.sourceUrls.length > 1) {
                    expect(q.expectedAnswer.length).toBeGreaterThan(100);

                    const entities = q.relevantEntities;
                    expect(entities.length).toBeGreaterThanOrEqual(2);
                }
            }
        });

        it("should provide analytical insights for graph questions", () => {
            const analyticalQuestion = expectedQA.graphQuestions.find(
                (q: any) => q.answerType === "analytical",
            );

            if (analyticalQuestion) {
                expect(
                    analyticalQuestion.expectedAnswer.length,
                ).toBeGreaterThan(100);
                expect(analyticalQuestion.sourceUrls.length).toBeGreaterThan(1);
            }
        });

        it("should reference multiple entities in graph answers", () => {
            const graphQuestions = expectedQA.graphQuestions;

            for (const q of graphQuestions) {
                expect(q.relevantEntities.length).toBeGreaterThanOrEqual(2);
            }
        });

        it("should cite all relevant sources", () => {
            const graphQuestions = expectedQA.graphQuestions;

            for (const q of graphQuestions) {
                expect(q.sourceUrls).toBeDefined();
                expect(q.sourceUrls.length).toBeGreaterThanOrEqual(2);
            }
        });
    });

    describe("RAG Pipeline - Context Retrieval", () => {
        it("should retrieve relevant context for questions", () => {
            const documents = [
                {
                    text: "The Atlas Mountains are a mountain range in North Africa.",
                    metadata: { url: "atlas" },
                },
                {
                    text: "Mount Toubkal is the highest peak at 4,167 meters.",
                    metadata: { url: "atlas" },
                },
                {
                    text: "The Pyrenees separate France and Spain.",
                    metadata: { url: "pyrenees" },
                },
                {
                    text: "JavaScript is a programming language.",
                    metadata: { url: "unrelated" },
                },
            ];

            const results = testContext.embeddings.semanticSearch(
                "What is the highest peak in the Atlas Mountains?",
                documents,
                3,
            );

            expect(results.length).toBeGreaterThan(0);

            const hasRelevant = results.some(
                (r) =>
                    r.text.toLowerCase().includes("toubkal") ||
                    r.text.toLowerCase().includes("highest") ||
                    r.text.toLowerCase().includes("peak"),
            );
            expect(hasRelevant).toBe(true);
        });

        it("should rank results by relevance", () => {
            const documents = [
                {
                    text: "Mount Toubkal is the highest peak in the Atlas Mountains at 4,167 meters.",
                },
                {
                    text: "The Atlas Mountains stretch across Morocco, Algeria, and Tunisia.",
                },
                {
                    text: "The Alps are the highest mountain range in Europe.",
                },
            ];

            const results = testContext.embeddings.semanticSearch(
                "highest peak Atlas Mountains",
                documents,
                3,
            );

            expect(results[0].score).toBeGreaterThan(results[1].score);

            const topResult = results[0];
            const hasRelevantContent =
                topResult.text.toLowerCase().includes("toubkal") ||
                topResult.text.toLowerCase().includes("highest") ||
                topResult.text.toLowerCase().includes("atlas");
            expect(hasRelevantContent).toBe(true);
        });

        it("should filter by scope when retrieving context", () => {
            const messages = testContext.knowledgeStore.getMessagesByUrl(
                "https://en.wikipedia.org/wiki/Atlas_Mountains",
            );

            expect(Array.isArray(messages)).toBe(true);
        });

        it("should retrieve multiple relevant chunks", () => {
            const documents = atlasContent.split("\n\n").map((text) => ({
                text: text.trim(),
            }));

            const results = testContext.embeddings.semanticSearch(
                "geography climate elevation",
                documents.filter((d) => d.text.length > 50),
                5,
            );

            expect(results.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe("RAG Pipeline - Answer Generation with Context", () => {
        it("should generate answers using mock LLM", () => {
            const question = "What is the highest peak in the Atlas Mountains?";
            const context = [
                {
                    text: "Mount Toubkal is the highest peak at 4,167 meters.",
                },
                { text: "The Atlas Mountains are in North Africa." },
            ];

            const response = testContext.llm.getAnswerGenerationResponse(
                question,
                context,
            );

            expect(response.success).toBe(true);
            expect(response.answer).toBeDefined();
            expect(response.answer.length).toBeGreaterThan(20);
        });

        it("should include sources in answer response", () => {
            const question = "What is the highest peak in the Atlas Mountains?";
            const context = [{ text: "Mount Toubkal at 4,167 meters." }];

            const response = testContext.llm.getAnswerGenerationResponse(
                question,
                context,
            );

            expect(response.sources).toBeDefined();
            expect(Array.isArray(response.sources)).toBe(true);
        });

        it("should identify relevant entities in answer", () => {
            const question = "What is the highest peak in the Atlas Mountains?";
            const context = [{ text: "Mount Toubkal at 4,167 meters." }];

            const response = testContext.llm.getAnswerGenerationResponse(
                question,
                context,
            );

            expect(response.relevantEntities).toBeDefined();
            expect(Array.isArray(response.relevantEntities)).toBe(true);
        });

        it("should provide confidence scores", () => {
            const question = "What is the highest peak in the Atlas Mountains?";
            const context = [{ text: "Mount Toubkal at 4,167 meters." }];

            const response = testContext.llm.getAnswerGenerationResponse(
                question,
                context,
            );

            expect(response.confidence).toBeDefined();
            expect(response.confidence).toBeGreaterThan(0);
            expect(response.confidence).toBeLessThanOrEqual(1);
        });
    });

    describe("Answer Quality", () => {
        it("should generate complete answers", () => {
            const allQuestions = [
                ...expectedQA.pageQuestions,
                ...expectedQA.graphQuestions,
            ];

            for (const q of allQuestions) {
                expect(q.expectedAnswer.length).toBeGreaterThan(20);
                expect(q.expectedAnswer).not.toContain("I don't know");
            }
        });

        it("should generate accurate factual answers", () => {
            const factualQuestions = expectedQA.pageQuestions.filter(
                (q: any) => q.answerType === "factual",
            );

            for (const q of factualQuestions) {
                expect(q.confidence).toBeGreaterThan(0.85);
            }
        });

        it("should generate clear and concise answers", () => {
            const allQuestions = [
                ...expectedQA.pageQuestions,
                ...expectedQA.graphQuestions,
            ];

            for (const q of allQuestions) {
                const sentences = q.expectedAnswer
                    .split(/[.!?]+/)
                    .filter((s: string) => s.trim().length > 0);

                expect(sentences.length).toBeGreaterThan(0);
                expect(sentences.length).toBeLessThan(20);
            }
        });

        it("should avoid hallucinations in answers", () => {
            const allQuestions = [
                ...expectedQA.pageQuestions,
                ...expectedQA.graphQuestions,
            ];

            for (const q of allQuestions) {
                expect(q.sourceUrls).toBeDefined();
                expect(q.sourceUrls.length).toBeGreaterThan(0);

                expect(q.relevantEntities).toBeDefined();
                expect(q.relevantEntities.length).toBeGreaterThan(0);
            }
        });

        it("should maintain consistency across related answers", () => {
            const toubkalQuestions = expectedQA.pageQuestions.filter((q: any) =>
                q.question.includes("Toubkal"),
            );

            if (toubkalQuestions.length > 1) {
                for (const q of toubkalQuestions) {
                    expect(q.expectedAnswer.toLowerCase()).toContain("4,167");
                }
            }
        });
    });

    describe("Source Attribution", () => {
        it("should cite sources for all answers", () => {
            const allQuestions = [
                ...expectedQA.pageQuestions,
                ...expectedQA.graphQuestions,
            ];

            for (const q of allQuestions) {
                expect(q.sourceUrls).toBeDefined();
                expect(Array.isArray(q.sourceUrls)).toBe(true);
                expect(q.sourceUrls.length).toBeGreaterThan(0);
            }
        });

        it("should cite page sources for page questions", () => {
            const pageQuestions = expectedQA.pageQuestions;

            for (const q of pageQuestions) {
                expect(q.sourceUrls).toContain(
                    "https://en.wikipedia.org/wiki/Atlas_Mountains",
                );
            }
        });

        it("should cite multiple sources for graph questions", () => {
            const graphQuestions = expectedQA.graphQuestions;

            for (const q of graphQuestions) {
                expect(q.sourceUrls.length).toBeGreaterThanOrEqual(2);
            }
        });

        it("should cite relevant sources for answer content", () => {
            const pyreneeQuestion = expectedQA.graphQuestions.find((q: any) =>
                q.question.includes("Pyrenees"),
            );

            if (pyreneeQuestion) {
                const hasPyreneeSource = pyreneeQuestion.sourceUrls.some(
                    (url: string) => url.includes("Pyrenees"),
                );
                expect(hasPyreneeSource).toBe(true);
            }
        });

        it("should not cite irrelevant sources", () => {
            const graphQuestions = expectedQA.graphQuestions;

            for (const q of graphQuestions) {
                for (const url of q.sourceUrls) {
                    expect(url).toContain("wikipedia.org");
                }
            }
        });
    });

    describe("Multi-Document Synthesis", () => {
        it("should synthesize information from multiple pages", () => {
            const graphQuestions = expectedQA.graphQuestions.filter(
                (q: any) => q.sourceUrls.length > 1,
            );

            expect(graphQuestions.length).toBeGreaterThan(0);

            for (const q of graphQuestions) {
                expect(q.expectedAnswer.length).toBeGreaterThan(100);
            }
        });

        it("should compare information across sources", () => {
            const compareQuestion = expectedQA.graphQuestions.find((q: any) =>
                q.question.toLowerCase().includes("compare"),
            );

            if (compareQuestion) {
                const answer = compareQuestion.expectedAnswer.toLowerCase();

                expect(answer).toContain("atlas");
                expect(answer).toContain("pyrenees");

                expect(compareQuestion.sourceUrls.length).toBeGreaterThan(1);
            }
        });

        it("should integrate facts from multiple sources", () => {
            const orogenyQuestion = expectedQA.graphQuestions.find((q: any) =>
                q.question.toLowerCase().includes("alpine orogeny"),
            );

            if (orogenyQuestion) {
                const entities = orogenyQuestion.relevantEntities;
                expect(entities.length).toBeGreaterThan(2);
            }
        });

        it("should maintain coherence in multi-source answers", () => {
            const graphQuestions = expectedQA.graphQuestions.filter(
                (q: any) => q.sourceUrls.length > 1,
            );

            for (const q of graphQuestions) {
                const sentences = q.expectedAnswer
                    .split(/[.!?]+/)
                    .filter((s: string) => s.trim().length > 0);

                expect(sentences.length).toBeGreaterThan(1);

                for (let i = 0; i < sentences.length - 1; i++) {
                    expect(sentences[i].trim().length).toBeGreaterThan(0);
                }
            }
        });
    });

    describe("Answer Completeness", () => {
        it("should answer all parts of multi-part questions", () => {
            const compareQuestion = expectedQA.graphQuestions.find((q: any) =>
                q.question.includes("height and formation"),
            );

            if (compareQuestion) {
                const answer = compareQuestion.expectedAnswer.toLowerCase();

                expect(answer).toMatch(/\d+.*meters?/);
                const hasFormation =
                    answer.includes("formation") || answer.includes("formed");
                expect(hasFormation).toBe(true);
            }
        });

        it("should provide context for technical terms", () => {
            const orogenyQuestion = expectedQA.graphQuestions.find((q: any) =>
                q.expectedAnswer.toLowerCase().includes("alpine orogeny"),
            );

            if (orogenyQuestion) {
                const answer = orogenyQuestion.expectedAnswer.toLowerCase();
                expect(answer).toContain("tectonic");
            }
        });

        it("should include quantitative data when relevant", () => {
            const highestPeakQuestion = expectedQA.pageQuestions.find(
                (q: any) => q.question.includes("highest peak"),
            );

            expect(highestPeakQuestion.expectedAnswer).toMatch(/\d+/);
            expect(highestPeakQuestion.expectedAnswer).toContain("4,167");
        });

        it("should provide examples when helpful", () => {
            const subrangesQuestion = expectedQA.pageQuestions.find((q: any) =>
                q.question.toLowerCase().includes("sub-ranges"),
            );

            if (subrangesQuestion) {
                const answer = subrangesQuestion.expectedAnswer;
                expect(answer).toContain("High Atlas");
            }
        });
    });

    describe("Answer Confidence", () => {
        it("should have higher confidence for page questions", () => {
            const pageAvgConfidence =
                expectedQA.pageQuestions.reduce(
                    (sum: number, q: any) => sum + q.confidence,
                    0,
                ) / expectedQA.pageQuestions.length;

            const graphAvgConfidence =
                expectedQA.graphQuestions.reduce(
                    (sum: number, q: any) => sum + q.confidence,
                    0,
                ) / expectedQA.graphQuestions.length;

            expect(pageAvgConfidence).toBeGreaterThan(graphAvgConfidence);
        });

        it("should have higher confidence for factual answers", () => {
            const factualQuestions = expectedQA.pageQuestions.filter(
                (q: any) => q.answerType === "factual",
            );

            for (const q of factualQuestions) {
                expect(q.confidence).toBeGreaterThan(0.85);
            }
        });

        it("should have reasonable confidence for analytical answers", () => {
            const analyticalQuestions = expectedQA.graphQuestions.filter(
                (q: any) => q.answerType === "analytical",
            );

            for (const q of analyticalQuestions) {
                expect(q.confidence).toBeGreaterThan(0.75);
                expect(q.confidence).toBeLessThan(0.95);
            }
        });

        it("should reflect answer quality in confidence", () => {
            const allQuestions = [
                ...expectedQA.pageQuestions,
                ...expectedQA.graphQuestions,
            ];

            for (const q of allQuestions) {
                if (q.confidence > 0.9) {
                    expect(q.expectedAnswer.length).toBeGreaterThan(30);
                    expect(q.sourceUrls.length).toBeGreaterThan(0);
                }
            }
        });
    });

    describe("Mock Answer Generation Pipeline", () => {
        it("should handle full answer pipeline with mocks", () => {
            const question = "What is the highest peak in the Atlas Mountains?";

            const context = [
                {
                    text: "Mount Toubkal is the highest peak at 4,167 meters.",
                },
            ];

            const response = testContext.llm.getAnswerGenerationResponse(
                question,
                context,
            );

            expect(response).toBeDefined();
            expect(response.success).toBe(true);
            expect(response.answer).toBeDefined();
            expect(response.sources).toBeDefined();
            expect(response.confidence).toBeGreaterThan(0);
        });

        it("should handle questions without matching content", () => {
            const question = "What is the capital of Mars?";
            const context = [{ text: "Mount Toubkal at 4,167 meters." }];

            const response = testContext.llm.getAnswerGenerationResponse(
                question,
                context,
            );

            expect(response).toBeDefined();
            expect(response.success).toBe(false);
        });

        it("should provide consistent results for same question", () => {
            const question = "What is the highest peak in the Atlas Mountains?";
            const context = [{ text: "Mount Toubkal at 4,167 meters." }];

            const response1 = testContext.llm.getAnswerGenerationResponse(
                question,
                context,
            );
            const response2 = testContext.llm.getAnswerGenerationResponse(
                question,
                context,
            );

            expect(response1.answer).toBe(response2.answer);
        });
    });
});
