// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Re-export completion utilities for consumers that import through the dispatcher.

export {
    isUniquelySatisfied,
    createSearchMenuIndex,
    type SearchMenuIndex,
    type SearchMenuItem,
} from "./searchMenu.js";
export { CompletionState } from "./session.js";
export {
    type CompletionController,
    type CompletionControllerOptions,
    createCompletionController,
} from "./controller.js";
