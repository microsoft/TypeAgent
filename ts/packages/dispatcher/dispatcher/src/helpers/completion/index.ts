// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Re-export completion utilities for consumers that import through the dispatcher.

export {
    BaseTSTData,
    TST,
    SearchMenuPosition,
    SearchMenuItem,
    SearchMenuBase,
    normalizeMatchText,
} from "./searchMenu.js";
export {
    ISearchMenu,
    ICompletionDispatcher,
    PartialCompletionSession,
} from "./session.js";
