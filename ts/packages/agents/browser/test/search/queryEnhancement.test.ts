// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { QueryEnhancementAdapter } from "../../src/agent/search/queryEnhancementAdapter.mjs";

describe("QueryEnhancementAdapter - Target Queries", () => {
    let adapter: QueryEnhancementAdapter;

    beforeEach(() => {
        adapter = new QueryEnhancementAdapter();
    });

    describe("Target Query Enhancement", () => {
        const testCases = [
            {
                query: "most recently bookmarked github repo",
                description: "Should optimize query and apply github + bookmark filters"
            },
            {
                query: "summarize car reviews last week", 
                description: "Should optimize query and apply temporal filter"
            },
            {
                query: "most often visited news site",
                description: "Should optimize query for frequency ranking"
            },
            {
                query: "earliest transformers article bookmarked",
                description: "Should optimize query and apply earliest + bookmark filters"
            },
            {
                query: "car review I read last month",
                description: "Should optimize query and apply temporal filter"
            }
        ];

        testCases.forEach(({ query, description }) => {
            it(`should enhance: "${query}"`, async () => {
                const request = { 
                    query, 
                    limit: 20,
                    enableAdvancedSearch: true,
                    generateAnswer: true
                };
                
                // Test that enhancement doesn't throw errors
                const enhanced = await adapter.enhanceSearchRequest(request, {});
                
                expect(enhanced).toBeTruthy();
                expect(enhanced.query).toBeTruthy();
                expect(typeof enhanced.query).toBe('string');
                
                // Should have metadata with analysis
                const analysis = (enhanced as any).metadata?.analysis;
                if (analysis) {
                    expect(analysis.intent).toBeTruthy();
                    expect(analysis.intent.type).toBeTruthy();
                    expect(analysis.confidence).toBeGreaterThan(0);
                }
                
                console.log(`Enhanced "${query}":`);
                console.log(`  Original: "${request.query}"`);
                console.log(`  Optimized: "${enhanced.query}"`);
                if (enhanced.domain) console.log(`  Domain filter: ${enhanced.domain}`);
                if (enhanced.source) console.log(`  Source filter: ${enhanced.source}`);
                if (enhanced.dateFrom) console.log(`  Date range: ${enhanced.dateFrom} to ${enhanced.dateTo}`);
                if (analysis) {
                    console.log(`  Intent: ${analysis.intent.type} (confidence: ${analysis.confidence})`);
                    if (analysis.ranking) console.log(`  Ranking: ${analysis.ranking.primaryFactor} ${analysis.ranking.direction}`);
                }
                console.log('');
            });
        });
    });

    describe("Simple Queries", () => {
        const simpleQueries = [
            "machine learning",
            "react tutorial",
            "python documentation"
        ];

        simpleQueries.forEach(query => {
            it(`should handle simple query: "${query}"`, async () => {
                const request = { query, limit: 20 };
                
                // Should not throw even for simple queries
                const enhanced = await adapter.enhanceSearchRequest(request, {});
                
                expect(enhanced).toBeTruthy();
                expect(enhanced.query).toBeTruthy();
                
                console.log(`Simple query "${query}" -> "${enhanced.query}"`);
            });
        });
    });
});
