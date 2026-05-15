<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=95ccf4eb04c11d5beb2e6bf244775ae0aebcba42d6f89009c5f2904d218421b3 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# image-memory â€” AI-generated documentation

> ðŸ¤– **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h â€” see the staleness footer at the end of this file.

## Overview

The `image-memory` package is an experimental TypeScript library designed to implement image memory using structured Retrieval-Augmented Generation (RAG). It leverages the `KnowPro` library to create an image collection that can be queried based on both knowledge content and metadata. This package is part of the TypeAgent monorepo and integrates with several other packages to provide its functionality.

## What it does

The `image-memory` package provides the capability to index and query images using natural language. It supports actions such as `importImages` to index images from a specified path and `indexingService` to start an indexing service for images. The package allows images to be searched based on their content and metadata, making it possible to ask questions and get answers about the images in natural language.

Key actions include:

- `importImages`: Indexes images from a specified path.
- `indexingService`: Starts an indexing service for images.

These actions enable users to build and maintain a searchable image collection, leveraging natural language processing to enhance the querying capabilities.

## Setup

To set up the `image-memory` package, ensure you have the necessary dependencies installed. The package relies on several internal and external dependencies, including `@azure-rest/maps-search`, `better-sqlite3`, `debug`, `get-folder-size`, and `typechat`.

Environment variables:

- `DEBUG`: Set this variable to enable debug logging.

For detailed setup instructions, including how to obtain API keys and configure environment variables, refer to the hand-written README.

## Key Files
The `image-memory` package is structured into several key files, each responsible for different aspects of the functionality:

- [index.ts](./src/index.ts): The entry point that exports various modules.
- [imageCollection.ts](./src/imageCollection.ts): Defines the `ImageCollection` class, which represents a collection of images and provides methods for indexing and querying.
- [imageMeta.ts](./src/imageMeta.ts): Defines the `Image` and `ImageMeta` classes, which represent individual images and their metadata.
- [importImages.ts](./src/importImages.ts): Provides the `importImages` function to index images from a specified path.
- [indexingService.ts](./src/indexingService.ts): Starts an indexing service for images.
- [tables.ts](./src/tables.ts): Defines database tables for storing image metadata.

### Detailed File Responsibilities

- **[index.ts](./src/index.ts)**: Serves as the main entry point, exporting functions and classes from other modules.
- **[imageCollection.ts](./src/imageCollection.ts)**: Contains the `ImageCollection` class, which manages a collection of images, including methods for adding images and querying them.
- **[imageMeta.ts](./src/imageMeta.ts)**: Defines the structure for image metadata and individual image objects, including methods for extracting knowledge from images.
- **[importImages.ts](./src/importImages.ts)**: Implements the `importImages` function, which indexes images from a specified path and returns an `ImageCollection`.
- **[indexingService.ts](./src/indexingService.ts)**: Provides functionality to start and manage an indexing service for images, including monitoring changes in the indexed folder.
- **[tables.ts](./src/tables.ts)**: Defines the `GeoTable` and `ExposureTable` classes for storing geographic and exposure metadata of images in a SQLite database.

## How to extend

To extend the `image-memory` package, follow these steps:

1. **Open the relevant file**: Depending on the functionality you want to add or modify, open the appropriate file. For example, to add new indexing capabilities, start with [indexingService.ts](./src/indexingService.ts).

2. **Follow existing patterns**: Review the existing code to understand the patterns used for indexing and querying images. For example, the `ImageCollection` class in [imageCollection.ts](./src/imageCollection.ts) provides a good example of how to structure a collection of images.

3. **Add new functionality**: Implement the new functionality by extending the existing classes or adding new ones. Ensure that your code integrates well with the existing structure and follows the established patterns.

4. **Test your changes**: Write tests to verify your changes. Ensure that your new functionality works as expected and does not break existing features.

5. **Run tests**: Execute the tests to validate your changes. Make sure all tests pass before submitting your changes.

By following these steps, you can effectively extend the `image-memory` package to add new features or improve existing ones.

## Reference

> âš™ï¸ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default â†’ [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- [aiclient](../../../packages/aiclient/README.md)
- [knowledge-processor](../../../packages/knowledgeProcessor/README.md)
- [knowpro](../../../packages/knowPro/README.md)
- [memory-storage](../../../packages/memory/storage/README.md)
- [telemetry](../../../packages/telemetry/README.md)
- [typeagent](../../../packages/typeagent/README.md)
- [typechat-utils](../../../packages/utils/typechatUtils/README.md)

External: `@azure-rest/maps-search`, `better-sqlite3`, `debug`, `get-folder-size`, `typechat`

### Used by

- [agent-dispatcher](../../../packages/dispatcher/dispatcher/README.md)
- [chat-example](../../../examples/chat/README.md)
- [montage-agent](../../../packages/agents/montage/README.md)
- [telemetry-query-example](../../../examples/commandHistogram/README.md)

### Files of interest

`./src/index.ts`, `./src/imageCollection.ts`, `./src/imageMeta.ts`, â€¦and 4 more under `./src/`.

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.874Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter image-memory docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
