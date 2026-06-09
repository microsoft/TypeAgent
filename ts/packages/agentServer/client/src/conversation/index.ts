// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared conversation-lifecycle helpers for clients of the agent
 * server. Each client (CLI, Electron shell, VS Code, browser extension)
 * historically reinvented the same find-or-create, restore-or-fallback,
 * join-before-leave, and manage-conversation logic; these helpers
 * consolidate it so per-client code is limited to its own UI.
 *
 *     import {
 *         manageConversation,
 *         findOrCreateNamedConversation,
 *     } from "@typeagent/agent-server-client/conversation";
 */

export {
    normalizeConversationName,
    findConversationByName,
    findUniqueConversationByName,
    formatAutoConversationName,
    sortConversationsByCreatedDesc,
    type ResolveByNameResult,
} from "./naming.js";

export {
    findOrCreateNamedConversation,
    joinNamedOrFallback,
    switchConversationSafe,
    createEphemeralConversation,
    deleteEphemeralConversation,
    validateConversationNameUnique,
    isConversationNotFoundError,
    type JoinNamedOrFallbackOptions,
    type JoinNamedOrFallbackResult,
    type SwitchConversationHooks,
    type SwitchConversationResult,
} from "./lifecycle.js";

export {
    manageConversation,
    manageNew,
    manageList,
    manageInfo,
    manageSwitch,
    manageCycle,
    manageRename,
    manageDelete,
    type ManageConversationPayload,
    type ManageConversationContext,
    type ConversationActionResult,
} from "./manage.js";
