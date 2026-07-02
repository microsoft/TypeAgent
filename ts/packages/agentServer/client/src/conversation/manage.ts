// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared implementation of the dispatcher's `manage-conversation`
// client-action surface (new/list/info/switch/prev/next/rename/delete).
// Each subcommand returns a {@link ConversationActionResult} that the
// caller renders to its UI (CLI text, Electron HTML, VS Code
// notification, browser HTML); these helpers contain no presentation.

import type { ClientIO } from "@typeagent/dispatcher-rpc/types";
import type {
    AgentServerConnection,
    ConversationDispatcher,
    ConversationInfo,
} from "../index.js";
import {
    findConversationByName,
    formatAutoConversationName,
    normalizeConversationName,
    sortConversationsByCreatedDesc,
} from "./naming.js";
import {
    isConversationNotFoundError,
    switchConversationSafe,
    type SwitchConversationHooks,
} from "./lifecycle.js";

/**
 * Structural copy of the dispatcher's `ManageConversationPayload` —
 * kept here so this package doesn't depend on agent-dispatcher.
 */
export type ManageConversationPayload = {
    subcommand:
        | "new"
        | "list"
        | "info"
        | "switch"
        | "prev"
        | "next"
        | "rename"
        | "delete";
    name?: string;
    newName?: string;
};

export type ManageConversationContext = {
    currentConversationId: string | undefined;
    currentConversationName: string | undefined;
    /**
     * Optional live getter for the active conversation id. When set,
     * helpers that fire post-RPC hooks (e.g. {@link manageRename}'s
     * `onCurrentConversationUpdated`) re-check the current id at hook
     * time to avoid firing for a conversation that was switched out
     * from under the in-flight op.
     */
    getCurrentConversationId?: () => string | undefined;
    /**
     * Fires after the new conversation is joined, before the old one
     * is left. Rebind the active dispatcher here, but keep work minimal
     * — UI clears, history replay, and broadcasts that should not race
     * lingering events from the old conversation belong in
     * {@link onAfterSwitched}.
     */
    onSwitched?: (
        newConversation: ConversationDispatcher,
    ) => void | Promise<void>;
    /** Best-effort persistence after onSwitched; a throw is swallowed. */
    onPersistSwitched?: (conversationId: string) => void | Promise<void>;
    /**
     * Fires once the old conversation has been (best-effort) left.
     * Safe place for history replay, UI clears, and broadcasts that
     * must not see late events from the prior conversation.
     * `leaveError` is the leave-call error or undefined on success;
     * a throw inside this hook is swallowed.
     */
    onAfterSwitched?: (
        newConversation: ConversationDispatcher,
        leaveError: unknown,
    ) => void | Promise<void>;
    /**
     * Fires when a manage-* op changes the *current* conversation's
     * metadata in place (e.g. rename). Use to refresh title bars and
     * cached names without going through a full switch. A throw is
     * swallowed — never fails the operation.
     */
    onCurrentConversationUpdated?: (
        updated: ConversationInfo,
    ) => void | Promise<void>;
    /**
     * Confirmation prompt for destructive ops. Omit to proceed without
     * prompting (the dispatcher's `delete` slash command already
     * requires the user to type the name, so that's defensible).
     */
    confirmDestructive?: (
        action: "delete",
        target: ConversationInfo,
    ) => boolean | Promise<boolean>;
    /** Forwarded to every `joinConversation` call (e.g. `clientType`, `filter`). */
    joinOptions?: Omit<
        Parameters<AgentServerConnection["joinConversation"]>[1] & object,
        "conversationId"
    >;
    /** Cycle order for prev/next. Defaults to "newest-first". */
    cycleOrder?: "newest-first" | "server-order";
    /**
     * What to do when the current conversation isn't in the cycle list
     * (e.g. it was just deleted). "wrap" picks index 0; "error" returns
     * an error result. Defaults to "wrap".
     */
    cycleOnCurrentNotInList?: "wrap" | "error";
};

/**
 * Discriminated result returned by every manage-* function:
 *  - `ok`: success; `switched=true` when active conversation changed
 *  - `warning`: user error (missing arg, already-on, etc.) — non-fatal
 *  - `error`: operation failed (network, server reject)
 *  - `list` / `info`: structured data caller renders to its UI
 *  - `cancelled`: destructive op the user declined
 */
export type ConversationActionResult =
    | {
          kind: "ok";
          message: string;
          switched?: boolean;
          conversation?: ConversationInfo;
      }
    | { kind: "warning"; message: string }
    | { kind: "error"; message: string; cause?: unknown }
    | {
          kind: "list";
          conversations: ConversationInfo[];
          currentConversationId: string | undefined;
      }
    | { kind: "info"; conversationId: string; name: string }
    | { kind: "cancelled"; target: ConversationInfo };

