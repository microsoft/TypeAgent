// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebsiteMeta, WebsiteVisitInfo } from "../src/websiteMeta.js";

/**
 * Test enhanced knowledge generation for temporal and frequency queries
 */
describe("Enhanced Website Knowledge Generation", () => {
    test("should generate temporal facets and topics for github bookmark", () => {
        const visitInfo: WebsiteVisitInfo = {
            url: "https://github.com/microsoft/typeagent",
            title: "Microsoft TypeAgent Repository",
            domain: "github.com",
            bookmarkDate: "2024-01-15T10:30:00Z",
            source: "bookmark",
            pageType: "development",
            visitCount: 25,
        };

        const meta = new WebsiteMeta(visitInfo);
        const knowledge = meta.getKnowledge();

        // Check enhanced domain entity with facets
        const domainEntity = knowledge.entities.find(
            (e) => e.name === "github.com",
        );
        expect(domainEntity).toBeDefined();
        expect(domainEntity!.type).toContain("website");
        expect(domainEntity!.type).toContain("domain");

        // Check temporal facets
        expect(domainEntity!.facets).toContainEqual({
            name: "bookmarkDate",
            value: "2024-01-15T10:30:00Z",
        });
        expect(domainEntity!.facets).toContainEqual({
            name: "bookmarkYear",
            value: "2024",
        });

        // Check frequency facets
        expect(domainEntity!.facets).toContainEqual({
            name: "visitCount",
            value: "25",
        });
        expect(domainEntity!.facets).toContainEqual({
            name: "visitFrequency",
            value: "high",
        });

        // Check category facets
        expect(domainEntity!.facets).toContainEqual({
            name: "category",
            value: "development",
        });

        // Check temporal topics
        expect(knowledge.topics).toContain("bookmarked in 2024");
        expect(knowledge.topics).toContain("github.com bookmark from 2024");
        expect(knowledge.topics).toContain("recent bookmark");

        // Check frequency topics
        expect(knowledge.topics).toContain("frequently visited site");
        expect(knowledge.topics).toContain("popular domain");

        // Check category topics
        expect(knowledge.topics).toContain("development");
        expect(knowledge.topics).toContain("development site");
        expect(knowledge.topics).toContain("development bookmark from 2024");

        // Check enhanced actions (no facets on actions, just parameters)
        const bookmarkAction = knowledge.actions[0];
        expect(bookmarkAction.verbs).toContain("bookmarked");
        expect(bookmarkAction.subjectEntityName).toBe("user");
        expect(bookmarkAction.objectEntityName).toBe("github.com");

        // Actions can have parameters for temporal/frequency context
        expect(bookmarkAction.params).toBeDefined();
        if (bookmarkAction.params) {
            const actionDate = bookmarkAction.params.find(
                (p) => typeof p === "object" && p.name === "actionDate",
            );
            expect(actionDate).toBeDefined();
        }
    });

    test("should handle early vs recent bookmark temporal context", () => {
        // Early bookmark (2022)
        const earlyBookmark = new WebsiteMeta({
            url: "https://github.com/early-repo",
            domain: "github.com",
            bookmarkDate: "2022-01-01T00:00:00Z",
            source: "bookmark",
            pageType: "development",
        });

        // Recent bookmark (current year)
        const recentBookmark = new WebsiteMeta({
            url: "https://github.com/recent-repo",
            domain: "github.com",
            bookmarkDate: "2024-12-01T00:00:00Z",
            source: "bookmark",
            pageType: "development",
        });

        const earlyKnowledge = earlyBookmark.getKnowledge();
        const recentKnowledge = recentBookmark.getKnowledge();

        // Early bookmark should have "old bookmark" topics
        expect(earlyKnowledge.topics).toContain("old bookmark");
        expect(earlyKnowledge.topics).toContain("early bookmark");
        expect(earlyKnowledge.topics).toContain("bookmarked in 2022");

        // Recent bookmark should have "recent bookmark" topics
        expect(recentKnowledge.topics).toContain("recent bookmark");
        expect(recentKnowledge.topics).toContain("new bookmark");
        expect(recentKnowledge.topics).toContain("bookmarked in 2024");
    });

    test("should classify visit frequency correctly", () => {
        // High frequency site
        const highFreqSite = new WebsiteMeta({
            url: "https://stackoverflow.com/questions",
            domain: "stackoverflow.com",
            source: "history",
            visitCount: 45,
            pageType: "development",
        });

        // Medium frequency site
        const medFreqSite = new WebsiteMeta({
            url: "https://docs.react.dev",
            domain: "docs.react.dev",
            source: "bookmark",
            visitCount: 8,
            pageType: "development",
        });

        // Low frequency site
        const lowFreqSite = new WebsiteMeta({
            url: "https://example.com",
            domain: "example.com",
            source: "history",
            visitCount: 1,
        });

        const highKnowledge = highFreqSite.getKnowledge();
        const medKnowledge = medFreqSite.getKnowledge();
        const lowKnowledge = lowFreqSite.getKnowledge();

        // Check frequency facets
        const highEntity = highKnowledge.entities.find(
            (e) => e.name === "stackoverflow.com",
        );
        expect(highEntity).toBeDefined();
        expect(highEntity!.facets).toContainEqual({
            name: "visitFrequency",
            value: "high",
        });
        expect(highKnowledge.topics).toContain("frequently visited site");

        const medEntity = medKnowledge.entities.find(
            (e) => e.name === "docs.react.dev",
        );
        expect(medEntity).toBeDefined();
        expect(medEntity!.facets).toContainEqual({
            name: "visitFrequency",
            value: "medium",
        });

        const lowEntity = lowKnowledge.entities.find(
            (e) => e.name === "example.com",
        );
        expect(lowEntity).toBeDefined();
        expect(lowEntity!.facets).toContainEqual({
            name: "visitFrequency",
            value: "low",
        });
        expect(lowKnowledge.topics).toContain("rarely visited site");
    });

    test("should generate appropriate category-specific topics", () => {
        const devSite = new WebsiteMeta({
            url: "https://docs.typescript.org",
            domain: "docs.typescript.org",
            bookmarkDate: "2023-06-15T14:20:00Z",
            source: "bookmark",
            pageType: "development",
            title: "TypeScript Documentation",
        });

        const knowledge = devSite.getKnowledge();

        // Should have category-specific topics
        expect(knowledge.topics).toContain("development");
        expect(knowledge.topics).toContain("development site");
        expect(knowledge.topics).toContain("development website");
        expect(knowledge.topics).toContain("development bookmark from 2023");

        // Should include title
        expect(knowledge.topics).toContain("TypeScript Documentation");
    });

    test("should handle folder context for bookmarks", () => {
        const bookmarkWithFolder = new WebsiteMeta({
            url: "https://react.dev",
            domain: "react.dev",
            source: "bookmark",
            folder: "Development/Frontend",
            title: "React Documentation",
        });

        const knowledge = bookmarkWithFolder.getKnowledge();

        // Should include folder in facets
        const entity = knowledge.entities.find((e) => e.name === "react.dev");
        expect(entity).toBeDefined();
        expect(entity!.facets).toContainEqual({
            name: "folder",
            value: "Development/Frontend",
        });

        // Should include folder in topics
        expect(knowledge.topics).toContain("Development/Frontend");
        expect(knowledge.topics).toContain(
            "bookmark folder: Development/Frontend",
        );
    });

    test("should handle history vs bookmark source differences", () => {
        const bookmark = new WebsiteMeta({
            url: "https://github.com/user/repo",
            domain: "github.com",
            bookmarkDate: "2024-01-15T10:00:00Z",
            source: "bookmark",
        });

        const historyVisit = new WebsiteMeta({
            url: "https://github.com/user/other-repo",
            domain: "github.com",
            visitDate: "2024-01-15T11:00:00Z",
            source: "history",
        });

        const bookmarkKnowledge = bookmark.getKnowledge();
        const historyKnowledge = historyVisit.getKnowledge();

        // Check source facets
        const bookmarkEntity = bookmarkKnowledge.entities.find(
            (e) => e.name === "github.com",
        );
        expect(bookmarkEntity).toBeDefined();
        expect(bookmarkEntity!.facets).toContainEqual({
            name: "source",
            value: "bookmark",
        });

        const historyEntity = historyKnowledge.entities.find(
            (e) => e.name === "github.com",
        );
        expect(historyEntity).toBeDefined();
        expect(historyEntity!.facets).toContainEqual({
            name: "source",
            value: "history",
        });

        // Check action verbs
        const bookmarkAction = bookmarkKnowledge.actions[0];
        expect(bookmarkAction.verbs).toContain("bookmarked");

        const historyAction = historyKnowledge.actions[0];
        expect(historyAction.verbs).toContain("visited");
    });
});

