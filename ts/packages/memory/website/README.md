# Website Memory

A structured RAG implementation for website visit memory, including bookmarks and browsing history with advanced knowledge extraction capabilities.

## Features

- Import bookmarks and browsing history from Chrome and Edge
- Semantic search over website content and metadata
- **Advanced Content Extraction**: Multiple extraction modes with AI-powered knowledge processing
- **Unified Knowledge Extraction**: Consolidated extraction system with strict error handling
- **Batch Processing**: Efficient concurrent processing with progress tracking
- Structured data frames for visit frequency, categories, and bookmark organization
- Background indexing service for real-time updates
- Entity extraction for URLs, domains, and website categories

## Content Extraction System

### Extraction Modes

The website-memory package provides a unified extraction system with four distinct modes:

| Mode | Description | AI Required | Extracts Actions | Extracts Relationships |
|------|-------------|-------------|------------------|----------------------|
| `basic` | URL/title extraction only | ❌ | ❌ | ❌ |
| `content` | Full content + AI knowledge | ✅ | ❌ | ❌ |
| `actions` | Content + action detection | ✅ | ✅ | ❌ |
| `full` | Complete extraction + relationships | ✅ | ✅ | ✅ |

### Quick Start with Extraction

```typescript
import { ContentExtractor } from "website-memory";

// Basic extraction (no AI required)
const extractor = new ContentExtractor();
const result = await extractor.extract({
    url: "https://example.com",
    title: "Example Page",
    htmlContent: "<html>...</html>",
    source: "direct"
}, "basic");

// AI-powered extraction (requires knowledge extractor)
import { conversation as kpLib } from "knowledge-processor";
import { openai as ai } from "aiclient";

const languageModel = ai.createChatModel(ai.azureApiSettingsFromEnv(ai.ModelType.Chat));
const knowledgeExtractor = kpLib.createKnowledgeExtractor(languageModel);

const aiExtractor = new ContentExtractor({
    mode: "content",
    knowledgeExtractor
});

const aiResult = await aiExtractor.extract({
    url: "https://example.com/article",
    title: "News Article",
    htmlContent: articleHtml,
    source: "direct"
}, "content");

console.log(aiResult.knowledge.entities); // Extracted entities
console.log(aiResult.qualityMetrics);     // Quality scores
```

### Batch Processing

```typescript
import { BatchProcessor } from "website-memory";

const extractor = new ContentExtractor();
const processor = new BatchProcessor(extractor);

const items = [
    { url: "https://site1.com", title: "Site 1", htmlContent: "...", source: "direct" },
    { url: "https://site2.com", title: "Site 2", htmlContent: "...", source: "direct" }
];

// Process with progress tracking
const results = await processor.processBatch(items, "basic", (progress) => {
    console.log(`Progress: ${progress.percentage}%`);
});
```

### Error Handling

The extraction system uses strict error handling with clear messages:

```typescript
try {
    await extractor.extract(content, "content"); // Requires AI
} catch (error) {
    if (error instanceof AIModelRequiredError) {
        console.log("AI model required for content mode. Use 'basic' mode or configure AI.");
    }
}

// Check capabilities before extraction
if (extractor.isConfiguredForMode("content")) {
    const result = await extractor.extract(content, "content");
} else {
    const result = await extractor.extract(content, "basic");
}
```

## Traditional Website Collection Usage

### Basic Import

```typescript
import { WebsiteCollection, importWebsites } from "website-memory";

// Import Chrome bookmarks
const websites = await importWebsites(
  "chrome",
  "bookmarks",
  "/path/to/bookmarks",
);

const collection = new WebsiteCollection();
collection.addWebsites(websites);
await collection.buildIndex();
```

### Enhanced Import with Knowledge Extraction

```typescript
import { enhancedImport } from "website-memory";

// Import with AI-powered knowledge extraction
const websites = await enhancedImport(
    "chrome",
    "bookmarks", 
    "/path/to/bookmarks",
    { mode: "content", knowledgeExtractor }
);

// Import with basic extraction (no AI)
const basicWebsites = await enhancedImport(
    "chrome",
    "bookmarks",
    "/path/to/bookmarks", 
    { mode: "basic" }
);
```

### Querying

```typescript
// Get most visited domains
const topDomains = collection.getMostVisitedDomains(10);

// Get websites by category
const newsWebsites = collection.getWebsitesByCategory("news");

// Get bookmarks in a specific folder
const workBookmarks = collection.getBookmarksByFolder("Work");

// Search with knowledge
const searchResults = await collection.searchWithKnowledge("machine learning");
```

## Browser Agent Integration

The website-memory extraction system integrates seamlessly with the browser agent:

