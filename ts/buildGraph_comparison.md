# BuildGraph Implementation Comparison

## Overview
This document compares two different approaches to building knowledge graphs in the TypeAgent system:

1. **`websiteCollection.buildGraph()`** - SQLite-based approach (original)
2. **`jsonStorage.manager.buildGraph()`** - JSON storage approach (current issue)

## Current Issue
The current `buildKnowledgeGraph()` function in `graphActions.mts` is attempting to call `jsonStorage.manager.buildGraph()`, but **this method does not exist** in `GraphJsonStorageManager`. This is causing build failures.

## 1. websiteCollection.buildGraph() - SQLite Approach

### Location
`packages/memory/website/src/websiteCollection.ts` lines 1635+

### What it does
- **Full graph construction** from website data stored in SQLite
- Processes websites → extracts entities → builds relationships → detects communities → creates hierarchical topics
- Stores results directly in SQLite database tables

### Key Steps:
1. **Initialize utilities**: GraphBuildingCacheManager, OptimizedGraphAlgorithms
2. **Cache websites**: Load website data into memory cache for efficient processing
3. **Extract entities**: Get unique entities from cached website data
4. **Store entities**: Save to `knowledgeEntities` SQLite table
5. **Build relationships**: Create entity-to-entity relationships, store in `relationships` table
6. **Detect communities**: Use graph algorithms to find entity clusters, store in `communities` table
7. **Build hierarchical topics**: Process flat topics into hierarchical structure
8. **Build topic graph**: Create topic relationships using Graphology algorithms

### Storage Tables Used:
- `knowledgeEntities` - Individual entities with metadata
- `relationships` - Entity-to-entity connections with confidence scores
- `communities` - Entity groupings/clusters
- `hierarchicalTopics` - Topic hierarchy structure
- `topicRelationships` - Topic-to-topic connections
- `topicMetrics` - Topic analysis metrics

### Performance:
- Optimized with caching for large datasets
- Processes entities in batches
- Uses efficient graph algorithms
- Can handle limited URL sets for testing (`urlLimit` option)

## 2. GraphJsonStorageManager - JSON Storage Approach

### Location
`packages/memory/website/src/storage/graphJsonStorage.ts`

### What it provides
- **File-based JSON storage** for pre-built graph data
- Load/save operations for EntityGraph and TopicGraph JSON structures
- Backup and metadata management

### Available Methods:
- `saveEntityGraph(graph: EntityGraphJson)` - Save entity graph to JSON file
- `loadEntityGraph()` - Load entity graph from JSON file
- `saveTopicGraph(graph: TopicGraphJson)` - Save topic graph to JSON file  
- `loadTopicGraph()` - Load topic graph from JSON file
- `getStorageMetadata()` - Get file metadata
- `hasJsonGraphs()` - Check if JSON files exist
- `createBackup()` - Create backup of existing files
- `cleanupOldBackups()` - Manage backup retention

### **Missing Method**: 
- ❌ `buildGraph()` - **THIS METHOD DOES NOT EXIST**

### Purpose:
- Storage and retrieval of **already-built** graph data
- Migration destination from SQLite to JSON format
- Fast loading of pre-computed graph structures

## Key Differences

| Aspect | websiteCollection.buildGraph() | GraphJsonStorageManager |
|--------|--------------------------------|------------------------|
| **Purpose** | Build graph from raw data | Store/load pre-built graphs |
| **Data Source** | Website content + existing entities | JSON files |
| **Storage** | SQLite database tables | JSON files |
| **Performance** | Computationally intensive | Fast file I/O |
| **Use Case** | Initial construction, rebuilds | Caching, migration target |
| **Graph Building** | ✅ Full pipeline | ❌ No building capability |

## Correct Implementation Strategy

### For `buildKnowledgeGraph()`:
1. **Use `websiteCollection.buildGraph()`** - This actually builds the graph
2. **Optionally convert to JSON** - Use SqliteToJsonConverter to create JSON files
3. **Save via GraphJsonStorageManager** - Store converted results

### For `rebuildKnowledgeGraph()`:
1. **Clear existing data** - Reset SQLite tables AND delete JSON files
2. **Use `websiteCollection.buildGraph()`** - Rebuild from scratch
3. **Convert and save** - Update JSON storage with new results

## Recommended Fix

The current `buildKnowledgeGraph()` function should:

```typescript
// WRONG - this method doesn't exist
await jsonStorage.manager.buildGraph();

// CORRECT - use websiteCollection for actual building
await websiteCollection.buildGraph();

// THEN optionally save to JSON format
const converter = new SqliteToJsonConverter(websiteCollection);
const entityGraph = await converter.convertEntityGraph();
const topicGraph = await converter.convertTopicGraph();
await jsonStorage.manager.saveEntityGraph(entityGraph);
await jsonStorage.manager.saveTopicGraph(topicGraph);
```

## Migration Strategy

1. **Build phase**: Use websiteCollection.buildGraph() for actual graph construction
2. **Storage phase**: Convert SQLite results to JSON using SqliteToJsonConverter  
3. **Load phase**: Use GraphJsonStorageManager for fast access to pre-built graphs
4. **Rebuild phase**: Clear both SQLite and JSON, then rebuild from websites

This creates a hybrid approach where SQLite provides the computation engine and JSON provides fast access to results.