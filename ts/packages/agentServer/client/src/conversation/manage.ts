// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared implementation of the dispatcher's `manage-conversation`
 * client-action surface. Mirrors the `ManageConversationPayload`
 * subcommands declared in
 * `agent-dispatcher/src/context/system/manageConversationPayload.ts`
 * (kept as a structural copy here so this package doesn't take a
 * dependency on `agent-dispatcher`).
 *
 * Each subcommand returns a typed {@link ConversationActionResult}
 * discriminated union. The caller (CLI chalk, Shell HTML, VS Code
 * notification, browser HTML) decides how to render it — these
 * helpers contain only logic, never presentation.
 *
 * Subcommands: new, list, info, switch, prev, next, rename, delete.
 */

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
    switchConversationSafe,
    type SwitchConversationHooks,
} from "./lifecycle.js";

// ── Payload shape ──────────────────────────────────────────────────────

/**
 * Structural copy of the dispatcher's `ManageConversationPayload`.
 * Kept in this package so callers can route the inbound client-action
 * `manage-conversation` payload directly to {@link manageConversation}
 * without having to import the dispatcher.
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

// ── Caller-provided context ────────────────────────────────────────────

/**
 * The caller's view of "what conversation am I on right now" plus a hook
 * the helpers fire after a successful join-before-leave switch so the
 * client can rebind its dispatcher, persist the new id, and replay
 * display history.
 *
 * `currentConversationId` may be undefined briefly during startup; most
 * subcommands degrade to a clear "no active conversation" result in
 * that case.
 */
export type ManageConversationContext = {
    currentConversationId: string | undefined;
    currentConversationName: string | undefined;
    /**
     * Fired after any successful conversation switch driven by the
     * manage layer. Receives the new conversation. Use this to rebind
     * the active dispatcher, save the id to user settings, replay
     * display history, etc. — anything that belongs to the client.
     *
     * Wraps {@link SwitchConversationHooks.onJoined}; a separate
     * `onPersist` is exposed for callers that want to distinguish
     * "rebind" from "save id" timing.
     */
    onSwitched?: (
        newConversation: ConversationDispatcher,
    ) => void | Promise<void>;
    /**
     * Fires after `onSwitched`, intended for persistence (saving the
     * id to disk). A throw here is logged but does not roll back the
     * switch.
     */
    onPersistSwitched?: (conversationId: string) => void | Promise<void>;
    /**
     * Optional: confirmation prompt for destructive operations
     * (currently only `delete`). Return `true` to proceed, `false` to
     * abort. If omitted, destructive operations proceed without
     * confirmation — the dispatcher's `delete` slash command requires
     * the user to type the name, so this is a defensible default;
     * UIs that want a yes/no prompt (browser, VS Code modal) should
     * supply one.
     */
    confirmDestructive?: (
        action: "delete",
        target: ConversationInfo,
    ) => boolean | Promise<boolean>;
    /**
     * Optional: extra options passed to `connection.joinConversation`
     * for every switch — used by clients that need `clientType`,
     * `filter: false`, etc.
     */
    joinOptions?: Omit<
        Parameters<AgentServerConnection["joinConversation"]>[1] & object,
        "conversationId"
    >;
};

// ── Result discriminator ───────────────────────────────────────────────

/**
 * Discriminated result returned by every manage-* function. The `kind`
 * tag tells the caller how to render it; the inner fields carry the
 * details (names, ids, lists) it needs to format.
 *
 *  - `ok`: success, optionally with a message. `switched=true` when
 *    the active conversation changed (caller may want to replay
 *    history etc.).
 *  - `warning`: user error (missing arg, already-on, no other
 *    conversation, etc.) — non-fatal, do not log loudly.
 *  - `error`: operation failed (network, server reject) — log + surface.
 *  - `list` / `info`: structured data the caller renders to its UI
 *    (table, bullet list, HTML, etc.) instead of a single message.
 *  - `cancelled`: destructive op the user declined.
 */