```typescript
import { BrowserKnowledgeExtractor } from "@typeagent/agents-browser";

// Browser agent automatically uses website-memory for extraction
const extractor = new BrowserKnowledgeExtractor(sessionContext);

// Extract knowledge from current page
const result = await extractor.extractKnowledge(pageContent, "content");

// Batch process browsing history
const history = await getBrowsingHistory();
const results = await extractor.extractBatch(history, "basic", progressCallback);
```

## API Reference

### ContentExtractor

The main extraction class with unified mode-based API:

```typescript
class ContentExtractor {
    constructor(config?: ExtractionConfig & { knowledgeExtractor?: KnowledgeExtractor })
    
    // Main extraction method
    async extract(content: ExtractionInput, mode: ExtractionMode): Promise<ExtractionResult>
    
    // Capability checking
    isConfiguredForMode(mode: ExtractionMode): boolean
    getModeCapabilities(mode: ExtractionMode): ModeCapabilities
    
    // Legacy compatibility methods
    async extractContent(url: string, options?: any): Promise<PageContent>
    async extractFromHtml(html: string, url: string): Promise<PageContent>
}
```

### BatchProcessor

Efficient concurrent processing:

```typescript
class BatchProcessor {
    constructor(extractor: ContentExtractor)
    
    async processBatch(
        items: ExtractionInput[], 
        mode: ExtractionMode,
        progressCallback?: (progress: BatchProgress) => void
    ): Promise<ExtractionResult[]>
    
    getErrors(): BatchError[]
    getSuccessCount(): number
}
```

### Types

Key interfaces for extraction:

```typescript
interface ExtractionInput {
    url: string;
    title: string;
    htmlContent?: string;
    textContent?: string;
    source: "direct" | "index" | "bookmark" | "history" | "import";
}

interface ExtractionResult {
    knowledge: KnowledgeResponse;
    qualityMetrics: ExtractionQualityMetrics;
    extractionMode: ExtractionMode;
    aiProcessingUsed: boolean;
    processingTime: number;
    // ... additional fields
}
```

## Migration Guide

### From Old Browser Agent Unified System

```typescript
// OLD (browser agent unified package)
import { UnifiedKnowledgeExtractor } from "../unified/unifiedExtractor.mjs";
const extractor = new UnifiedKnowledgeExtractor(config);
const result = await extractor.extractWithKnowledge(content, "content", "hybrid");

// NEW (website-memory)
import { ContentExtractor } from "website-memory";
const extractor = new ContentExtractor({ mode: "content", knowledgeExtractor });
const result = await extractor.extract(content, "content"); // Mode automatically determines strategy
```

### From Old Website-Memory API

```typescript
// OLD
const extractor = new ContentExtractor({ enableKnowledgeExtraction: true });
const content = await extractor.extractContent(url);

// NEW (backward compatible)
const extractor = new ContentExtractor(); // Still works
const content = await extractor.extractContent(url); // Still works

// NEW (recommended)
const extractor = new ContentExtractor({ mode: "content", knowledgeExtractor });
const result = await extractor.extract(input, "content");
```

## Configuration

### Extraction Configuration

```typescript
interface ExtractionConfig {
    mode: ExtractionMode;
    timeout?: number;
    maxContentLength?: number;
    maxCharsPerChunk?: number;
    maxConcurrentExtractions?: number;
    qualityThreshold?: number;
}
```

### AI Model Setup

```typescript
import { openai as ai } from "aiclient";
import { conversation as kpLib } from "knowledge-processor";

// Configure AI model
const apiSettings = ai.azureApiSettingsFromEnv(ai.ModelType.Chat);
const languageModel = ai.createChatModel(apiSettings);
const knowledgeExtractor = kpLib.createKnowledgeExtractor(languageModel);

// Use with extractor
const extractor = new ContentExtractor({
    mode: "content",
    knowledgeExtractor
});
```

## Best Practices

1. **Mode Selection**: Use `basic` for fast, non-AI extraction. Use `content`/`actions`/`full` when AI analysis is needed.

2. **Error Handling**: Always handle `AIModelRequiredError` and provide fallback to `basic` mode.

3. **Batch Processing**: Use `BatchProcessor` for multiple items to benefit from concurrency.

4. **Performance**: Monitor processing times and adjust `maxConcurrentExtractions` based on system resources.

5. **Capability Checking**: Use `isConfiguredForMode()` to check AI availability before extraction.

## Troubleshooting

### AI Model Not Available

```typescript
// Check if AI is configured
if (!extractor.isConfiguredForMode("content")) {
    console.warn("AI not available, falling back to basic mode");
    result = await extractor.extract(content, "basic");
}
```

### Performance Issues

- Reduce `maxConcurrentExtractions` for memory-constrained environments
- Use `basic` mode for bulk processing when AI analysis isn't needed
- Monitor `qualityMetrics.extractionTime` to identify slow content

### Memory Usage

- Process large batches in smaller chunks
- Monitor memory usage with batch processing

## License

MIT License - see LICENSE file for details.
