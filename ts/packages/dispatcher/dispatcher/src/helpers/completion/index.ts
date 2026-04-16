// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Re-export completion utilities for consumers that import through the dispatcher.

export {
    SearchMenuPosition,
    SearchMenuItem,
    TSTSearchMenuDataProvider,
    isUniquelySatisfied,
    type SearchMenuDataProvider,
} from "./searchMenu.js";
export { CompletionState } from "./session.js";
export {
    CompletionController,
    CompletionControllerOptions,
    createCompletionController,
} from "./controller.js";
