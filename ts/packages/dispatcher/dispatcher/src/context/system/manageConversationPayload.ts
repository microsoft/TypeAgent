// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Payload for the "manage-conversation" client action, built by the
 * @conversation command handlers and forwarded to the client (Shell, CLI),
 * which performs the switch/rename/etc.  The natural-language conversation
 * actions run these commands, so this payload is constructed in one place.
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
        | "delete"
        | "find"
        | "search"
        | "help";
    name?: string;
    newName?: string;
    /** Search term for the `find` (by name) and `search` (by content) subcommands. */
    query?: string;
    /** Optional cap on `find` / `search` results. */
    maxMatches?: number;
};
