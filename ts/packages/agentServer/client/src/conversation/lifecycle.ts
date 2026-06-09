// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Connection-level lifecycle helpers shared by every client that joins
 * an agent server (CLI, Electron shell, VS Code extension, browser
 * extension). These wrap the raw {@link AgentServerConnection} API with
 * the race-handling, fallback, and join-before-leave patterns that all
 * four clients had reinvented inline.
 *
 * The helpers are deliberately UI-agnostic: they take the connection +
 * a clientIO and return structured results. Persistence
 * (lastConversationId), dispatcher rebinding, and history replay stay
 * in the caller via the hook callbacks on {@link switchConversationSafe}.
 */

import type { ClientIO } from "@typeagent/dispatcher-rpc/types";
import type {
    AgentServerConnection,
    ConversationDispatcher,
    ConversationInfo,
} from "../index.js";
import { findConversationByName, normalizeConversationName } from "./naming.js";

/**
 * Find a conversation by name (case-insensitive), creating one if none
 * exists. Handles the race where two clients simultaneously try to
 * create the same named default — the loser of the create race re-lists
 * and adopts the winning entry instead of bubbling a `name in use`
 * error to the user.
 *
 * Used by:
 *  - CLI to find-or-create the "CLI" conversation.
 *  - Electron shell to find-or-create the "Shell" conversation.
 *  - VS Code extension to find-or-create the named default (e.g. "VS Code").
 *  - Browser extension equivalents.
 */
export async function findOrCreateNamedConversation(
    connection: AgentServerConnection,
    name: string,
): Promise<ConversationInfo> {
    const initial = await connection.listConversations(name);
    const match = findConversationByName(initial, name);
    if (match !== undefined) {
        return match;
    }
    try {
        return await connection.createConversation(name);
    } catch (createErr) {
        // Race with a peer client: re-list and adopt the winner.
        const retry = await connection.listConversations(name);
        const retryMatch = findConversationByName(retry, name);
        if (retryMatch !== undefined) {
            return retryMatch;
        }
        throw createErr;
    }
}

/**
 * Options for {@link joinNamedOrFallback}.
 */
export type JoinNamedOrFallbackOptions = {
    /**
     * If provided, attempt to join this conversation first (typically a
     * persisted "last used" id). On failure (deleted server-side, etc.)
     * fall through to {@link defaultName}.
     */
    savedConversationId?: string;
    /**
     * Default conversation name to find-or-create when {@link
     * savedConversationId} is absent or the join fails.
     */
    defaultName: string;
    /**
     * Options forwarded to `connection.joinConversation` (e.g. `clientType`,
     * `filter`). The `conversationId` field is overridden by this helper.
     */
    joinOptions?: Omit<
        Parameters<AgentServerConnection["joinConversation"]>[1] & object,
        "conversationId"
    >;
    /**
     * Optional hook invoked when the saved id was unreachable so the
     * caller can log / clear stale state. Receives the original error.
     */
    onSavedConversationUnavailable?: (err: unknown) => void;
    /**
     * Optional gate on whether the saved-id failure should fall back to
     * the named default. Defaults to "always fall back" — i.e. any
     * error from saved-id join triggers the fallback path. Clients with
     * stricter semantics (the CLI prompts the user and only falls back
     * for "Conversation not found:" errors) should supply a predicate.
     * Return false (or a Promise resolving to false) to abort with the
     * original error.
     */
    shouldFallback?: (err: unknown) => boolean | Promise<boolean>;
};

/**
 * Result of {@link joinNamedOrFallback}.
 */
export type JoinNamedOrFallbackResult = {
    /** The joined conversation. */
    conversation: ConversationDispatcher;
    /**
     * True if the saved id was used; false if we fell back to the named
     * default (either because no savedId was provided, the saved
     * conversation was gone, or the join failed).
     */
    usedSavedId: boolean;
};

/**
 * Restore-or-fallback: try a saved conversation id first, otherwise
 * find-or-create the named default and join it. Also recovers from
 * the race where `listConversations` saw the default but
 * `joinConversation` failed because it was deleted in between.
 *
 * By default any error from the saved-id join falls back to the named
 * default; pass `shouldFallback` to gate this (e.g. the CLI prompts
 * the user and only falls back for "Conversation not found:" errors).
 * Persistence is the caller's responsibility — record
 * `result.conversation.conversationId` on success.
 */
