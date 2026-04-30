// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Payload for the "manage-conversation" client action, dispatched from
 * both the natural-language conversation action handler and the
 * @conversation command handlers.  Clients (Shell, CLI) read this to
 * render the appropriate result.
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