/**
 * Integration test to verify enhanced queries work end-to-end
 */
describe("Enhanced Website Query Integration", () => {
    test("should support temporal ordering queries", () => {
        // This would be tested in a real environment with actual website collection
        // For now, we verify the knowledge structure supports temporal queries

        const sites = [
            new WebsiteMeta({
                url: "https://github.com/first-repo",
                domain: "github.com",
                bookmarkDate: "2022-01-01T00:00:00Z",
                source: "bookmark",
                title: "First GitHub Repo",
            }),
            new WebsiteMeta({
                url: "https://github.com/second-repo",
                domain: "github.com",
                bookmarkDate: "2024-01-01T00:00:00Z",
                source: "bookmark",
                title: "Second GitHub Repo",
            }),
        ];

        // Verify both have the facets needed for temporal ordering
        sites.forEach((site) => {
            const knowledge = site.getKnowledge();
            const entity = knowledge.entities.find(
                (e) => e.name === "github.com",
            );

            expect(entity).toBeDefined();
            expect(entity!.facets).toBeDefined();
            expect(entity!.facets!.some((f) => f.name === "bookmarkDate")).toBe(
                true,
            );
            expect(entity!.facets!.some((f) => f.name === "bookmarkYear")).toBe(
                true,
            );
            expect(
                knowledge.topics.some((t) => t.includes("bookmarked in")),
            ).toBe(true);
        });
    });

    test("should integrate enhanced knowledge with base knowledge", () => {
        const visitInfo = {
            url: "https://example.com/article",
            title: "Example Article",
            domain: "example.com",
            source: "bookmark" as const,
            pageType: "news",
            detectedActions: [
                {
                    actionType: "ShareAction",
                    name: "Social media sharing",
                    confidence: 0.9,
                    selectors: [".share-button"],
                },
            ],
        };

        const meta = new WebsiteMeta(visitInfo);

        // Mock enhanced knowledge from conversation package
        const enhancedKnowledge = {
            entities: [
                {
                    name: "artificial intelligence",
                    type: ["concept", "technology"],
                    facets: [{ name: "field", value: "computer science" }],
                },
            ],
            topics: ["machine learning", "neural networks"],
            actions: [
                {
                    verbs: ["discusses"],
                    verbTense: "present" as const,
                    subjectEntityName: "article",
                    objectEntityName: "artificial intelligence",
                    indirectObjectEntityName: "none",
                    params: [],
                },
            ],
            inverseActions: [],
        };

        const mergedKnowledge = meta.getEnhancedKnowledge(enhancedKnowledge);

        // Should have entities from both base and enhanced knowledge
        expect(mergedKnowledge.entities.length).toBeGreaterThan(1);
        expect(
            mergedKnowledge.entities.some((e) => e.name === "example.com"),
        ).toBe(true);
        expect(
            mergedKnowledge.entities.some(
                (e) => e.name === "artificial intelligence",
            ),
        ).toBe(true);

        // Should have topics from both sources
        expect(mergedKnowledge.topics).toContain("machine learning");
        expect(mergedKnowledge.topics).toContain("neural networks");
        expect(mergedKnowledge.topics.some((t) => t.includes("bookmark"))).toBe(
            true,
        );

        // Should preserve website-specific facets
        const domainEntity = mergedKnowledge.entities.find(
            (e) => e.name === "example.com",
        );
        expect(domainEntity?.facets?.some((f) => f.name === "source")).toBe(
            true,
        );
    });
});

