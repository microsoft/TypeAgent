<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=4b245f567b7a9306d75423f4f2c79a952e601c745445b9e91281f77a64482be2 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# textpro — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `textpro` package is a TypeScript library for parsing, converting, and manipulating text data and documents. It is designed to use markdown as an intermediate format, enabling the conversion of other formats, such as HTML, into markdown for further processing. The library is used in other parts of the system, such as `conversation-memory`, to import and process HTML and markdown documents.

## What it does

`textpro` provides a set of utilities for working with text and document formats, focusing on converting and analyzing markdown and HTML. Its primary capabilities include:

- **HTML to Markdown Conversion**: Functions like `htmlToMarkdown` convert HTML documents into markdown format, simplifying the structure and removing unnecessary elements.
- **HTML Simplification**: The `htmlSimplify` function cleans up HTML by removing extraneous nodes (e.g., scripts, styles) and attributes, flattening nested structures, and normalizing whitespace.
- **Text Extraction**: The `htmlToText` function extracts raw text from HTML, focusing on useful nodes and cleaning up whitespace.
- **Markdown Parsing and Tokenization**: The `markdownTokenize` function parses markdown into a tokenized structure using the `marked` library, enabling further analysis and manipulation.
- **Markdown Chunking**: The `splitIntoParagraphs` function divides markdown text into smaller, manageable chunks such as paragraphs, lists, or tables. This is useful for processing large documents or extracting specific sections.

These features make `textpro` a versatile tool for handling text data, particularly in workflows that involve converting and analyzing structured documents.

## Setup

To use the `textpro` package, you need to install its dependencies. The package relies on the following external libraries:

- `cheerio`: For parsing and manipulating HTML.
- `marked`: For parsing and tokenizing markdown.

Install the dependencies using `pnpm`:

```sh
pnpm install cheerio marked
```

For additional setup details, refer to the hand-written README.

## Key Files

The `textpro` package is organized into several key files, each responsible for specific functionality:

- [index.ts](./src/index.ts): Serves as the main entry point, exporting functions from `markdown.ts` and `html.ts`.
- [common.ts](./src/common.ts): Contains utility functions, such as `escapeMarkdownText`, which escapes special characters in markdown text.
- [html.ts](./src/html.ts): Focuses on HTML processing, including functions for converting HTML to text (`htmlToText`), simplifying HTML (`htmlSimplify`), and converting HTML to markdown (`htmlToMarkdown`).
- [markdown.ts](./src/markdown.ts): Handles markdown-specific operations, such as parsing markdown into tokens (`markdownTokenize`) and splitting markdown into smaller chunks (`splitIntoParagraphs`).

### Key Components

1. **HTML Processing**:

   - The [html.ts](./src/html.ts) file provides functions for working with HTML content:
     - `htmlToText`: Extracts plain text from HTML while cleaning up unnecessary elements and whitespace.
     - `htmlSimplify`: Simplifies HTML by removing non-essential nodes and attributes.
     - `htmlToMarkdown`: Converts HTML content into markdown format for further processing.

2. **Markdown Processing**:

   - The [markdown.ts](./src/markdown.ts) file focuses on markdown parsing and analysis:
     - `markdownTokenize`: Uses the `marked` library to parse markdown into a tokenized structure.
     - `splitIntoParagraphs`: Divides markdown text into smaller, logical chunks such as paragraphs, lists, and tables.

3. **Utility Functions**:
   - The [common.ts](./src/common.ts) file includes helper functions like `escapeMarkdownText`, which ensures that special characters in markdown are properly escaped.

## How to extend

To extend the `textpro` package, follow these steps:

1. **Identify the area to extend**:

   - Determine whether you need to add new functionality for HTML processing, markdown processing, or utility functions.

2. **Locate the relevant file**:

   - For HTML-related features, work in [html.ts](./src/html.ts).
   - For markdown-related features, work in [markdown.ts](./src/markdown.ts).
   - For general-purpose utilities, use [common.ts](./src/common.ts).

3. **Implement your changes**:

   - Follow the existing code patterns and structure to ensure consistency.
   - For example, if adding a new HTML processing function, consider using the `cheerio` library as demonstrated in [html.ts](./src/html.ts).

4. **Write tests**:

   - Add unit tests for your new functionality. Place these tests in the appropriate test file or create a new one in the `tests` directory.

5. **Run tests**:
   - Use a testing framework like Jest or Mocha to verify that your changes work as expected and do not introduce regressions.

By adhering to these guidelines, you can effectively contribute to the `textpro` package and enhance its capabilities.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [knowledge-processor](../../packages/knowledgeProcessor/README.md)

External: `cheerio`, `marked`

### Used by

- [browser-typeagent](../../packages/agents/browser/README.md)
- [chat-example](../../examples/chat/README.md)
- [conversation-memory](../../packages/memory/conversation/README.md)

### Files of interest

`./src/index.ts`, `./src/common.ts`, `./src/html.ts`, …and 2 more under `./src/`.

---

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter textpro docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
