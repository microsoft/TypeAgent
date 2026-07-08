<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=8ec8e95511b84ab88a7eb89a5b43a201559ff0d712324928783352f09a56b94e -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# image-memory — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `image-memory` package is an experimental TypeScript library designed to implement image memory using structured Retrieval-Augmented Generation (RAG). It leverages the `KnowPro` library to create an `ImageCollection` that can be queried using natural language. This package is part of the TypeAgent monorepo and integrates with other packages such as `@typeagent/aiclient`, `knowledge-processor`, and `memory-storage` to provide its functionality.

## What it does

The primary goal of the `image-memory` package is to enable the indexing and querying of images based on their metadata and knowledge content. It provides tools to create an `ImageCollection` that can be populated with images and queried using natural language. The package supports the following key actions:

- **`importImages`**: This action allows users to index images from a specified directory or file path. The images are processed to extract metadata and knowledge, which are then stored in an `ImageCollection`.
- **`indexingService`**: This action starts a service to monitor a folder for changes and dynamically updates the indexed image collection. It also tracks metadata about the indexing process, such as progress and state.

By combining these actions with the `KnowPro` library, the package enables users to ask natural language questions about the images and retrieve relevant results. For example, users can search for images based on their content, metadata, or both.

## Setup

To use the `image-memory` package, follow these steps:

1. **Install dependencies**: Run `pnpm install` in the monorepo root to install all required dependencies. The package depends on both internal and external libraries, including:

   - Internal: `@typeagent/aiclient`, `knowledge-processor`, `knowPro`, `memory-storage`, `telemetry`, `typeagent`, and `typechat-utils`.
   - External: `@azure-rest/maps-search`, `better-sqlite3`, `debug`, `get-folder-size`, and `typechat`.

2. **Set environment variables**:
   - `DEBUG`: Set this variable to enable debug logging for development and troubleshooting purposes.

For additional setup details, refer to the hand-written README.

## Key Files

The `image-memory` package is organized into several key files, each responsible for specific functionality:

- **[index.ts](./src/index.ts)**: The main entry point of the package, exporting all public modules and functions.
- **[imageCollection.ts](./src/imageCollection.ts)**: Defines the `ImageCollection` class, which represents a collection of images and provides methods for indexing and querying.
- **[imageMeta.ts](./src/imageMeta.ts)**: Contains the `Image` and `ImageMeta` classes, which represent individual images and their associated metadata.
- **[importImages.ts](./src/importImages.ts)**: Implements the `importImages` function, which indexes images from a specified path and returns an `ImageCollection`.
- **[indexingService.ts](./src/indexingService.ts)**: Provides functionality to start and manage an indexing service for images, including monitoring changes in the indexed folder.
- **[tables.ts](./src/tables.ts)**: Defines database tables for storing image metadata, such as geographic and exposure information.

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

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter image-memory docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
