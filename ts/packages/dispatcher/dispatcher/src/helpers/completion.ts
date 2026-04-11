// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Re-export completion utilities from action-grammar for consumers
// (like the shell renderer) that import through the dispatcher.
// Uses the lightweight action-grammar/completion subpath to avoid
// pulling in Node.js-only modules from the full barrel export.

export { needsSeparatorInAutoMode } from "action-grammar/completion";
