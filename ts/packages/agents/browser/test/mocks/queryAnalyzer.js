// Mock for QueryAnalyzer that doesn't use import.meta.url
export class QueryAnalyzer {
    constructor() {
        // Mock constructor
    }

    async analyzeQuery(query) {
        // Mock analysis - return a simple analysis for testing
        return {
            intent: {
                type: "find_specific",
                confidence: 0.8
            },
            temporalFilters: [],
            contentFilters: [],
            enhancedQuery: query,
            confidence: 0.8
        };
    }

    async initialize() {
        // Mock initialization
        return Promise.resolve();
    }
}
