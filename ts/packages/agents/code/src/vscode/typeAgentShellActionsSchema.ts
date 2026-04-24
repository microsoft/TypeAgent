// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type TypeAgentShellActions =
    | NewConversationAction
    | RenameConversationAction
    | SwitchConversationAction;

// Create a brand-new conversation in the TypeAgent Shell extension and
// switch the originating tab to it. Use when the user asks to start a
// new chat / new conversation / open a fresh conversation.
export type NewConversationAction = {
    actionName: "newConversation";
    parameters: {
        // Optional name for the new conversation. If omitted, the user
        // will be prompted for a name in the extension UI.
        name?: string;
    };
};

// Rename the conversation that is currently active in the originating
// tab. Use when the user asks to "rename this conversation" or similar.
export type RenameConversationAction = {
    actionName: "renameConversation";
    parameters: {
        // The new name to apply to the current conversation.
        newName: string;
    };
};

// Switch the originating tab to an existing conversation, identified by
// its display name. Use when the user asks to "switch to conversation X"
// or "open the X conversation". If no name is provided, the extension
// will show a picker.
export type SwitchConversationAction = {
    actionName: "switchConversation";
    parameters: {
        // The display name of the conversation to switch to.
        name?: string;
    };
};
