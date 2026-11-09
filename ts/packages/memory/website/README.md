# Website Memory

Browser-data import helpers and page content extraction used by the browser
agent. This package **does not store, index or search** anything. Website
memory lives in the durable memory service (`@typeagent/memory-service`); the
browser agent submits normalized page content to it and the service performs
chunking, knowledge extraction and KnowPro indexing.

## What this package provides

| Export                                                              | Purpose                                                                                                   |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `importWebsites`, `importChromeBookmarks`, `getDefaultBrowserPaths` | Enumerate Chrome and Edge bookmarks and history                                                           |
| `Website`, `WebsiteMeta`, `WebsiteVisitInfo`, `importWebsiteVisit`  | In-memory records for an imported visit                                                                   |
| `HtmlFetcher`                                                       | Fetch page HTML for an imported URL                                                                       |
| `ContentExtractor` and the extraction types                         | Convert fetched HTML into page content (text, metadata, links, images, structured data) before submission |

Enumerating bookmarks or history is not indexing. An imported URL becomes
searchable only after the browser agent fetches its content and submits it to
the durable service, which always uses the single model-driven `content`
pipeline.

## Removed

The following were removed on 2026-10-01 because the durable service replaced
them (see `docs/architecture/memory/`):

- `WebsiteCollection`, its SQLite tables and data frames, and its search.
- The topic/entity graph builders and graph queries (the browser reads
  entities, topics and relationships from the service).
- The standalone indexing service and `@index create website`.
- The batch processor.

Existing website indexes created with the old `@index` command are not read.
Re-import the pages with the browser extension.

## Extraction modes

`ContentExtractor` still accepts an `ExtractionMode` (`basic`, `summary`,
`content`, `full`). These modes only control how much the extractor does with a
fetched page. They are not memory indexing modes, and none of them selects a
search engine. `basic` is used to read URL and title when enumerating browser
data.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
