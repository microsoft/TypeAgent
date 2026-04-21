// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SessionAction =
    | NewSessionAction
    | ListSessionAction
    | ShowConversationInfoAction
    | SwitchSessionAction
    | RenameSessionAction
    | DeleteSessionAction;

// Create a new session/conversation and optionally give it a name.
// Use this when the user wants to create, start, make, or open a brand-new conversation.
// Examples: "create a new conversation", "start a new conversation called test",
// "make a new session", "new conversation named work", "open a new conversation test".
// IMPORTANT: use this only when the user is creating something new, not switching to an existing one.
export type NewSessionAction = {
    actionName: "newSession";
    parameters: {
        // Optional name for the new session
        name?: string;
    };
};

// List all sessions/conversations.
// Use this when the user wants to see, show, or list their conversations or sessions.
// Examples: "list our conversations", "show all conversations", "what conversations do I have",
// "show me my sessions".
export type ListSessionAction = {
    actionName: "listSession";
};

// Show information about the current conversation.
// Use this when the user asks about the current conversation or session info.
// Examples: "show conversation info", "what conversation am I in", "current session info".
export type ShowConversationInfoAction = {
    actionName: "showConversationInfo";
};

// Switch to an existing session/conversation by name.
// Use this when the user wants to switch to, go to, open, or change to an EXISTING conversation.
// Examples: "switch to conversation test", "go to my work conversation",
// "switch to test", "open conversation named work", "change to the test session".
// IMPORTANT: use this only when switching to an already-existing conversation, not creating a new one.
export type SwitchSessionAction = {
    actionName: "switchSession";
    parameters: {
        // The name of the session/conversation to switch to
        name: string;
    };
};

// Rename a session/conversation.
// Use this when the user wants to rename, relabel, or give a new name to a conversation.
// If the user specifies which conversation to rename, capture it as 'name'.
// If the user only says "rename this conversation" or "rename current session", omit 'name'.
// Examples: "rename this conversation to work", "rename test7 to test5",
// "call this conversation research", "rename current session to my project".
export type RenameSessionAction = {
    actionName: "renameSession";
    parameters: {
        // Optional: the current name of the session to rename. Omit to rename the active session.
        name?: string;
        // The new name for the session/conversation
        newName: string;
    };
};

// Delete a session/conversation by name.
// Use this when the user wants to remove, delete, or destroy a conversation.
// Examples: "delete conversation test", "remove the work session", "delete test2".
export type DeleteSessionAction = {
    actionName: "deleteSession";
    parameters: {
        // The name of the session/conversation to delete
        name: string;
    };
};