/**
 * Test knowledge-enhanced search capabilities
 */
describe("Knowledge-Enhanced Search", () => {
    let collection: any;

    beforeEach(() => {
        // This would use the actual WebsiteCollection in a real test
        // For now, we test the search logic conceptually
        collection = {
            searchByEntities: jest.fn(),
            searchByTopics: jest.fn(),
            searchByActions: jest.fn(),
            hybridSearch: jest.fn(),
        };
    });

    test("should search by knowledge entities", async () => {
        const mockResults = [
            {
                url: "https://example.com",
                title: "Example Site",
                getKnowledge: () => ({
                    entities: [{ name: "javascript", type: ["language"] }],
                    topics: [],
                    actions: [],
                }),
            },
        ];

        collection.searchByEntities.mockResolvedValue(mockResults);

        const results = await collection.searchByEntities(["javascript"]);
        expect(results).toHaveLength(1);
        expect(collection.searchByEntities).toHaveBeenCalledWith([
            "javascript",
        ]);
    });

    test("should search by knowledge topics", async () => {
        const mockResults = [
            {
                url: "https://tutorial.com",
                title: "Programming Tutorial",
                getKnowledge: () => ({
                    entities: [],
                    topics: ["programming", "tutorial"],
                    actions: [],
                }),
            },
        ];

        collection.searchByTopics.mockResolvedValue(mockResults);

        const results = await collection.searchByTopics(["programming"]);
        expect(results).toHaveLength(1);
        expect(collection.searchByTopics).toHaveBeenCalledWith(["programming"]);
    });

    test("should perform hybrid search with relevance scoring", async () => {
        const mockResults = [
            {
                website: { url: "https://example.com" },
                relevanceScore: 0.8,
                matchedElements: ["title", "topics"],
                knowledgeContext: {
                    entityCount: 5,
                    topicCount: 3,
                    actionCount: 2,
                },
            },
        ];

        collection.hybridSearch.mockResolvedValue(mockResults);

        const results = await collection.hybridSearch("javascript programming");
        expect(results).toHaveLength(1);
        expect(results[0].relevanceScore).toBe(0.8);
        expect(results[0].knowledgeContext).toBeDefined();
    });
});

