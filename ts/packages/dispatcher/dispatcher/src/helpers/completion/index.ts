// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Re-export completion utilities for consumers that import through the dispatcher.

export {
    SearchMenuItem,
    isUniquelySatisfied,
    createSearchMenuDataProvider,
    type MutableSearchMenuDataProvider,
} from "./searchMenu.js";
export { CompletionState } from "./session.js";
export {
    CompletionController,
    CompletionControllerOptions,
    createCompletionController,
} from "./controller.js";
