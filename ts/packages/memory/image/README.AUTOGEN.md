<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=f414f7f3297989f2faa68c29d4288fabd4da292c35af00dd404f91a5aba7ed92 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# image-memory — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `image-memory` package is an experimental TypeScript library designed to implement image memory using structured Retrieval-Augmented Generation (RAG). It leverages the `KnowPro` library to create an `ImageCollection` that can be queried using natural language. This package is part of the TypeAgent monorepo and integrates with other packages such as `@typeagent/aiclient`, `knowledge-processor`, and `memory-storage` to provide its functionality.

The primary goal of this package is to enable the indexing and querying of images based on their metadata and knowledge content. This allows users to interact with image collections in a more intuitive and natural way, such as asking questions about the images and receiving meaningful answers.

## What it does

The `image-memory` package provides tools to create, manage, and query an image collection. It supports the following key actions:

- **`importImages`**: This action allows users to index images from a specified path. It processes image files, extracts metadata, and stores the information in a structured format for efficient querying.
- **`indexingService`**: This action starts an indexing service for images, enabling continuous monitoring and indexing of a specified folder.

The package uses the `KnowPro` library to extract knowledge from images and their metadata. This knowledge is then stored in a structured format, allowing users to query the image collection using natural language. For example, users can search for images based on specific metadata (e.g., date taken, location) or ask questions about the content of the images.

## Setup

To use the `image-memory` package, follow these setup steps:

1. **Install dependencies**: Ensure that all required dependencies are installed. The package relies on both internal and external dependencies, including:

   - Internal: `@typeagent/aiclient`, `knowledge-processor`, `memory-storage`, and others.
   - External: `@azure-rest/maps-search`, `better-sqlite3`, `debug`, `get-folder-size`, and `typechat`.

2. **Set environment variables**:

   - `DEBUG`: Set this variable to enable debug logging. For example, you can set it to `typeagent:image-memory` to see debug logs specific to this package.

3. **Additional setup**: If you need to use external services (e.g., `@azure-rest/maps-search`), ensure you have the necessary API keys and configurations. Refer to the hand-written README for more details on obtaining and setting up these keys.

Once the setup is complete, you can start using the package to index and query image collections.

## Key Files

The `image-memory` package is organized into several key files, each responsible for specific functionality:

- **[index.ts](./src/index.ts)**: The main entry point of the package, exporting all public modules and functions.
- **[imageCollection.ts](./src/imageCollection.ts)**: Defines the `ImageCollection` class, which represents a collection of images. This class provides methods for adding images, querying them, and managing their metadata.
- **[imageMeta.ts](./src/imageMeta.ts)**: Contains the `Image` and `ImageMeta` classes. These classes define the structure of individual images and their associated metadata, including methods for extracting knowledge from images.
- **[importImages.ts](./src/importImages.ts)**: Implements the `importImages` function, which indexes images from a specified path and returns an `ImageCollection`. This function supports recursive indexing of directories and can handle various image file types.
- **[indexingService.ts](./src/indexingService.ts)**: Provides functionality to start and manage an indexing service for images. This service can monitor a folder for changes and update the image collection accordingly.
- **[tables.ts](./src/tables.ts)**: Defines database tables for storing image metadata, such as geographic and exposure information, using SQLite.

### File Responsibilities

- **[index.ts](./src/index.ts)**: Serves as the central hub for exporting the package's functionality.
- **[imageCollection.ts](./src/imageCollection.ts)**: Manages the core logic for handling image collections, including indexing and querying.
- **[imageMeta.ts](./src/imageMeta.ts)**: Handles the representation and processing of individual images and their metadata.
- **[importImages.ts](./src/importImages.ts)**: Provides the main function for importing and indexing images from a file path or directory.
- **[indexingService.ts](./src/indexingService.ts)**: Implements a service for continuously indexing images in a specified directory.
- **[tables.ts](./src/tables.ts)**: Defines the database schema for storing image metadata, such as geographic coordinates and exposure settings.

## How to extend

To extend the `image-memory` package, follow these steps:

1. **Identify the area to extend**: Determine which part of the package you want to modify or enhance. For example, you might want to add new metadata fields, improve the indexing process, or introduce new querying capabilities.

2. **Start with the relevant file**:

   - For changes related to image collections, begin with [imageCollection.ts](./src/imageCollection.ts).
   - To modify or add metadata handling, work on [imageMeta.ts](./src/imageMeta.ts).
   - For changes to the indexing process, focus on [importImages.ts](./src/importImages.ts) or [indexingService.ts](./src/indexingService.ts).

3. **Follow existing patterns**: Review the existing code to understand the structure and design patterns used. For example, the `ImageCollection` class demonstrates how to manage a collection of images, while the `importImages` function shows how to process and index images.

4. **Implement your changes**: Add new functionality or modify existing code as needed. Ensure that your changes are consistent with the overall design of the package.

5. **Write tests**: Create tests to verify the functionality of your changes. Use the existing test cases as a reference for writing new ones.

6. **Run tests**: Execute the tests to ensure that your changes work as expected and do not introduce any regressions.

By following these steps, you can effectively contribute to the `image-memory` package and enhance its capabilities.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-04T08:54:09.388Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter image-memory docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
