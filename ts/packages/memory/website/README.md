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

## Testing

The package includes comprehensive Jest tests:

```bash
# Run all tests
npm test

# Run offline tests only (no API keys required)
npm run test:offline  

# Run online tests only (requires API keys)
npm run test:online
```

### Test Categories
- **Collection Tests**: WebsiteCollection functionality
- **Import Tests**: Browser data import capabilities  
- **DataFrame Tests**: SQL storage and queries
- **Indexing Tests**: Semantic indexing and search

See `test/README.md` for detailed test documentation.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
