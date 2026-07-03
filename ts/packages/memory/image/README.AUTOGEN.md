<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=f414f7f3297989f2faa68c29d4288fabd4da292c35af00dd404f91a5aba7ed92 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# image-memory — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `image-memory` package is an experimental TypeScript library designed to implement image memory using structured Retrieval-Augmented Generation (RAG). It leverages the `KnowPro` library to create an `ImageCollection` that can be queried using natural language. This package is part of the TypeAgent monorepo and integrates with other packages such as `@typeagent/aiclient`, `knowledge-processor`, and `memory-storage` to provide its functionality.

## What it does

The primary purpose of the `image-memory` package is to enable the indexing and querying of images based on their metadata and knowledge content. This allows users to interact with an image collection using natural language queries, making it easier to retrieve relevant images and associated information.

### Key Features

- **Image Indexing**: The `importImages` action allows users to index images from a specified path. This process extracts metadata and knowledge from the images and stores them in a structured format.
- **Indexing Service**: The `indexingService` action starts a service to monitor and index images in a specified folder. This service can handle changes in the folder, such as the addition of new images.
- **Natural Language Querying**: Users can query the indexed images using natural language to retrieve relevant results based on the images' metadata and knowledge content.

These features make the `image-memory` package a foundational component for building applications that require intelligent image search and retrieval capabilities.

## Setup

To use the `image-memory` package, follow these steps:

1. **Install Dependencies**: Ensure that all required dependencies are installed. The package relies on both internal and external dependencies, including:

   - Internal: `@typeagent/aiclient`, `knowledge-processor`, `knowPro`, `memory-storage`, `telemetry`, `typeagent`, `typechat-utils`
   - External: `@azure-rest/maps-search`, `better-sqlite3`, `debug`, `get-folder-size`, `typechat`

2. **Environment Variables**:

   - `DEBUG`: Set this environment variable to enable debug logging. For example, you can set it to `typeagent:image-memory` to see debug logs specific to this package.

3. **Additional Configuration**:
   - If you are using the `indexingService` action, ensure that the folder you want to index is accessible and contains the images you wish to process.

For more detailed setup instructions, including how to obtain API keys for external dependencies, refer to the hand-written README.

## Key Files

The `image-memory` package is organized into several key files, each responsible for specific functionality:

- **[index.ts](./src/index.ts)**: The main entry point of the package, exporting all public modules and functions.
- **[imageCollection.ts](./src/imageCollection.ts)**: Defines the `ImageCollection` class, which serves as the core data structure for managing and querying images.
- **[imageMeta.ts](./src/imageMeta.ts)**: Contains the `Image` and `ImageMeta` classes, which represent individual images and their associated metadata.
- **[importImages.ts](./src/importImages.ts)**: Implements the `importImages` function, which indexes images from a specified path and returns an `ImageCollection`.
- **[indexingService.ts](./src/indexingService.ts)**: Provides functionality to start and manage an indexing service for images, including monitoring changes in the indexed folder.
- **[tables.ts](./src/tables.ts)**: Defines database tables for storing image metadata, such as geographic and exposure information.

### File Responsibilities

1. **[index.ts](./src/index.ts)**:

   - Serves as the main entry point for the package.
   - Exports key functions and classes, including `importImages`, `indexingService`, `ImageCollection`, and database table definitions.

2. **[imageCollection.ts](./src/imageCollection.ts)**:

   - Implements the `ImageCollection` class, which manages a collection of images.
   - Provides methods for adding images, querying them, and managing their metadata.

3. **[imageMeta.ts](./src/imageMeta.ts)**:

   - Defines the `Image` class, which represents an individual image and its associated metadata.
   - Implements methods for extracting knowledge from images and managing metadata.

4. **[importImages.ts](./src/importImages.ts)**:

   - Provides the `importImages` function, which allows users to index images from a specified path.
   - Supports recursive indexing of directories and handles metadata extraction.

5. **[indexingService.ts](./src/indexingService.ts)**:

   - Starts an indexing service for images, enabling continuous monitoring and indexing of a specified folder.
   - Tracks the state of the indexing process and provides progress updates.

6. **[tables.ts](./src/tables.ts)**:
   - Defines the `GeoTable` and `ExposureTable` classes for storing geographic and exposure metadata of images in a SQLite database.

## How to extend

To extend the `image-memory` package, follow these guidelines:

1. **Understand the Existing Codebase**:

   - Start by reviewing the key files, especially [imageCollection.ts](./src/imageCollection.ts) and [imageMeta.ts](./src/imageMeta.ts), to understand how images and their metadata are managed.

2. **Add New Features**:

   - To add new functionality, such as additional metadata extraction or new querying capabilities, consider extending the `ImageCollection` or `ImageMeta` classes.
   - For example, you can add new methods to `ImageCollection` to support advanced search features or integrate additional metadata fields in `ImageMeta`.

3. **Modify the Indexing Service**:

   - If you need to enhance the indexing service, start with [indexingService.ts](./src/indexingService.ts). You can add support for new data sources or improve the monitoring capabilities.

4. **Update Database Schema**:

   - If your changes require new database tables or modifications to existing ones, update [tables.ts](./src/tables.ts) accordingly. Ensure that your changes are backward-compatible and well-documented.

5. **Write Tests**:

   - Add unit tests for your new functionality to ensure it works as expected. Use the existing test cases as a reference for writing your tests.

6. **Run Tests**:
   - Execute the test suite to verify that your changes do not introduce any regressions. Address any issues before submitting your changes.

By following these steps, you can contribute to the `image-memory` package effectively and ensure that your changes align with the existing codebase and project goals.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/aiclient](../../../packages/aiclient/README.md)
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

`./src/index.ts`, `./src/imageCollection.ts`, `./src/imageMeta.ts`, …and 4 more under `./src/`.

---

_Auto-generated against commit `88f04471002e27f82ae1ddf73a7ae8acdfe09b5d` on `2026-07-03T09:02:51.801Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter image-memory docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
