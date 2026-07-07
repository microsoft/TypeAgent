<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=30e0486670b0c8124ea1be34b4cc3958b2b56d7e33d16516cd18c4a971478c83 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# typechat-utils — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `typechat-utils` package is a TypeScript library that provides a collection of utility functions and classes for the TypeAgent project. These utilities are designed to support various functionalities such as JSON translation, image processing, date and time manipulation, and location-based services. The package is widely used across the TypeAgent monorepo, serving as a foundational component for other packages and agents.

## What it does

The `typechat-utils` package provides a range of utility functions and helpers that are grouped into the following categories:

### JSON Translation

- **Schema-based JSON Translators**: Functions like `createJsonTranslatorFromSchemaDef`, `createJsonTranslatorFromFile`, and `createJsonTranslatorWithValidator` enable the creation of JSON translators from schema definitions. These translators are used to validate and process JSON data.
- **Incremental JSON Parsing**: The `createIncrementalJsonParser` function allows for efficient, step-by-step parsing of JSON data, which is useful for handling large or streaming JSON payloads.

### Image Processing

- **EXIF Data Extraction**: Functions such as `extractRelevantExifTags` allow for the extraction of metadata from image files.
- **Image Element Generation**: The `getImageElement` function generates HTML image elements from image data.
- **Location-Based Image Analysis**: Functions like `findNearbyPointsOfInterest` and `exifGPSTagToLatLong` enable the identification of nearby points of interest and the conversion of EXIF GPS tags to latitude and longitude.

### Date and Time Manipulation

- **Parsing and Formatting**: Functions like `parseDateString`, `parseFuzzyDateString`, and `parseTimeString` handle various date and time formats, including fuzzy parsing and time string conversion.
- **Date Calculations**: Utilities for adding days, months, or milliseconds to dates, as well as determining the start of a week or month.

### Location Services

- **Reverse Geocoding**: The `reverseGeocode` function translates geographic coordinates into human-readable addresses.
- **Point of Interest (POI) Discovery**: The `findNearbyPointsOfInterest` function identifies nearby locations of interest based on geographic coordinates.

### MIME Types

- **File Type Identification**: Functions like `getFileExtensionForMimeType` and `getMimeTypeFromFileExtension` map between MIME types and file extensions.
- **Image MIME Type Support**: The `isImageMimeTypeSupported` function checks if a given MIME type is supported for image processing.

These utilities are integral to the functionality of other packages in the TypeAgent monorepo, including `agent-api`, `agent-cache`, `agent-cli`, and various agent-specific packages.

## Setup

The `typechat-utils` package does not require any special setup beyond installing its dependencies. To get started, run:

```sh
pnpm install
```

For additional details, refer to the hand-written README.

## Key Files

The `typechat-utils` package is organized into several modules, each focusing on a specific set of utilities:

- **[index.ts](./src/index.ts)**: The main entry point that re-exports functions and classes from other modules.
- **[jsonTranslator.ts](./src/jsonTranslator.ts)**: Handles JSON translation, including schema-based translators and validators. Key exports include `createJsonTranslatorFromSchemaDef`, `createJsonTranslatorFromFile`, and `createJsonTranslatorWithValidator`.
- **[incrementalJsonParser.ts](./src/incrementalJsonParser.ts)**: Provides the `createIncrementalJsonParser` function for step-by-step JSON parsing.
- **[image.ts](./src/image.ts)**: Focuses on image processing, including EXIF data extraction (`extractRelevantExifTags`), image element generation (`getImageElement`), and location-based image analysis (`findNearbyPointsOfInterest`).
- **[datetimeHelper.ts](./src/datetimeHelper.ts)**: Contains utilities for date and time parsing and formatting, such as `parseDateString`, `parseFuzzyDateString`, and `parseTimeString`.
- **[location.ts](./src/location.ts)**: Implements location-based services, including `reverseGeocode`, `exifGPSTagToLatLong`, and `findNearbyPointsOfInterest`.
- **[mimeTypes.ts](./src/mimeTypes.ts)**: Provides functions for handling MIME types and file extensions, such as `getFileExtensionForMimeType` and `isImageMimeTypeSupported`.

## How to extend

To add new functionality to the `typechat-utils` package, follow these steps:

1. **Identify the appropriate module**: Determine which existing module aligns with the functionality you want to add. For example, if you're adding a new image processing function, start with [image.ts](./src/image.ts).

2. **Implement the new feature**: Write your new function or class in the identified module. Follow the existing coding style and patterns to maintain consistency.

3. **Export the new functionality**: Ensure your new function or class is exported from its module. If it needs to be publicly accessible, add it to the exports in [index.ts](./src/index.ts).

4. **Write tests**: Create or update test files to include test cases for your new functionality. This ensures that your changes work as intended and do not introduce regressions.

5. **Run the test suite**: Use the following command to run the tests and verify your changes:

```sh
pnpm test
```

6. **Document your changes**: Update the hand-written README or other relevant documentation to describe the new functionality and how to use it.

By following these steps, you can contribute effectively to the `typechat-utils` package and ensure that your changes integrate smoothly with the existing codebase.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/aiclient](../../../packages/aiclient/README.md)
- [telemetry](../../../packages/telemetry/README.md)

External: `@azure-rest/maps-search`, `chalk`, `date-fns`, `debug`, `exifreader`, `typechat`

### Used by

- [agent-api](../../../packages/api/README.md)
- [agent-cache](../../../packages/cache/README.md)
- [agent-cli](../../../packages/cli/README.md)
- [agent-dispatcher](../../../packages/dispatcher/dispatcher/README.md)
- [agent-shell](../../../packages/shell/README.md)
- [calendar](../../../packages/agents/calendar/README.md)
- [chat-agent](../../../packages/agents/chat/README.md)
- [chat-example](../../../examples/chat/README.md)
- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)
- [desktop-automation](../../../packages/agents/desktop/README.md)
- _…and 5 more workspace consumers._

### Files of interest

`./src/index.ts`, `./src/datetimeHelper.ts`, `./src/image.ts`, …and 5 more under `./src/`.

---

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter typechat-utils docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
