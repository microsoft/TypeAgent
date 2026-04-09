// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Lightweight subpath export for the separator utility function.
// Isolated from the full action-grammar barrel to avoid pulling in
// Node.js-only modules (grammarLoader, grammarCompiler, etc.) when
// imported by browser bundles.

export { needsSeparatorInAutoMode } from "./grammarMatcher.js";