export async function joinNamedOrFallback(
    connection: AgentServerConnection,
    clientIO: ClientIO,
    options: JoinNamedOrFallbackOptions,
): Promise<JoinNamedOrFallbackResult> {
    if (options.savedConversationId !== undefined) {
        try {
            const conversation = await connection.joinConversation(clientIO, {
                ...options.joinOptions,
                conversationId: options.savedConversationId,
            });
            return { conversation, usedSavedId: true };
        } catch (e: unknown) {
            options.onSavedConversationUnavailable?.(e);
            const shouldFall =
                options.shouldFallback === undefined
                    ? true
                    : await options.shouldFallback(e);
            if (!shouldFall) {
                throw e;
            }
            // fall through to default
        }
    }

    const target = await findOrCreateNamedConversation(
        connection,
        options.defaultName,
    );
    try {
        const conversation = await connection.joinConversation(clientIO, {
            ...options.joinOptions,
            conversationId: target.conversationId,
        });
        return { conversation, usedSavedId: false };
    } catch {
        // The conversation may have been deleted between listConversations
        // and joinConversation. Create a fresh one with the same name and
        // join that — this matches Electron shell `restoreOrJoinShell`.
        const fresh = await connection.createConversation(options.defaultName);
        const conversation = await connection.joinConversation(clientIO, {
            ...options.joinOptions,
            conversationId: fresh.conversationId,
        });
        return { conversation, usedSavedId: false };
    }
}

/**
 * Hooks for {@link switchConversationSafe}. All are optional; each
 * fires at a distinct stage of the join-before-leave protocol so the
 * caller can coordinate its own UI / persistence side-effects without
 * the helper needing to know about them.
 */
export type SwitchConversationHooks = {
    /**
     * Fires immediately after the new conversation is joined and its
     * dispatcher is ready. Use this to rebind the active dispatcher,
     * clear request-id maps, reset queue state, etc. — anything that
     * must happen before the helper attempts to leave the old session.
     */
    onJoined?: (
        newConversation: ConversationDispatcher,
    ) => void | Promise<void>;
    /**
     * Fires after {@link onJoined}, intended for persistence (writing
     * the new id to user settings, cli-state.json, workspace state).
     * A throw here is logged but does NOT roll back the switch — the
     * client is already on the new conversation.
     */
    onPersist?: (conversationId: string) => void | Promise<void>;
    /**
     * Fires after the (best-effort) leave of the old conversation.
     * Receives any error from the leave attempt; ignoring it is fine
     * (the user-facing switch already succeeded).
     */
    onLeftOld?: (oldConversationId: string, err: unknown) => void;
};

/**
 * Result of {@link switchConversationSafe}.
 */
export type SwitchConversationResult =
    | {
          kind: "switched";
          conversation: ConversationDispatcher;
      }
    | {
          kind: "already-on";
          conversationId: string;
      }
    | {
          kind: "join-failed";
          targetConversationId: string;
          error: unknown;
      };

/**
 * Switch to a different conversation using the join-before-leave
 * protocol that all four clients hand-rolled:
 *
 *   1. Join the new conversation. If this fails, the old conversation
 *      is still active and the caller can surface the error cleanly.
 *   2. Fire `onJoined` so the caller rebinds its dispatcher reference
 *      etc. before anything else can race with a stale dispatcher.
 *   3. Fire `onPersist` so the new id is saved.
 *   4. Best-effort leave the old conversation; `onLeftOld` fires with
 *      any error (a failure here does NOT roll back the switch).
 *
 * No-ops cleanly (`already-on`) when `currentConversationId` equals
 * `targetConversationId`.
 */