export type ConversationActionResult =
    | {
          kind: "ok";
          message: string;
          switched?: boolean;
          /** Filled when the op produced or targeted a specific conversation. */
          conversation?: ConversationInfo;
      }
    | {
          kind: "warning";
          message: string;
      }
    | {
          kind: "error";
          message: string;
          cause?: unknown;
      }
    | {
          kind: "list";
          conversations: ConversationInfo[];
          currentConversationId: string | undefined;
      }
    | {
          kind: "info";
          conversationId: string;
          name: string;
      }
    | {
          kind: "cancelled";
          target: ConversationInfo;
      };

// ── Helpers ────────────────────────────────────────────────────────────

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
    return ok(messageOnSuccess, { switched: true, conversation: target });
}

// ── Subcommand handlers ────────────────────────────────────────────────

/**
 * `new` — create a conversation and auto-switch to it. If `name` is
 * absent, generates `formatAutoConversationName()`. On name collision,
 * switches to the existing conversation instead of failing (matches the
 * VS Code extension's existing behavior; browser, shell, and CLI did
 * the same thing slightly differently).
 */
export async function manageNew(
    connection: AgentServerConnection,
    clientIO: ClientIO,
    ctx: ManageConversationContext,
    name?: string,
): Promise<ConversationActionResult> {
    const chosen = name?.trim() || formatAutoConversationName();
    const targetNorm = normalizeConversationName(chosen);

    // Collision check: if a conversation with this name already exists,
    // switch to it instead of producing a duplicate-name error.
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
        // Race with a peer client: re-list and adopt the winner.
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

/**
 * `list` — list all conversations. Returns structured data the caller
 * renders to its UI (table for CLI, `<ul>` for HTML, etc.).
 */
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

/**
 * `info` — show the current conversation. Returns the id and name as
 * structured data.
 */
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

/**
 * `switch` — switch to a conversation by name. Errors on no match
 * (does NOT create-on-miss; that's `new`'s job).
 */
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

/**
 * `prev` / `next` — cycle to the previous / next conversation in
 * creation order (matches `list` ordering). Wraps around at the ends.
 */
export async function manageCycle(
    connection: AgentServerConnection,
    clientIO: ClientIO,
    ctx: ManageConversationContext,
    direction: "prev" | "next",
): Promise<ConversationActionResult> {
    const sorted = sortConversationsByCreatedDesc(
        await connection.listConversations(),
    );
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
 * `rename` — rename either the current conversation (when `name` is
 * absent) or a specific named conversation. Validates collision
 * against other conversations before issuing the server call.
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

    return {
        kind: "ok",
        message:
            oldName !== undefined
                ? `Renamed conversation "${oldName}" to "${trimmedNew}".`
                : `Renamed conversation to "${trimmedNew}".`,
        conversation: {
            conversationId: targetId,
            name: trimmedNew,
            clientCount: 0,
            createdAt: "",
        },
        // Surface whether the rename hit the current conversation so the
        // caller knows whether to refresh its title bar / status.
        ...(isCurrent ? { switched: false } : {}),
    };
}

/**
 * `delete` — delete a conversation by name. Refuses to delete the
 * active conversation. If `ctx.confirmDestructive` is set, prompts
 * for confirmation; otherwise proceeds (matches the dispatcher's
 * `@conversation delete` slash command, which already requires the
 * user to type the name).
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
        const confirmed = await ctx.confirmDestructive("delete", match);
        if (!confirmed) {
            return { kind: "cancelled", target: match };
        }
    }
    try {
        await connection.deleteConversation(match.conversationId);
    } catch (e) {
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

// ── Top-level dispatcher ───────────────────────────────────────────────

/**
 * Dispatch a `manage-conversation` payload to the right subcommand
 * handler. Returns the structured {@link ConversationActionResult} the
 * caller renders to its UI.
 *
 * Most clients call this directly from their ClientIO `takeAction`
 * handler for `action === "manage-conversation"`. Clients that need
 * fine-grained control over each subcommand (different UI per
 * subcommand) can call the manage-* helpers directly instead.
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