function ok(
    message: string,
    extras: {
        switched?: boolean;
        conversation?: ConversationInfo;
    } = {},
): ConversationActionResult {
    return { kind: "ok", message, ...extras };
}

function warning(message: string): ConversationActionResult {
    return { kind: "warning", message };
}

function error(message: string, cause?: unknown): ConversationActionResult {
    return { kind: "error", message, cause };
}

async function performSwitch(
    connection: AgentServerConnection,
    clientIO: ClientIO,
    ctx: ManageConversationContext,
    target: ConversationInfo,
    messageOnSuccess: string,
): Promise<ConversationActionResult> {
    const hooks: SwitchConversationHooks = {};
    if (ctx.onSwitched !== undefined) {
        hooks.onJoined = ctx.onSwitched;
    }
    if (ctx.onPersistSwitched !== undefined) {
        hooks.onPersist = ctx.onPersistSwitched;
    }
    let joinedConv: ConversationDispatcher | undefined;
    const wrappedOnJoined = hooks.onJoined;
    hooks.onJoined = async (newConv) => {
        joinedConv = newConv;
        if (wrappedOnJoined) {
            await wrappedOnJoined(newConv);
        }
    };
    if (ctx.onAfterSwitched !== undefined) {
        const after = ctx.onAfterSwitched;
        hooks.onLeftOld = async (_oldId, leaveErr) => {
            await after(joinedConv!, leaveErr);
        };
    }
    const result = await switchConversationSafe(
        connection,
        clientIO,
        ctx.currentConversationId,
        target.conversationId,
        hooks,
        ctx.joinOptions,
    );
    if (result.kind === "already-on") {
        return warning(`Already on conversation "${target.name}".`);
    }
    if (result.kind === "join-failed") {
        const cause = result.error as { message?: string } | undefined;
        return error(
            `Failed to switch to conversation "${target.name}": ${
                cause?.message ?? String(result.error)
            }`,
            result.error,
        );
    }
    // switchConversationSafe only fires onLeftOld when there *was* a
    // current conversation. Fire onAfterSwitched explicitly for the
    // no-current case (e.g. very first `manageNew`) so callers' replay
    // and broadcast hooks fire regardless of starting state.
    if (
        ctx.currentConversationId === undefined &&
        ctx.onAfterSwitched !== undefined &&
        joinedConv !== undefined
    ) {
        try {
            await ctx.onAfterSwitched(joinedConv, undefined);
        } catch {
            // Observational hook; never fail the switch.
        }
    }
    return ok(messageOnSuccess, { switched: true, conversation: target });
}

/**
 * `new` — create-and-switch. If `name` is absent, uses
 * `formatAutoConversationName()`. On name collision, switches to the
 * existing conversation instead of failing.
 */
export async function manageNew(
    connection: AgentServerConnection,
    clientIO: ClientIO,
    ctx: ManageConversationContext,
    name?: string,
): Promise<ConversationActionResult> {
    const chosen = name?.trim() || formatAutoConversationName();
    const targetNorm = normalizeConversationName(chosen);

    // Collision: switch to the existing conversation instead of failing.
    const existing = await connection.listConversations(chosen);
    const collision = existing.find(
        (c) => normalizeConversationName(c.name) === targetNorm,
    );
    if (collision !== undefined) {
        return performSwitch(
            connection,
            clientIO,
            ctx,
            collision,
            `A conversation named "${collision.name}" already exists — switched to it.`,
        );
    }

    let created: ConversationInfo;
    try {
        created = await connection.createConversation(chosen);
    } catch (createErr) {
        // Peer-client race: re-list and adopt the winner.
        const retry = await connection.listConversations(chosen);
        const retryMatch = retry.find(
            (c) => normalizeConversationName(c.name) === targetNorm,
        );
        if (retryMatch === undefined) {
            return error(
                `Failed to create conversation "${chosen}": ${
                    (createErr as { message?: string })?.message ??
                    String(createErr)
                }`,
                createErr,
            );
        }
        return performSwitch(
            connection,
            clientIO,
            ctx,
            retryMatch,
            `A conversation named "${retryMatch.name}" already exists — switched to it.`,
        );
    }

    return performSwitch(
        connection,
        clientIO,
        ctx,
        created,
        `Created and switched to conversation "${created.name}".`,
    );
}

/** `list` — returns structured `list` result for the caller to render. */
export async function manageList(
    connection: AgentServerConnection,
    ctx: ManageConversationContext,
    filter?: string,
): Promise<ConversationActionResult> {
    const all = await connection.listConversations(filter);
    if (all.length === 0) {
        return warning("No conversations found.");
    }
    return {
        kind: "list",
        conversations: sortConversationsByCreatedDesc(all),
        currentConversationId: ctx.currentConversationId,
    };
}

