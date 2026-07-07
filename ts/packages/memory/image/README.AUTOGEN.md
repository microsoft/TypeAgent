<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=f414f7f3297989f2faa68c29d4288fabd4da292c35af00dd404f91a5aba7ed92 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# image-memory — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `image-memory` package is an experimental TypeScript library designed to implement image memory using structured Retrieval-Augmented Generation (RAG). It leverages the `KnowPro` library to create an image collection that can be queried based on both knowledge content and metadata. This package is part of the TypeAgent monorepo and integrates with several other packages to provide its functionality.

## What it does

The `image-memory` package enables indexing and querying of images using natural language. It supports actions such as `importImages` to index images from a specified path and `indexingService` to start an indexing service for images. These capabilities allow users to create and manage a searchable image collection, where images can be queried based on their content and metadata.

Key actions include:

- `importImages`: Indexes images from a specified path, creating an `ImageCollection` that can be queried.
- `indexingService`: Starts a service to index images and monitor changes in the indexed folder.

By combining these features with the `KnowPro` library, the package allows users to ask natural language questions about the images and retrieve relevant results based on the knowledge extracted from the images and their metadata.

## Setup

To use the `image-memory` package, ensure the following setup steps are completed:

1. **Install dependencies**: The package relies on several internal and external dependencies, including `@azure-rest/maps-search`, `better-sqlite3`, `debug`, `get-folder-size`, and `typechat`. These dependencies will be installed automatically when you run `pnpm install` in the monorepo.

2. **Environment variables**:
   - `DEBUG`: Set this variable to enable debug logging for development and troubleshooting purposes.

For additional setup details, including any required API keys or external service configurations, refer to the hand-written README.

## Key Files

The `image-memory` package is organized into several key files, each responsible for specific functionality:

- [index.ts](./src/index.ts): The main entry point of the package, exporting all public modules and functions.
- [imageCollection.ts](./src/imageCollection.ts): Defines the `ImageCollection` class, which represents a collection of images and provides methods for indexing and querying.
- [imageMeta.ts](./src/imageMeta.ts): Contains the `Image` and `ImageMeta` classes, which represent individual images and their associated metadata.
- [importImages.ts](./src/importImages.ts): Implements the `importImages` function, which indexes images from a specified path and returns an `ImageCollection`.
- [indexingService.ts](./src/indexingService.ts): Provides functionality to start and manage an indexing service for images, including monitoring changes in the indexed folder.
- [tables.ts](./src/tables.ts): Defines database tables for storing image metadata, such as geographic and exposure information.

### Detailed File Responsibilities

- **[index.ts](./src/index.ts)**: Serves as the central export point for the package, aggregating and exposing functionality from other modules.
- **[imageCollection.ts](./src/imageCollection.ts)**: Implements the `ImageCollection` class, which manages a collection of images. It includes methods for adding images, querying them, and integrating with the `KnowPro` library for knowledge extraction.
- **[imageMeta.ts](./src/imageMeta.ts)**: Defines the structure for image metadata and individual image objects. The `ImageMeta` class includes methods for extracting knowledge from images, while the `Image` class represents an individual image with associated metadata.
- **[importImages.ts](./src/importImages.ts)**: Provides the `importImages` function, which allows users to index images from a specified directory or file path. This function supports recursive indexing and can handle callbacks for progress updates.
- **[indexingService.ts](./src/indexingService.ts)**: Implements an indexing service that can monitor a folder for changes and update the image collection dynamically. It also tracks metadata about the indexing process, such as progress and state.
- **[tables.ts](./src/tables.ts)**: Defines the `GeoTable` and `ExposureTable` classes, which are used to store geographic and exposure metadata for images in a SQLite database.

## How to extend

To extend the `image-memory` package, follow these steps:

1. **Identify the area to extend**: Determine which functionality you want to add or modify. For example, if you want to enhance the indexing process, you might start with [indexingService.ts](./src/indexingService.ts).

2. **Review existing patterns**: Study the existing codebase to understand the structure and patterns used. For instance, the `ImageCollection` class in [imageCollection.ts](./src/imageCollection.ts) provides a clear example of how to manage and query image collections.

3. **Implement new features**: Add your new functionality by extending existing classes or creating new ones. Ensure your changes align with the existing architecture and coding standards.

4. **Update tests**: Write new tests or update existing ones to cover your changes. This ensures that your modifications work as intended and do not introduce regressions.

5. **Run tests**: Execute the test suite to validate your changes. Ensure all tests pass before submitting your work.

By following these steps, you can effectively contribute to the `image-memory` package and expand its capabilities.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-06T09:20:03.630Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter image-memory docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
