// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Data Frame inclusion in search is EXPERIMENTAL CODE and RAPIDLY EVOLVING
 *
 * It allows Structured RAG to use both its standard indexes (entity, action, topic)
 * and custom data frames in a query
 */

export * from "./dataFrame.js";
export * from "./dataFrameQuery.js";
export * from "./dataFrameConversation.js";
export * as lang from "./dataFrameLangSearch.js";