/** `info` — show the current conversation id + name. */
export function manageInfo(
    ctx: ManageConversationContext,
): ConversationActionResult {
    if (
        ctx.currentConversationId === undefined ||
        ctx.currentConversationName === undefined
    ) {
        return warning("Not currently in a conversation.");
    }
    return {
        kind: "info",
        conversationId: ctx.currentConversationId,
        name: ctx.currentConversationName,
    };
}

/** `switch` — switch by name; errors on no match (does NOT create). */
export async function manageSwitch(
    connection: AgentServerConnection,
    clientIO: ClientIO,
    ctx: ManageConversationContext,
    name: string | undefined,
): Promise<ConversationActionResult> {
    const trimmed = name?.trim();
    if (!trimmed) {
        return warning("A conversation name is required to switch.");
    }
    const all = await connection.listConversations();
    const match = findConversationByName(all, trimmed);
    if (match === undefined) {
        return warning(`No conversation named "${trimmed}" found.`);
    }
    if (match.conversationId === ctx.currentConversationId) {
        return warning(`Already on conversation "${match.name}".`);
    }
    return performSwitch(
        connection,
        clientIO,
        ctx,
        match,
        `Switched to conversation "${match.name}".`,
    );
}

/** `prev` / `next` — cycle by creation order (matches `list`). */
export async function manageCycle(
    connection: AgentServerConnection,
    clientIO: ClientIO,
    ctx: ManageConversationContext,
    direction: "prev" | "next",
): Promise<ConversationActionResult> {
    const raw = await connection.listConversations();
    const sorted =
        ctx.cycleOrder === "server-order"
            ? raw
            : sortConversationsByCreatedDesc(raw);
    if (sorted.length === 0) {
        return warning("No conversations to switch to.");
    }
    if (sorted.length < 2) {
        return warning(
            "Only one conversation is available — nothing to switch to.",
        );
    }
    const curIdx =
        ctx.currentConversationId !== undefined
            ? sorted.findIndex(
                  (c) => c.conversationId === ctx.currentConversationId,
              )
            : -1;
    if (curIdx === -1 && ctx.cycleOnCurrentNotInList === "error") {
        return error("Current conversation not found in list.");
    }
    const delta = direction === "next" ? 1 : -1;
    const nextIdx =
        curIdx === -1 ? 0 : (curIdx + delta + sorted.length) % sorted.length;
    const target = sorted[nextIdx];
    if (target.conversationId === ctx.currentConversationId) {
        return warning(
            "Only one conversation is available — nothing to switch to.",
        );
    }
    const label = direction === "next" ? "next" : "previous";
    return performSwitch(
        connection,
        clientIO,
        ctx,
        target,
        `Switched to ${label} conversation "${target.name}".`,
    );
}

/**
 * `rename` — rename current (when `name` is absent) or a specific
 * conversation. Pre-checks collision; the server enforces it too.
 */
export async function manageRename(
    connection: AgentServerConnection,
    ctx: ManageConversationContext,
    name: string | undefined,
    newName: string | undefined,
): Promise<ConversationActionResult> {
    const trimmedNew = newName?.trim();
    if (!trimmedNew) {
        return warning("A new name is required to rename the conversation.");
    }

    let targetId: string;
    let oldName: string | undefined;
    let isCurrent: boolean;

    if (name !== undefined && name.trim() !== "") {
        const trimmedName = name.trim();
        const all = await connection.listConversations();
        const match = findConversationByName(all, trimmedName);
        if (match === undefined) {
            return warning(`No conversation named "${trimmedName}" found.`);
        }
        targetId = match.conversationId;
        oldName = match.name;
        isCurrent = targetId === ctx.currentConversationId;
    } else {
        if (ctx.currentConversationId === undefined) {
            return warning("No active conversation to rename.");
        }
        targetId = ctx.currentConversationId;
        oldName = ctx.currentConversationName;
        isCurrent = true;
    }

    const newNorm = normalizeConversationName(trimmedNew);
    const all = await connection.listConversations();
    const collision = all.find(
        (c) =>
            c.conversationId !== targetId &&
            normalizeConversationName(c.name) === newNorm,
    );
    if (collision !== undefined) {
        return warning(`A conversation named "${trimmedNew}" already exists.`);
    }

    try {
        await connection.renameConversation(targetId, trimmedNew);
    } catch (e) {
        return error(
            `Failed to rename conversation: ${
                (e as { message?: string })?.message ?? String(e)
            }`,
            e,
        );
    }

    // Preserve original createdAt/clientCount so callers re-sorting by
    // created time don't see zero placeholders.
    const original = all.find((c) => c.conversationId === targetId);
    const updated: ConversationInfo = {
        conversationId: targetId,
        name: trimmedNew,
        clientCount: original?.clientCount ?? 0,
        createdAt: original?.createdAt ?? "",
    };

    if (isCurrent && ctx.onCurrentConversationUpdated !== undefined) {
        // Re-check the live current id (when available) — the active
        // conversation may have changed during the rename RPC.
        const currentNow =
            ctx.getCurrentConversationId?.() ?? ctx.currentConversationId;
        if (targetId === currentNow) {
            try {
                await ctx.onCurrentConversationUpdated(updated);
            } catch {
                // Observational hook; never fail the rename.
            }
        }
    }

    return {
        kind: "ok",
        message:
            oldName !== undefined
                ? `Renamed conversation "${oldName}" to "${trimmedNew}".`
                : `Renamed conversation to "${trimmedNew}".`,
        conversation: updated,
        // Surface whether the rename hit the current conversation so
        // the caller knows to refresh its title bar / cached name.
        ...(isCurrent ? { switched: false } : {}),
    };
}

