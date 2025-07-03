// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { handleKnowledgeAction } from "../src/agent/knowledge/knowledgeHandlerAdapter.mjs";
import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../src/agent/actionHandler.mjs";
import * as website from "website-memory";

describe("Knowledge Handler Adapter", () => {
    let mockContext: SessionContext<BrowserActionContext>;
    
    beforeEach(() => {
        mockContext = {
            agentContext: {
                websiteCollection: new website.WebsiteCollection(),
                useExternalBrowserControl: false,
                localHostPort: 3000,
                index: undefined,
            }
        } as SessionContext<BrowserActionContext>;
    });

    describe("extractKnowledgeFromPage", () => {
        it("should extract knowledge from page content", async () => {
            const parameters = {
                url: "https://example.com",
                title: "Example Page",
                htmlFragments: [
                    { text: "This is a test page about TypeScript programming language. It covers various topics including types, interfaces, and modules." }
                ],
                extractEntities: true,
                extractRelationships: true,
                suggestQuestions: true,
                quality: "balanced" as const,
            };

            const result = await handleKnowledgeAction("extractKnowledgeFromPage", parameters, mockContext);

            expect(result).toBeDefined();
            expect(result.summary).toBeDefined();
            expect(result.entities).toBeDefined();
            expect(result.relationships).toBeDefined();
            expect(result.keyTopics).toBeDefined();
            expect(result.suggestedQuestions).toBeDefined();
            expect(Array.isArray(result.suggestedQuestions)).toBe(true);
            
            console.log("Knowledge extraction result:", {
                entitiesCount: result.entities.length,
                relationshipsCount: result.relationships.length,
                topicsCount: result.keyTopics.length,
                questionsCount: result.suggestedQuestions.length,
                summary: result.summary
            });
        });

        it("should handle insufficient content gracefully", async () => {
            const parameters = {
                url: "https://example.com",
                title: "Empty Page", 
                htmlFragments: [{ text: "Hi" }], // Very short content
                extractEntities: true,
                extractRelationships: true,
                suggestQuestions: false,
                quality: "fast" as const,
            };

            const result = await handleKnowledgeAction("extractKnowledgeFromPage", parameters, mockContext);

            expect(result.summary).toBe("Insufficient content to extract knowledge.");
            expect(result.entities).toEqual([]);
            expect(result.relationships).toEqual([]);
            expect(result.keyTopics).toEqual([]);
            expect(result.suggestedQuestions).toEqual([]);
        });
    });

    describe("indexWebPageContent", () => {
        it("should index web page content successfully", async () => {
            const parameters = {
                url: "https://example.com/article",
                title: "Programming Article",
                htmlFragments: [
                    { text: "Learn JavaScript programming with this comprehensive guide." }
                ],
                extractKnowledge: true,
                timestamp: new Date().toISOString(),
                quality: "balanced" as const,
                textOnly: false,
            };

            const result = await handleKnowledgeAction("indexWebPageContent", parameters, mockContext);

            expect(result.indexed).toBe(true);
            expect(result.knowledgeExtracted).toBe(true);
            expect(typeof result.entityCount).toBe("number");
            
            // Verify the page was added to the collection
            expect(mockContext.agentContext.websiteCollection?.messages.length).toBe(1);
            
            console.log("Indexing result:", result);
        });
    });

    describe("getKnowledgeIndexStats", () => {
        it("should return correct statistics", async () => {
            // First add some content
            await handleKnowledgeAction("indexWebPageContent", {
                url: "https://example.com/page1",
                title: "Page 1",
                htmlFragments: [{ text: "Content about TypeScript and JavaScript programming." }],
                extractKnowledge: true,
                timestamp: new Date().toISOString(),
            }, mockContext);

            await handleKnowledgeAction("indexWebPageContent", {
                url: "https://example.com/page2", 
                title: "Page 2",
                htmlFragments: [{ text: "More content about web development and React." }],
                extractKnowledge: true,
                timestamp: new Date().toISOString(),
            }, mockContext);

            const result = await handleKnowledgeAction("getKnowledgeIndexStats", {}, mockContext);

            expect(result.totalPages).toBe(2);
            expect(typeof result.totalEntities).toBe("number");
            expect(typeof result.totalRelationships).toBe("number");
            expect(result.lastIndexed).not.toBe("Never");
            expect(result.indexSize).toMatch(/\d+\s*KB/);
            
            console.log("Index stats:", result);
        });

        it("should handle empty collection", async () => {
            const result = await handleKnowledgeAction("getKnowledgeIndexStats", {}, mockContext);

            expect(result.totalPages).toBe(0);
            expect(result.totalEntities).toBe(0);
            expect(result.totalRelationships).toBe(0);
            expect(result.lastIndexed).toBe("Never");
            expect(result.indexSize).toBe("0 KB");
        });
    });

    describe("checkPageIndexStatus", () => {
        it("should check if page is indexed", async () => {
            const testUrl = "https://example.com/test-page";
            
            // Check before indexing
            let result = await handleKnowledgeAction("checkPageIndexStatus", { url: testUrl }, mockContext);
            expect(result.isIndexed).toBe(false);
            expect(result.lastIndexed).toBe(null);
            expect(result.entityCount).toBe(0);

            // Index the page
            await handleKnowledgeAction("indexWebPageContent", {
                url: testUrl,
                title: "Test Page",
                htmlFragments: [{ text: "This is test content with programming concepts." }],
                extractKnowledge: true,
                timestamp: new Date().toISOString(),
            }, mockContext);

            // Check after indexing
            result = await handleKnowledgeAction("checkPageIndexStatus", { url: testUrl }, mockContext);
            expect(result.isIndexed).toBe(true);
            expect(result.lastIndexed).not.toBe(null);
            expect(typeof result.entityCount).toBe("number");

            console.log("Page index status:", result);
        });
    });

    describe("clearKnowledgeIndex", () => {
        it("should clear the knowledge index", async () => {
            // Add some content first
            await handleKnowledgeAction("indexWebPageContent", {
                url: "https://example.com/page-to-clear",
                title: "Page to Clear",
                htmlFragments: [{ text: "Content that will be cleared." }],
                extractKnowledge: true,
                timestamp: new Date().toISOString(),
            }, mockContext);

            // Verify content exists
            let stats = await handleKnowledgeAction("getKnowledgeIndexStats", {}, mockContext);
            expect(stats.totalPages).toBe(1);

            // Clear the index
            const result = await handleKnowledgeAction("clearKnowledgeIndex", {}, mockContext);
            expect(result.success).toBe(true);
            expect(result.message).toContain("Successfully cleared");

            // Verify content is cleared
            stats = await handleKnowledgeAction("getKnowledgeIndexStats", {}, mockContext);
            expect(stats.totalPages).toBe(0);
        });
    });
});
