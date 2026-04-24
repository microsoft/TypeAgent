// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type TypeAgentShellActions =
    | NewConversationAction
    | RenameConversationAction
    | SwitchConversationAction;

// Create a brand-new TypeAgent Shell conversation (a new chat tab in
// the TypeAgent Shell VSCode extension) and switch the current tab to
// it. Use ONLY for managing TypeAgent Shell conversation tabs — do NOT
// use for opening files, launching programs, web browsing, onboarding
// scaffolds, or anything outside the TypeAgent Shell chat itself.
//
// Trigger phrases include: "new conversation", "create a conversation",
// "start a new chat", "open a new chat", "make a new conversation
// named X", "new TypeAgent conversation".
export type NewConversationAction = {
    actionName: "newConversation";
    parameters: {
        // Optional display name for the new conversation. If omitted,
        // the user will be prompted in the extension UI.
        name?: string;
    };
};

// Rename the TypeAgent Shell conversation that is currently active in
// this chat tab. Use ONLY for renaming the current TypeAgent Shell
// conversation — do NOT use for renaming files, variables, etc.
//
// Trigger phrases include: "rename this conversation", "rename the
// current conversation", "change the conversation name to X", "call
// this conversation X", "rename this chat".
export type RenameConversationAction = {
    actionName: "renameConversation";
    parameters: {
        // The new display name to apply to the current conversation.
        newName: string;
    };
};

// Switch the current TypeAgent Shell chat tab to a different existing
// conversation, identified by its display name. Use ONLY for switching
// between TypeAgent Shell conversations — do NOT use for switching
// browser tabs, editor tabs, windows, or workspaces.
//
// Trigger phrases include: "switch to conversation X", "open the X
// conversation", "go to the X chat", "switch conversation to X",
// "switch chat".
export type SwitchConversationAction = {
    actionName: "switchConversation";
    parameters: {
        // The display name of the conversation to switch to. If omitted,
        // the user will be shown a picker in the extension UI.
        name?: string;
    };
};
