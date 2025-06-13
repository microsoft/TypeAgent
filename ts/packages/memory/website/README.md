# Website Memory

A structured RAG implementation for website visit memory, including bookmarks and browsing history.

## Features

- Import bookmarks and browsing history from Chrome and Edge
- Semantic search over website content and metadata
- Structured data frames for visit frequency, categories, and bookmark organization
- Background indexing service for real-time updates
- Entity extraction for URLs, domains, and website categories

## Usage

### Basic Import

```typescript
import { WebsiteCollection, importWebsites } from "website-memory";

// Import Chrome bookmarks
const websites = await importWebsites(
    "chrome", 
    "bookmarks", 
    "/path/to/bookmarks"
);

const collection = new WebsiteCollection();
collection.addWebsites(websites);
await collection.buildIndex();
```

### Querying

```typescript
// Get most visited domains
const topDomains = collection.getMostVisitedDomains(10);

// Get websites by category
const newsWebsites = collection.getWebsitesByCategory("news");

// Get bookmarks in a specific folder
const workBookmarks = collection.getBookmarksByFolder("Work");
```

### Indexing Service

The indexing service runs in the background and can be managed through the IndexManager:

```typescript
import { IndexManager } from "dispatcher";

// Create a website index
await IndexManager.getInstance().createIndex(
    "my-websites", 
    "website", 
    "/path/to/browser/data"
);
```

## Supported Browsers

- **Chrome**: Bookmarks and history
- **Edge**: History (bookmarks support coming soon)

## Data Structures

### Website Visit Info
- URL and title
- Domain and page type classification
- Visit frequency and timestamps
- Bookmark folder organization
- Source tracking (bookmark vs history)

### Data Frames
- **Visit Frequency**: Track domain popularity
- **Website Categories**: Automatic categorization (news, development, etc.)
- **Bookmark Folders**: Hierarchical bookmark organization

## Integration

This package integrates with:
- **Knowledge Processor**: For semantic indexing and search
- **Dispatcher**: For background indexing service management
- **TypeAgent**: For conversational queries over website data
