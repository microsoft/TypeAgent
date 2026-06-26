<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=d499a347f3cb12cc16c43e1a942063848d5f5ff16cb4e57846ddf5db0fa82464 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# typechat-utils — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `typechat-utils` package is a TypeScript library that provides common utilities for the TypeAgent project. It includes functions and classes for handling JSON translation, image processing, date and time manipulation, and location-based services. These utilities are essential for various packages within the TypeAgent monorepo.

## What it does

The `typechat-utils` package offers a variety of utilities that are essential for the TypeAgent project. These utilities include:

- **JSON Translation**: Functions for creating JSON translators from schema definitions, enabling JSON translator streaming, and validating JSON data. Key functions include `createJsonTranslatorFromSchemaDef`, `createJsonTranslatorFromFile`, and `createJsonTranslatorWithValidator`.
- **Image Processing**: Functions for extracting EXIF data from images, generating image elements, and finding nearby points of interest based on image metadata. Notable functions include `extractRelevantExifTags`, `getImageElement`, and `findNearbyPointsOfInterest`.
- **Date and Time Manipulation**: Functions for parsing and formatting dates and times, including fuzzy date parsing and time string conversion. Important functions include `parseDateString`, `parseFuzzyDateString`, and `parseTimeString`.
- **Location Services**: Functions for reverse geocoding, converting EXIF GPS tags to latitude and longitude, and finding nearby points of interest. Key functions include `reverseGeocode`, `exifGPSTagToLatLong`, and `findNearbyPointsOfInterest`.
- **MIME Types**: Functions for determining file extensions from MIME types and vice versa, as well as checking if a MIME type is supported for images. Notable functions include `getFileExtensionForMimeType`, `getMimeTypeFromFileExtension`, and `isImageMimeTypeSupported`.

These utilities are used by various other packages within the TypeAgent monorepo, such as `agent-api`, `agent-cache`, `agent-cli`, and several agent-specific packages.

## Setup

The `typechat-utils` package does not require any special setup beyond installing its dependencies. To get started, simply run:

```sh
pnpm install
```

For detailed setup instructions, see the hand-written README.

## Key Files

The `typechat-utils` package is organized into several modules, each responsible for different aspects of utility functions:

- **[index.ts](./src/index.ts)**: The main entry point that exports functions and classes from other modules.
- **[jsonTranslator.ts](./src/jsonTranslator.ts)**: Contains functions for creating and managing JSON translators. This module includes functions like `createJsonTranslatorFromSchemaDef`, `createJsonTranslatorFromFile`, and `createJsonTranslatorWithValidator`.
- **[incrementalJsonParser.ts](./src/incrementalJsonParser.ts)**: Provides functions for incremental JSON parsing. The main function here is `createIncrementalJsonParser`.
- **[image.ts](./src/image.ts)**: Includes functions for processing images and extracting metadata. Key functions include `extractRelevantExifTags`, `getImageElement`, and `findNearbyPointsOfInterest`.
- **[datetimeHelper.ts](./src/datetimeHelper.ts)**: Offers functions for date and time manipulation. Important functions include `parseDateString`, `parseFuzzyDateString`, and `parseTimeString`.
- **[location.ts](./src/location.ts)**: Contains functions for location-based services, such as reverse geocoding and finding points of interest. Key functions include `reverseGeocode`, `exifGPSTagToLatLong`, and `findNearbyPointsOfInterest`.
- **[mimeTypes.ts](./src/mimeTypes.ts)**: Provides functions for handling MIME types and file extensions. Notable functions include `getFileExtensionForMimeType`, `getMimeTypeFromFileExtension`, and `isImageMimeTypeSupported`.

## How to extend

To extend the `typechat-utils` package, follow these steps:

1. **Identify the module to extend**: Determine which module is most relevant to the functionality you want to add or modify. For example, if you need to add a new date manipulation function, you would start with [datetimeHelper.ts](./src/datetimeHelper.ts).

2. **Add your function or class**: Implement your new function or class within the identified module. Ensure that your code follows the existing patterns and conventions used in the package.

3. **Export your addition**: Make sure to export your new function or class from the module so that it can be used by other parts of the package. Update [index.ts](./src/index.ts) if necessary to include your new export.

4. **Write tests**: Add tests for your new functionality to ensure it works as expected. Place your tests in the appropriate test file or create a new test file if needed.

5. **Run tests**: Execute the test suite to verify that your changes do not break existing functionality. You can run the tests using:

```sh
pnpm test
```

By following these steps, you can effectively extend the `typechat-utils` package and contribute to the TypeAgent project.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

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

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter typechat-utils docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
