// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Connection-level lifecycle helpers shared by every client that joins
// an agent server. UI-agnostic: clients supply hooks for dispatcher
// rebinding, persistence, and history replay; the helpers run the
// join-before-leave protocol and race-handling.

import type { ClientIO } from "@typeagent/dispatcher-rpc/types";
import type {
    AgentServerConnection,
    ConversationDispatcher,
    ConversationInfo,
} from "../index.js";
import { findConversationByName, normalizeConversationName } from "./naming.js";

/**
 * Find a conversation by name (case-insensitive), creating one if none
 * exists. If two clients race to create the same named default, the
 * loser re-lists and adopts the winning entry instead of failing.
 *
 * Input is trimmed once at the boundary to match the server's
 * uniqueness check (which also trims).
 */
export async function findOrCreateNamedConversation(
    connection: AgentServerConnection,
    name: string,
): Promise<ConversationInfo> {
    const trimmed = name.trim();
    const initial = await connection.listConversations(trimmed);
    const match = findConversationByName(initial, trimmed);
    if (match !== undefined) {
        return match;
    }
    try {
        return await connection.createConversation(trimmed);
    } catch (createErr) {
        // Peer-client race. List unfiltered to avoid the server's
        // raw `includes` filter missing a name with extra whitespace.
        const retry = await connection.listConversations();
        const retryMatch = findConversationByName(retry, trimmed);
        if (retryMatch !== undefined) {
            return retryMatch;
        }
        throw createErr;
    }
}

export type JoinNamedOrFallbackOptions = {
    /** Try this id first; on join failure fall through to {@link defaultName}. */
    savedConversationId?: string;
    /** Find-or-create this name when savedId is absent or its join fails. */
    defaultName: string;
    /** Forwarded to `connection.joinConversation`; conversationId is overridden. */
    joinOptions?: Omit<
        Parameters<AgentServerConnection["joinConversation"]>[1] & object,
        "conversationId"
    >;
    /** Invoked when the saved id was unreachable (logging / clearing stale state). */
    onSavedConversationUnavailable?: (err: unknown) => void;
    /**
     * Gate the fallback. Defaults to "always fall back". Return false
     * to abort with the original error (CLI uses this to only fall
     * back for "Conversation not found:" errors).
     */
    shouldFallback?: (err: unknown) => boolean | Promise<boolean>;
};

export type JoinNamedOrFallbackResult = {
    conversation: ConversationDispatcher;
    /** True if savedId was used; false if we fell back to the named default. */
    usedSavedId: boolean;
};

/**
 * Detect the server's "Conversation not found:" error so callers can
 * distinguish a missing conversation from other failures (transport,
 * permission, etc.). Used by helpers to decide when to recover by
 * re-creating vs. surfacing the original error.
 */
export function isConversationNotFoundError(err: unknown): boolean {
    const msg = (err as { message?: unknown } | null | undefined)?.message;
    return typeof msg === "string" && msg.startsWith("Conversation not found");
}

/**
 * Try `savedConversationId`, otherwise find-or-create `defaultName`.
 * If the named conversation was deleted between list and join, recovers
 * via {@link findOrCreateNamedConversation} (race-safe). Other join
 * errors are surfaced as-is.
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
            // Default: only fall back when the server says the saved
            // conversation no longer exists. Transport / permission
            // errors are rethrown so callers don't silently land in a
            // different conversation than the user asked for.
            const shouldFall =
                options.shouldFallback === undefined
                    ? isConversationNotFoundError(e)
                    : await options.shouldFallback(e);
            if (!shouldFall) {
                throw e;
            }
            options.onSavedConversationUnavailable?.(e);
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
    } catch (e: unknown) {
        // Only recover from "deleted between list and join" — other
        // join failures (permission, transport) would otherwise be
        // masked by a bogus duplicate-name error.
        if (!isConversationNotFoundError(e)) {
            throw e;
        }
        const fresh = await findOrCreateNamedConversation(
            connection,
            options.defaultName,
        );
        const conversation = await connection.joinConversation(clientIO, {
            ...options.joinOptions,
            conversationId: fresh.conversationId,
        });
        return { conversation, usedSavedId: false };
    }
}

export type SwitchConversationHooks = {
    /**
     * Fires after the new conversation is joined, before old-leave.
     * Use to rebind the active dispatcher. If this throws, the helper
     * leaves the new conversation and re-throws — the caller stays on
     * `currentConversationId`.
     */
    onJoined?: (
        newConversation: ConversationDispatcher,
    ) => void | Promise<void>;
    /** Best-effort persistence after onJoined; a throw is swallowed. */
    onPersist?: (conversationId: string) => void | Promise<void>;
    /**
     * Fires once after the (best-effort) leave of the old conversation;
     * `err` is the leave-call error or undefined on success. A throw or
     * rejection here is swallowed so the hook can't turn a successful
     * switch into a thrown failure.
     */
    onLeftOld?: (
        oldConversationId: string,
        err: unknown,
    ) => void | Promise<void>;
};

export type SwitchConversationResult =
    | { kind: "switched"; conversation: ConversationDispatcher }
    | { kind: "already-on"; conversationId: string }
    | {
          kind: "join-failed";
          targetConversationId: string;
          error: unknown;
      };

/**
 * Join-before-leave switch:
 *   1. Join new (failure leaves caller on current; returns join-failed).
 *   2. `onJoined` (caller rebinds; throw → rollback + re-throw).
 *   3. `onPersist` (best-effort; throw is swallowed).
 *   4. Leave old; `onLeftOld` fires once with any leave error
 *      (a throw inside the hook is swallowed).
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
            // Caller rebind failed: roll back the new join so the server
            // doesn't keep a channel the client can't drive.
            await connection
                .leaveConversation(conversation.conversationId)
                .catch(() => {});
            throw e;
        }
    }

    if (hooks.onPersist) {
        try {
            await hooks.onPersist(conversation.conversationId);
        } catch {
            // Persistence is best-effort; don't roll back.
        }
    }

    if (currentConversationId !== undefined) {
        let leaveErr: unknown;
        try {
            await connection.leaveConversation(currentConversationId);
        } catch (e: unknown) {
            leaveErr = e;
        }
        if (hooks.onLeftOld) {
            try {
                await hooks.onLeftOld(currentConversationId, leaveErr);
            } catch {
                // Hook is purely observational; never fail the switch.
            }
        }
    }

    return { kind: "switched", conversation };
}

/**
 * Create and join a uniquely-named ephemeral conversation. Callers
 * are responsible for calling {@link deleteEphemeralConversation} on
 * shutdown — the server's orphan sweeper only collects conversations
 * with specific name prefixes.
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
        await connection
            .deleteConversation(created.conversationId)
            .catch(() => {});
        throw e;
    }
    return {
        conversation,
        ephemeralConversationId: created.conversationId,
        name,
    };
}

/** Best-effort cleanup; swallows errors so it's safe in `finally` blocks. */
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
 * Client-side name uniqueness pre-check (server enforces uniqueness
 * authoritatively). Returns the colliding entry or undefined.
 * `excludeConversationId` lets rename skip the current row.
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
