// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type VSCodeConversationActions =
    | NewConversationAction
    | RenameConversationAction
    | SwitchConversationAction
    | DeleteConversationAction;

// Create a brand-new TypeAgent Shell conversation (a new chat tab in the
// TypeAgent Shell VS Code extension) and switch the current tab to it.
//
// Example:
// User: start a new conversation
// Agent: { actionName: "newConversation", parameters: {} }
//
// Example:
// User: new conversation called "design review"
// Agent: { actionName: "newConversation", parameters: { name: "design review" } }
export type NewConversationAction = {
    actionName: "newConversation";
    parameters: {
        // Optional display name for the new conversation. If omitted,
        // the user will be prompted in the extension UI.
        name?: string;
    };
};

// Rename the TypeAgent Shell conversation that is currently active in
// this chat tab.
//
// Example:
// User: rename this conversation to "vscode shell PR"
// Agent: { actionName: "renameConversation", parameters: { newName: "vscode shell PR" } }
export type RenameConversationAction = {
    actionName: "renameConversation";
    parameters: {
        // The new display name to apply to the current conversation.
        newName: string;
    };
};

// Switch the current TypeAgent Shell chat tab to a different existing
// conversation, identified by its display name. If no conversation with
// that name exists, a new one will be created with that name and the
// current tab will switch to it.
//
// Example:
// User: switch to the "design review" conversation
// Agent: { actionName: "switchConversation", parameters: { name: "design review" } }
//
// Example:
// User: switch conversation
// Agent: { actionName: "switchConversation", parameters: {} }
export type SwitchConversationAction = {
    actionName: "switchConversation";
    parameters: {
        // The display name of the conversation to switch to. If omitted,
        // the user will be shown a picker in the extension UI. If the
        // named conversation does not exist, a new one will be created.
        name?: string;
    };
};

// Delete a TypeAgent Shell conversation by display name. The current
// active conversation cannot be deleted. The extension will prompt the
// user for confirmation before deleting.
//
// Example:
// User: delete the "design review" conversation
// Agent: { actionName: "deleteConversation", parameters: { name: "design review" } }
//
// Example:
// User: delete a conversation
// Agent: { actionName: "deleteConversation", parameters: {} }
export type DeleteConversationAction = {
    actionName: "deleteConversation";
    parameters: {
        // The display name of the conversation to delete. If omitted,
        // the user will be shown a picker in the extension UI.
        name?: string;
    };
};
