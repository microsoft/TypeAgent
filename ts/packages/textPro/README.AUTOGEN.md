<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=8a6b6c446d3f4bd4d24c671f8be0de459b7c4737be83c04ae5882bc0ba10c811 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# textpro — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `textpro` package is a TypeScript library designed for parsing, converting, and manipulating text data and documents. It primarily uses markdown as an intermediate format, converting other formats like HTML into markdown for further processing. The library is utilized by other packages such as `conversation-memory` to import HTML and markdown documents.

## What it does

`textpro` provides functionalities to analyze markdown documents and extract various elements such as headings, lists, tables, links, images, and more. It also infers knowledge like entities, topics, and structured tags from markdown information without relying on large language models (LLMs). The package includes several actions for handling text and document conversion:

- `htmlToText`: Extracts text from HTML, cleaning up whitespace and removing unnecessary nodes.
- `htmlSimplify`: Simplifies HTML by removing nodes not needed for text processing and cleaning up attributes.
- `htmlToMarkdown`: Converts HTML to markdown format.
- `markdownTokenize`: Parses markdown into a token DOM using the "marked" library.
- `splitIntoParagraphs`: Splits markdown text into paragraphs for easier processing.

These actions enable efficient text manipulation and conversion, making `textpro` a versatile tool for handling various text formats.

## Setup

To set up the `textpro` package, ensure you have the necessary dependencies installed. The package relies on external libraries such as `cheerio` and `marked`. You can install these dependencies using `pnpm`:

```sh
pnpm install cheerio marked
```

For detailed setup instructions, refer to the hand-written README.

## Key Files

The `textpro` package is organized into several key files, each responsible for different aspects of text manipulation:

- [index.ts](./src/index.ts): Exports the main functionalities from `markdown.ts` and `html.ts`.
- [common.ts](./src/common.ts): Contains utility functions like `escapeMarkdownText` for escaping special characters in markdown text.
- [html.ts](./src/html.ts): Provides functions for converting HTML to text, simplifying HTML, and converting HTML to markdown.
- [markdown.ts](./src/markdown.ts): Handles markdown parsing, tokenization, and chunking.

The package uses the `cheerio` library for HTML manipulation and the `marked` library for markdown parsing.

### Key Components

- **HTML Processing**: The [html.ts](./src/html.ts) file includes functions such as `htmlToText`, `htmlSimplify`, and `htmlToMarkdown`. These functions utilize the `cheerio` library to manipulate HTML content, simplify it, and convert it to markdown format.
- **Markdown Processing**: The [markdown.ts](./src/markdown.ts) file includes functions like `markdownTokenize` and `splitIntoParagraphs`. These functions use the `marked` library to parse markdown content and split it into manageable chunks for further processing.
- **Utility Functions**: The [common.ts](./src/common.ts) file provides utility functions such as `escapeMarkdownText`, which helps in escaping special characters in markdown text.

## How to extend

To extend the `textpro` package, follow these steps:

1. **Identify the functionality to extend**: Determine whether you need to add new text manipulation features or enhance existing ones.
2. **Open the relevant file**: Depending on the functionality, open either [html.ts](./src/html.ts) or [markdown.ts](./src/markdown.ts).
3. **Add your code**: Implement the new feature or enhancement. Ensure your code follows the existing patterns and structure.
4. **Write tests**: Add tests for your new functionality to ensure it works as expected. You can create test files in the `tests` directory.
5. **Run tests**: Execute the tests to verify your changes. Use a testing framework like Jest or Mocha.

By following these steps, you can effectively extend the `textpro` package and contribute new features or improvements.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

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

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.874Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter textpro docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
