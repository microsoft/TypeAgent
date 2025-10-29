// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync } from "fs";
import { join } from "path";

const FIXTURES_DIR = join(__dirname, "..", "fixtures");

export class MockLLMResponses {
    private static loadFixture(path: string): any {
        const content = readFileSync(join(FIXTURES_DIR, path), "utf-8");
        return JSON.parse(content);
    }

    static getEntityExtractionResponse(content: string): any {
        if (content.includes("Atlas Mountains")) {
            const knowledge = this.loadFixture(
                "atlas-mountains/expected-knowledge.json",
            );
            return {
                entities: knowledge.entities,
                topics: knowledge.keyTopics,
                relationships: knowledge.relationships,
                summary: knowledge.summary,
                success: true,
            };
        }

        return {
            entities: [],
            topics: [],
            relationships: [],
            summary: "",
            success: false,
        };
    }

    static getPageQuestionsResponse(pageContent: string): any {
        if (pageContent.includes("Atlas Mountains")) {
            return {
                questions: [
                    {
                        question:
                            "What is the highest peak in the Atlas Mountains?",
                        scope: "page",
                        rationale:
                            "Directly answerable from page content about Mount Toubkal",
                    },
                    {
                        question:
                            "Which countries do the Atlas Mountains stretch through?",
                        scope: "page",
                        rationale: "Geographic information present on the page",
                    },
                    {
                        question:
                            "What geological event formed the Atlas Mountains?",
                        scope: "page",
                        rationale:
                            "Geological formation details available on page",
                    },
                    {
                        question:
                            "What endangered primate species lives in the Atlas Mountains?",
                        scope: "page",
                        rationale:
                            "Flora and fauna information on current page",
                    },
                ],
                success: true,
            };
        }

        return {
            questions: [],
            success: false,
        };
    }

    static getGraphQuestionsResponse(
        relatedEntities: any[],
        relatedTopics: any[],
    ): any {
        const hasPyrenees = relatedEntities.some((e) => e.name === "Pyrenees");
        const hasAlps = relatedEntities.some((e) => e.name === "Alps");
        const hasMorocco = relatedEntities.some((e) => e.name === "Morocco");

        const questions: any[] = [];

        if (hasPyrenees) {
            questions.push({
                question:
                    "How do the Atlas Mountains compare to the Pyrenees in terms of height and formation?",
                scope: "broader",
                rationale:
                    "Requires knowledge from both Atlas Mountains and Pyrenees pages",
            });
        }

        if (hasAlps && hasPyrenees) {
            questions.push({
                question:
                    "What connections exist between the Atlas Mountains and other major mountain ranges formed during the Alpine orogeny?",
                scope: "broader",
                rationale:
                    "Requires synthesizing information across multiple mountain range pages",
            });
        }

        if (hasMorocco) {
            questions.push({
                question:
                    "What is the cultural and geographic relationship between Morocco and the Atlas Mountains?",
                scope: "related",
                rationale:
                    "Requires knowledge from both Atlas Mountains and Morocco pages",
            });
        }

        return {
            questions,
            success: true,
        };
    }

    static getAnswerGenerationResponse(question: string, context: any[]): any {
        const qaFixtures = this.loadFixture("atlas-mountains/expected-qa.json");

        const pageQuestion = qaFixtures.pageQuestions.find(
            (q: any) => q.question === question,
        );
        if (pageQuestion) {
            return {
                answer: pageQuestion.expectedAnswer,
                sources: pageQuestion.sourceUrls,
                relevantEntities: pageQuestion.relevantEntities,
                confidence: pageQuestion.confidence,
                success: true,
            };
        }

        const graphQuestion = qaFixtures.graphQuestions.find(
            (q: any) => q.question === question,
        );
        if (graphQuestion) {
            return {
                answer: graphQuestion.expectedAnswer,
                sources: graphQuestion.sourceUrls,
                relevantEntities: graphQuestion.relevantEntities,
                confidence: graphQuestion.confidence,
                success: true,
            };
        }

        return {
            answer: "I don't have enough information to answer that question.",
            sources: [],
            relevantEntities: [],
            confidence: 0.0,
            success: false,
        };
    }

    static getTextChunkingResponse(content: string): any {
        const chunks: any[] = [];
        const paragraphs = content.split("\n\n");

        let chunkIndex = 0;
        for (const paragraph of paragraphs) {
            if (paragraph.trim().length > 100) {
                chunks.push({
                    text: paragraph.trim(),
                    index: chunkIndex++,
                    startOffset: 0,
                    endOffset: paragraph.length,
                    tokenCount: Math.ceil(paragraph.length / 4),
                });
            }
        }

        return {
            chunks,
            totalChunks: chunks.length,
            success: true,
        };
    }

    static mockTypeChat<T>(operation: string, input: any): Promise<T> {
        return new Promise((resolve) => {
            setTimeout(() => {
                let response: any;

                switch (operation) {
                    case "extractEntities":
                        response = this.getEntityExtractionResponse(
                            input.content,
                        );
                        break;

                    case "generatePageQuestions":
                        response = this.getPageQuestionsResponse(
                            input.pageContent,
                        );
                        break;

                    case "generateGraphQuestions":
                        response = this.getGraphQuestionsResponse(
                            input.relatedEntities,
                            input.relatedTopics,
                        );
                        break;

                    case "generateAnswer":
                        response = this.getAnswerGenerationResponse(
                            input.question,
                            input.context,
                        );
                        break;

                    case "chunkText":
                        response = this.getTextChunkingResponse(input.content);
                        break;

                    default:
                        response = {
                            success: false,
                            error: "Unknown operation",
                        };
                }

                resolve(response as T);
            }, 10);
        });
    }
}
