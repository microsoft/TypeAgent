// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared conversation-lifecycle helpers for clients of the agent
 * server. Each existing client (CLI, Electron shell, VS Code
 * extension, browser extension) historically reinvented the same
 * find-or-create, restore-or-fallback, join-before-leave, and
 * manage-conversation logic on top of {@link AgentServerConnection};
 * these helpers consolidate that logic so the per-client code is
 * limited to its own UI.
 *
 * Import via the subpath export:
 *
 *     import {
 *         manageConversation,
 *         findOrCreateNamedConversation,
 *     } from "@typeagent/agent-server-client/conversation";
 *
 * The helpers are UI-agnostic: they take the connection + a clientIO
 * and return structured results. Persistence, history replay, and
 * dispatcher rebinding stay in the caller via the hooks on
 * {@link ManageConversationContext} and
 * {@link SwitchConversationHooks}.
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
