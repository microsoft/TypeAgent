// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ConversationAction =
    | NewConversationAction
    | ListConversationAction
    | ShowConversationInfoAction
    | SwitchConversationAction
    | NextConversationAction
    | PrevConversationAction
    | RenameConversationAction
    | DeleteConversationAction;

// Create a new conversation and optionally give it a name.
// Use this when the user wants to create, start, make, or open a brand-new conversation.
// Examples: "create a new conversation", "start a new conversation called test",
// "make a new conversation", "new conversation named work", "open a new conversation test".
// IMPORTANT: use this only when the user is creating something new, not switching to an existing one.
export type NewConversationAction = {
    actionName: "newConversation";
    parameters: {
        // Optional name for the new conversation
        name?: string;
    };
};

// List all conversations in this TypeAgent shell session.
// Use this when the user wants to see, show, or list their TypeAgent conversations
// (NOT files, songs, or any other kind of list).
// Examples: "list our conversations", "list my conversations", "show all conversations",
// "what conversations do I have", "show me my conversations", "show conversation list".
export type ListConversationAction = {
    actionName: "listConversation";
};

// Show information about the current conversation.
// Use this when the user asks about the current conversation info.
// Examples: "show conversation info", "what conversation am I in", "current conversation info".
export type ShowConversationInfoAction = {
    actionName: "showConversationInfo";
};

// Switch to an existing conversation by name.
// Use this when the user wants to switch to, go to, open, or change to an EXISTING conversation
// identified by name.  For "next"/"previous" without a specific name, use NextConversationAction
// or PrevConversationAction instead.
// Examples: "switch to conversation test", "go to my work conversation",
// "switch to test", "open conversation named work", "change to the test conversation".
// IMPORTANT: use this only when switching to an already-existing conversation, not creating a new one.
export type SwitchConversationAction = {
    actionName: "switchConversation";
    parameters: {
        // The name of the conversation to switch to
        name: string;
    };
};

// Switch to the NEXT TypeAgent conversation in the list (cycles around).
// Use this when the user wants to advance to the next TypeAgent shell conversation
// (NOT the next song, next track, next page, or any other kind of "next").
// Examples: "switch to next conversation", "next conversation", "go to the next conversation",
// "cycle to the next conversation".
export type NextConversationAction = {
    actionName: "nextConversation";
};

// Switch to the PREVIOUS TypeAgent conversation in the list (cycles around).
// Use this when the user wants to go to the previous TypeAgent shell conversation
// (NOT the previous song, previous track, or any other kind of "previous").
// Examples: "switch to previous conversation", "previous conversation",
// "go to the previous conversation", "cycle to the previous conversation".
export type PrevConversationAction = {
    actionName: "prevConversation";
};

// Rename a conversation.
// Use this when the user wants to rename, relabel, or give a new name to a conversation.
// If the user specifies which conversation to rename, capture it as 'name'.
// If the user only says "rename this conversation" or "rename current conversation", omit 'name'.
// Examples: "rename this conversation to work", "rename test7 to test5",
// "call this conversation research", "rename current conversation to my project".
export type RenameConversationAction = {
    actionName: "renameConversation";
    parameters: {
        // Optional: the current name of the conversation to rename. Omit to rename the active conversation.
        name?: string;
        // The new name for the conversation
        newName: string;
    };
};

// Delete a conversation by name.
// Use this when the user wants to remove, delete, or destroy a conversation.
// Examples: "delete conversation test", "remove the work conversation", "delete test2".
export type DeleteConversationAction = {
    actionName: "deleteConversation";
    parameters: {
        // The name of the conversation to delete
        name: string;
    };
};
