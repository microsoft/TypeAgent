// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// TypeAgent entrypoint for upstream engine.js and export.js:
// https://github.com/beatrizalmeidaf/papero-pdf-text-extractor/tree/f9e92cbc0224d1413c11dda15b284ee41b9fc48f/web/assets

export { extractExistingDocument } from "./engine.js";
export { figureWords, toMarkdown } from "./export.js";
