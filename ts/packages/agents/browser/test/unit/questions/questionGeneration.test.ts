import { describe, it, expect, beforeEach } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import { setupTestMocks, resetAllMocks } from "../../mocks";

const FIXTURES_DIR = join(__dirname, "../../fixtures");

describe("Question Generation - Phase 3: Question Generation", () => {
    let testContext: ReturnType<typeof setupTestMocks>;
    let atlasContent: string;
    let expectedKnowledge: any;
    let expectedQA: any;
    let graphStructure: any;

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
    });

    describe("Page-Scoped Question Generation", () => {
        it("should generate page-scoped questions from content", () => {
            expect(expectedQA.pageQuestions).toBeDefined();
            expect(expectedQA.pageQuestions.length).toBeGreaterThan(5);

            for (const q of expectedQA.pageQuestions) {
                expect(q.scope).toBe("page");
            }
        });

        it("should generate factual questions about entities", () => {
            const pageQuestions = expectedQA.pageQuestions;

            const factualQuestions = pageQuestions.filter(
                (q: any) => q.answerType === "factual",
            );

            expect(factualQuestions.length).toBeGreaterThan(2);

            const highestPeakQuestion = pageQuestions.find((q: any) =>
                q.question.includes("highest peak"),
            );
            expect(highestPeakQuestion).toBeDefined();
            expect(highestPeakQuestion.answerType).toBe("factual");
        });

        it("should generate questions with relevant entities", () => {
            const pageQuestions = expectedQA.pageQuestions;

            for (const q of pageQuestions) {
                expect(q.relevantEntities).toBeDefined();
                expect(Array.isArray(q.relevantEntities)).toBe(true);
                expect(q.relevantEntities.length).toBeGreaterThan(0);
            }

            const moroccoQuestion = pageQuestions.find((q: any) =>
                q.question.toLowerCase().includes("countries"),
            );
            expect(moroccoQuestion.relevantEntities).toContain("Morocco");
            expect(moroccoQuestion.relevantEntities).toContain("Algeria");
        });

        it("should generate questions with relevant topics", () => {
            const pageQuestions = expectedQA.pageQuestions;

            for (const q of pageQuestions) {
                expect(q.relevantTopics).toBeDefined();
                expect(Array.isArray(q.relevantTopics)).toBe(true);
            }

            const geologyQuestion = pageQuestions.find((q: any) =>
                q.question.toLowerCase().includes("geological"),
            );
            expect(geologyQuestion.relevantTopics).toContain("Geology");
        });

        it("should generate questions that reference source URLs", () => {
            const pageQuestions = expectedQA.pageQuestions;

            for (const q of pageQuestions) {
                expect(q.sourceUrls).toBeDefined();
                expect(Array.isArray(q.sourceUrls)).toBe(true);
                expect(q.sourceUrls.length).toBeGreaterThan(0);

                expect(q.sourceUrls[0]).toContain("wikipedia.org");
            }
        });

        it("should generate questions with high confidence", () => {
            const pageQuestions = expectedQA.pageQuestions;

            const avgConfidence =
                pageQuestions.reduce(
                    (sum: number, q: any) => sum + q.confidence,
                    0,
                ) / pageQuestions.length;

            expect(avgConfidence).toBeGreaterThan(0.85);
        });

        it("should generate questions about different aspects", () => {
            const pageQuestions = expectedQA.pageQuestions;
            const topics = new Set<string>();

            for (const q of pageQuestions) {
                for (const topic of q.relevantTopics) {
                    topics.add(topic);
                }
            }

            expect(topics.size).toBeGreaterThan(4);
        });

        it("should generate descriptive and explanatory questions", () => {
            const pageQuestions = expectedQA.pageQuestions;

            const descriptive = pageQuestions.filter(
                (q: any) => q.answerType === "descriptive",
            );
            const explanatory = pageQuestions.filter(
                (q: any) => q.answerType === "explanatory",
            );

            expect(descriptive.length + explanatory.length).toBeGreaterThan(2);
        });
    });

    describe("Graph-Scoped Question Generation", () => {
        it("should generate graph-scoped questions", () => {
            expect(expectedQA.graphQuestions).toBeDefined();
            expect(expectedQA.graphQuestions.length).toBeGreaterThan(3);

            for (const q of expectedQA.graphQuestions) {
                expect(q.scope).toMatch(/broader|related/);
            }
        });

        it("should mark questions requiring graph traversal", () => {
            const graphQuestions = expectedQA.graphQuestions;

            for (const q of graphQuestions) {
                expect(q.requiresTraversal).toBe(true);
                expect(q.traversalDepth).toBeDefined();
                expect(q.traversalDepth).toBeGreaterThanOrEqual(1);
                expect(q.traversalDepth).toBeLessThanOrEqual(3);
            }
        });

        it("should generate comparative questions", () => {
            const graphQuestions = expectedQA.graphQuestions;

            const comparativeQuestions = graphQuestions.filter(
                (q: any) => q.answerType === "comparative",
            );

            expect(comparativeQuestions.length).toBeGreaterThan(1);

            const compareQuestion = graphQuestions.find((q: any) =>
                q.question.toLowerCase().includes("compare"),
            );
            expect(compareQuestion).toBeDefined();
            expect(compareQuestion.answerType).toBe("comparative");
        });

        it("should generate questions requiring multiple sources", () => {
            const graphQuestions = expectedQA.graphQuestions;

            for (const q of graphQuestions) {
                expect(q.sourceUrls).toBeDefined();
                expect(q.sourceUrls.length).toBeGreaterThan(1);
            }

            const pyreneeQuestion = graphQuestions.find((q: any) =>
                q.question.includes("Pyrenees"),
            );
            expect(pyreneeQuestion.sourceUrls.length).toBeGreaterThanOrEqual(2);
        });

        it("should generate analytical questions", () => {
            const graphQuestions = expectedQA.graphQuestions;

            const analyticalQuestions = graphQuestions.filter(
                (q: any) => q.answerType === "analytical",
            );

            expect(analyticalQuestions.length).toBeGreaterThan(1);
        });

        it("should reference entities from connected pages", () => {
            const graphQuestions = expectedQA.graphQuestions;

            const pyreneeQuestion = graphQuestions.find((q: any) =>
                q.question.includes("Pyrenees"),
            );
            expect(pyreneeQuestion).toBeDefined();
            expect(pyreneeQuestion.relevantEntities).toContain("Pyrenees");

            const alpsQuestion = graphQuestions.find((q: any) =>
                q.question.includes("Alps"),
            );
            if (alpsQuestion) {
                expect(alpsQuestion.relevantEntities).toContain("Alps");
            }
        });

        it("should have appropriate traversal depth for complexity", () => {
            const graphQuestions = expectedQA.graphQuestions;

            const simpleComparison = graphQuestions.find(
                (q: any) =>
                    q.question.includes("Morocco") &&
                    q.question.includes("Atlas"),
            );
            if (simpleComparison) {
                expect(simpleComparison.traversalDepth).toBeLessThanOrEqual(2);
            }

            const complexComparison = graphQuestions.find((q: any) =>
                q.question.toLowerCase().includes("history"),
            );
            if (complexComparison) {
                expect(complexComparison.traversalDepth).toBeGreaterThanOrEqual(
                    2,
                );
            }
        });
    });

    describe("Question Quality", () => {
        it("should generate well-formed questions", () => {
            const allQuestions = [
                ...expectedQA.pageQuestions,
                ...expectedQA.graphQuestions,
            ];

            for (const q of allQuestions) {
                expect(q.question).toBeDefined();
                expect(q.question.length).toBeGreaterThan(10);
                expect(q.question.endsWith("?")).toBe(true);
            }
        });

        it("should generate questions with expected answers", () => {
            const allQuestions = [
                ...expectedQA.pageQuestions,
                ...expectedQA.graphQuestions,
            ];

            for (const q of allQuestions) {
                expect(q.expectedAnswer).toBeDefined();
                expect(q.expectedAnswer.length).toBeGreaterThan(20);
            }
        });

        it("should generate diverse question types", () => {
            const allQuestions = [
                ...expectedQA.pageQuestions,
                ...expectedQA.graphQuestions,
            ];

            const answerTypes = new Set(
                allQuestions.map((q: any) => q.answerType),
            );

            expect(answerTypes.size).toBeGreaterThan(3);
            expect(answerTypes.has("factual")).toBe(true);
        });

        it("should avoid duplicate questions", () => {
            const allQuestions = [
                ...expectedQA.pageQuestions,
                ...expectedQA.graphQuestions,
            ];

            const questionTexts = allQuestions.map((q: any) => q.question);
            const uniqueQuestions = new Set(questionTexts);

            expect(questionTexts.length).toBe(uniqueQuestions.size);
        });

        it("should generate questions at appropriate complexity", () => {
            const pageQuestions = expectedQA.pageQuestions;
            const graphQuestions = expectedQA.graphQuestions;

            const pageAvgConfidence =
                pageQuestions.reduce(
                    (sum: number, q: any) => sum + q.confidence,
                    0,
                ) / pageQuestions.length;
            const graphAvgConfidence =
                graphQuestions.reduce(
                    (sum: number, q: any) => sum + q.confidence,
                    0,
                ) / graphQuestions.length;

            expect(pageAvgConfidence).toBeGreaterThan(graphAvgConfidence);
        });

        it("should generate answerable questions", () => {
            const allQuestions = [
                ...expectedQA.pageQuestions,
                ...expectedQA.graphQuestions,
            ];

            for (const q of allQuestions) {
                expect(q.confidence).toBeGreaterThan(0.75);
            }
        });
    });

    describe("Question-Answer Alignment", () => {
        it("should have entities in question present in answer", () => {
            const allQuestions = [
                ...expectedQA.pageQuestions,
                ...expectedQA.graphQuestions,
            ];

            for (const q of allQuestions) {
                const questionLower = q.question.toLowerCase();
                const answerLower = q.expectedAnswer.toLowerCase();

                const entities = q.relevantEntities;
                let foundEntity = false;

                for (const entity of entities) {
                    if (
                        questionLower.includes(entity.toLowerCase()) ||
                        answerLower.includes(entity.toLowerCase())
                    ) {
                        foundEntity = true;
                        break;
                    }
                }

                expect(foundEntity).toBe(true);
            }
        });

        it("should reference correct source URLs", () => {
            const pageQuestions = expectedQA.pageQuestions;

            for (const q of pageQuestions) {
                expect(q.sourceUrls).toContain(
                    "https://en.wikipedia.org/wiki/Atlas_Mountains",
                );
            }
        });

        it("should have topics aligned with question content", () => {
            const geographyQuestion = expectedQA.pageQuestions.find((q: any) =>
                q.question.toLowerCase().includes("countries"),
            );

            expect(geographyQuestion.relevantTopics).toContain("Geography");
        });
    });

    describe("Mock Question Generation", () => {
        it("should generate page questions using mock LLM", () => {
            const response =
                testContext.llm.getPageQuestionsResponse(atlasContent);

            expect(response.success).toBe(true);
            expect(response.questions).toBeDefined();
            expect(response.questions.length).toBeGreaterThan(0);

            for (const q of response.questions) {
                expect(q.scope).toBe("page");
                expect(q.question).toBeDefined();
            }
        });

        it("should generate graph questions using mock LLM", () => {
            const relatedEntities = [
                { name: "Pyrenees", type: "mountain_range" },
                { name: "Morocco", type: "country" },
            ];
            const relatedTopics = ["Geography", "Geology"];

            const response = testContext.llm.getGraphQuestionsResponse(
                relatedEntities,
                relatedTopics,
            );

            expect(response.success).toBe(true);
            expect(response.questions).toBeDefined();
            expect(response.questions.length).toBeGreaterThan(0);

            for (const q of response.questions) {
                expect(q.scope).toMatch(/broader|related/);
            }
        });

        it("should generate comparative questions when related entities exist", () => {
            const relatedEntities = [
                { name: "Pyrenees", type: "mountain_range" },
                { name: "Alps", type: "mountain_range" },
            ];
            const relatedTopics = ["Geology", "Mountain Formation"];

            const response = testContext.llm.getGraphQuestionsResponse(
                relatedEntities,
                relatedTopics,
            );

            expect(response.questions.length).toBeGreaterThan(0);

            const hasComparative = response.questions.some((q: any) =>
                q.question.toLowerCase().includes("compare"),
            );
            expect(hasComparative).toBe(true);
        });
    });
});