/**
 * `delete` — by name. Refuses to delete the active conversation.
 * Invokes `ctx.confirmDestructive` when set; treats peer-already-deleted
 * (server "Conversation not found" on either list-miss or delete-call)
 * as idempotent success.
 */
export async function manageDelete(
    connection: AgentServerConnection,
    ctx: ManageConversationContext,
    name: string | undefined,
): Promise<ConversationActionResult> {
    const trimmed = name?.trim();
    if (!trimmed) {
        return warning("A conversation name is required to delete.");
    }
    const all = await connection.listConversations();
    const match = findConversationByName(all, trimmed);
    if (match === undefined) {
        return warning(`No conversation named "${trimmed}" found.`);
    }
    if (match.conversationId === ctx.currentConversationId) {
        return warning(
            `Cannot delete the currently active conversation "${match.name}". ` +
                `Switch to a different conversation first.`,
        );
    }
    if (ctx.confirmDestructive) {
        let confirmed: boolean;
        try {
            confirmed = await ctx.confirmDestructive("delete", match);
        } catch (e) {
            return error(
                `Confirmation prompt failed: ${
                    (e as { message?: string })?.message ?? String(e)
                }`,
                e,
            );
        }
        if (!confirmed) {
            return { kind: "cancelled", target: match };
        }
    }
    try {
        await connection.deleteConversation(match.conversationId);
    } catch (e) {
        // Peer already deleted it between list and call: success.
        if (isConversationNotFoundError(e)) {
            return ok(`Deleted conversation "${match.name}".`, {
                conversation: match,
            });
        }
        return error(
            `Failed to delete conversation "${match.name}": ${
                (e as { message?: string })?.message ?? String(e)
            }`,
            e,
        );
    }
    return ok(`Deleted conversation "${match.name}".`, {
        conversation: match,
    });
}

/**
 * Dispatch a `manage-conversation` payload to the right subcommand
 * handler. Most clients call this directly from the dispatcher's
 * `takeAction` for `action === "manage-conversation"`.
 *
 * **Serialization contract:** subcommands that switch the active
 * conversation (`new`, `switch`, `prev`, `next`) read `ctx` at entry
 * and pass it to {@link switchConversationSafe}. Callers must
 * serialize overlapping invocations themselves (e.g. mutex, queue);
 * concurrent switches from the same starting conversation can leave
 * two server-side conversations joined while the caller's view of
 * `currentConversationId` reflects only one. CLI is single-threaded;
 * Shell, VS Code, and the browser extension each serialize via their
 * own per-instance queue/mutex.
 */
export async function manageConversation(
    connection: AgentServerConnection,
    clientIO: ClientIO,
    ctx: ManageConversationContext,
    payload: ManageConversationPayload,
): Promise<ConversationActionResult> {
    try {
        switch (payload.subcommand) {
            case "new":
                return await manageNew(connection, clientIO, ctx, payload.name);
            case "list":
                return await manageList(connection, ctx, payload.name);
            case "info":
                return manageInfo(ctx);
            case "switch":
                return await manageSwitch(
                    connection,
                    clientIO,
                    ctx,
                    payload.name,
                );
            case "prev":
            case "next":
                return await manageCycle(
                    connection,
                    clientIO,
                    ctx,
                    payload.subcommand,
                );
            case "rename":
                return await manageRename(
                    connection,
                    ctx,
                    payload.name,
                    payload.newName,
                );
            case "delete":
                return await manageDelete(connection, ctx, payload.name);
            default: {
                const unknown = (payload as { subcommand: string }).subcommand;
                return error(
                    `Unknown manage-conversation subcommand: "${unknown}".`,
                );
            }
        }
    } catch (e) {
        return error((e as { message?: string })?.message ?? String(e), e);
    }
}