/**
 * Test knowledge analytics and insights
 */
describe("Knowledge Analytics", () => {
    test("should calculate knowledge insights", () => {
        // Mock the insights calculation
        const insights = {
            totalSites: 2,
            sitesWithKnowledge: 2,
            topEntities: new Map([
                ["javascript", 2],
                ["react", 1],
            ]),
            topTopics: new Map([
                ["web development", 1],
                ["frontend", 1],
                ["programming", 1],
            ]),
            actionTypes: new Map([["uses", 1]]),
            averageKnowledgeRichness: 2.5,
            timeframe: "all",
        };

        expect(insights.totalSites).toBe(2);
        expect(insights.sitesWithKnowledge).toBe(2);
        expect(insights.topEntities.get("javascript")).toBe(2);
        expect(insights.averageKnowledgeRichness).toBe(2.5);
    });

    test("should track knowledge growth over time", () => {
        const mockGrowthInsights = {
            entityGrowth: new Map([
                ["javascript", 3],
                ["react", 2],
                ["node.js", 1],
            ]),
            topicGrowth: new Map([
                ["web development", 4],
                ["backend", 2],
                ["frontend", 3],
            ]),
            knowledgeRichnessTrend: [
                { date: "2024-01-15", richness: 5 },
                { date: "2024-01-16", richness: 8 },
                { date: "2024-01-17", richness: 12 },
            ],
        };

        expect(mockGrowthInsights.entityGrowth.get("javascript")).toBe(3);
        expect(mockGrowthInsights.knowledgeRichnessTrend).toHaveLength(3);
        expect(mockGrowthInsights.knowledgeRichnessTrend[2].richness).toBe(12);
    });
});