export async function switchConversationSafe(
    connection: AgentServerConnection,
    clientIO: ClientIO,
    currentConversationId: string | undefined,
    targetConversationId: string,
    hooks: SwitchConversationHooks = {},
    joinOptions?: Omit<
        Parameters<AgentServerConnection["joinConversation"]>[1] & object,
        "conversationId"
    >,
): Promise<SwitchConversationResult> {
    if (currentConversationId === targetConversationId) {
        return { kind: "already-on", conversationId: targetConversationId };
    }

    let conversation: ConversationDispatcher;
    try {
        conversation = await connection.joinConversation(clientIO, {
            ...joinOptions,
            conversationId: targetConversationId,
        });
    } catch (e: unknown) {
        return { kind: "join-failed", targetConversationId, error: e };
    }

    if (hooks.onJoined) {
        try {
            await hooks.onJoined(conversation);
        } catch (e) {
            // The caller's rebind failed — without this, the server
            // would hold a joined channel for a conversation the client
            // can't drive. Roll back by leaving the new conversation,
            // then re-throw so the caller surfaces the failure (the
            // user is still on `currentConversationId`).
            await connection
                .leaveConversation(conversation.conversationId)
                .catch(() => {
                    // best-effort cleanup
                });
            throw e;
        }
    }

    if (hooks.onPersist) {
        try {
            await hooks.onPersist(conversation.conversationId);
        } catch {
            // Persistence is best-effort; don't roll back the switch.
        }
    }

    if (currentConversationId !== undefined) {
        try {
            await connection.leaveConversation(currentConversationId);
            hooks.onLeftOld?.(currentConversationId, undefined);
        } catch (e: unknown) {
            hooks.onLeftOld?.(currentConversationId, e);
        }
    }

    return { kind: "switched", conversation };
}

/**
 * Create and join a uniquely-named ephemeral conversation. Used by the
 * CLI's `--memory` flag and the VS Code extension's per-panel ephemeral
 * sessions. Callers are responsible for calling
 * {@link deleteEphemeralConversation} on shutdown to keep the server
 * tidy.
 */
export async function createEphemeralConversation(
    connection: AgentServerConnection,
    clientIO: ClientIO,
    namePrefix: string,
    joinOptions?: Omit<
        Parameters<AgentServerConnection["joinConversation"]>[1] & object,
        "conversationId"
    >,
): Promise<{
    conversation: ConversationDispatcher;
    ephemeralConversationId: string;
    name: string;
}> {
    // crypto.randomUUID is in the Web Crypto API exposed by Node ≥19
    // globalThis; widely available in every runtime that already runs
    // this package (CLI, Electron main, vscode extension host,
    // browser MV3 service worker).
    const uniqueSuffix =
        typeof globalThis.crypto?.randomUUID === "function"
            ? globalThis.crypto.randomUUID()
            : `${Date.now().toString(36)}-${Math.random()
                  .toString(36)
                  .slice(2, 10)}`;
    const name = `${namePrefix}-${uniqueSuffix}`;
    const created = await connection.createConversation(name);
    let conversation: ConversationDispatcher;
    try {
        conversation = await connection.joinConversation(clientIO, {
            ...joinOptions,
            conversationId: created.conversationId,
        });
    } catch (e) {
        // Don't leak the server-side conversation if join fails — the
        // server's orphan sweeper only collects conversations whose
        // names start with specific prefixes (e.g. "cli-ephemeral-"),
        // so other callers would leak forever.
        await connection
            .deleteConversation(created.conversationId)
            .catch(() => {
                // best-effort cleanup
            });
        throw e;
    }
    return {
        conversation,
        ephemeralConversationId: created.conversationId,
        name,
    };
}

/**
 * Best-effort cleanup for an ephemeral conversation created with
 * {@link createEphemeralConversation}. Swallows errors so it can be
 * called from `finally` blocks during shutdown.
 */
export async function deleteEphemeralConversation(
    connection: AgentServerConnection,
    conversationId: string,
): Promise<void> {
    try {
        await connection.deleteConversation(conversationId);
    } catch {
        // Best effort — server may already have cleaned it up.
    }
}

/**
 * Check whether a new name is unique among existing conversations,
 * optionally excluding a specific id (used by rename so renaming
 * to the *current* name is allowed). Returns the colliding entry on
 * collision; undefined on success.
 *
 * Note: the server enforces uniqueness on create/rename. This is a
 * client-side pre-check used by UIs that want to validate input
 * *before* sending (e.g. VS Code's `validateInput` hook on
 * `showInputBox`).
 */
export async function validateConversationNameUnique(
    connection: AgentServerConnection,
    name: string,
    excludeConversationId?: string,
): Promise<ConversationInfo | undefined> {
    const norm = normalizeConversationName(name);
    const all = await connection.listConversations();
    return all.find(
        (c) =>
            normalizeConversationName(c.name) === norm &&
            c.conversationId !== excludeConversationId,
    );
}
