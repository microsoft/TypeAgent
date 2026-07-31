// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ConversationAction =
    | NewConversationAction
    | ListConversationAction
    | FindConversationAction
    | SearchConversationAction
    | IndexConversationAction
    | ShowConversationInfoAction
    | SwitchConversationAction
    | NextConversationAction
    | PrevConversationAction
    | RenameConversationAction
    | DeleteConversationAction
    | HelpConversationAction;

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

// Find existing conversations by approximate name or topic, WITHOUT switching.
// Use this when the user wants to find, search for, or locate a conversation by
// what it was about or roughly what it was named.
// Examples: "find the conversation about the workout playlist", "search my
// conversations for taxes", "which conversation was about the trip to Paris",
// "locate the chat where we discussed the budget".
// IMPORTANT: use switchConversation instead when the user wants to switch to it.
export type FindConversationAction = {
    actionName: "findConversation";
    parameters: {
        // The name or topic to search for
        query: string;
    };
};

// Search the CONTENT of conversations (what was actually said or discussed
// inside them), not their names. Use this when the user wants to search across
// their conversation history for messages, topics, or details that were
// mentioned.
// Examples: "search my conversations for the docker command we used",
// "search conversation content for what we decided about pricing",
// "search my chat history for the API key rotation steps".
// IMPORTANT: use findConversation instead when the user wants to locate a
// conversation by its name/title rather than search what is inside it.
export type SearchConversationAction = {
    actionName: "searchConversation";
    parameters: {
        // The text or topic to search for within conversation content
        query: string;
    };
};

// Index a conversation's history so its content becomes searchable across
// conversations. Use this when the user wants to index, reindex, or make a past
// conversation (or all conversations) searchable - i.e. add older messages that
// aren't in the content-search index yet.
// Examples: "index this conversation", "index all conversations",
// "reindex my conversations", "index the conversation about the Paris trip",
// "make my conversations searchable".
// IMPORTANT: use searchConversation to search existing content; use this only to
// ADD a conversation's history to the index.
export type IndexConversationAction = {
    actionName: "indexConversation";
    parameters: {
        // Which conversation to index: omit for the current conversation, use
        // "all" for every conversation, or give a conversation's name/topic.
        name?: string;
    };
};

// Show information about the current conversation.
// Use this when the user asks about the current conversation info.
// Examples: "show conversation info", "what conversation am I in", "current conversation info".
export type ShowConversationInfoAction = {
    actionName: "showConversationInfo";
};

// Switch to an existing conversation, identified either by its NAME or by what
// was DISCUSSED in it (its content/topic).
// Use this when the user wants to switch to, go to, open, or change to an EXISTING conversation.
// The switch tries an exact name, then a fuzzy name, then a content search over
// the conversations' messages - so "switch to the conversation where we talked
// about spikes" resolves to the conversation whose content is about spikes.
// For "next"/"previous" without a specific target, use NextConversationAction
// or PrevConversationAction instead.
// Examples: "switch to conversation test", "go to my work conversation",
// "switch to test", "open conversation named work", "change to the test conversation",
// "switch to the conversation where we talked about spikes".
// IMPORTANT: use this only when switching to an already-existing conversation, not creating a new one.
export type SwitchConversationAction = {
    actionName: "switchConversation";
    parameters: {
        // The name of the conversation to switch to, or a topic/description of
        // what was discussed in it.
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

// Show help for conversation management: the available conversation commands
// and what they do.
// Use this when the user asks how to manage conversations or what conversation
// commands are available.
// Examples: "conversation help", "help with conversations", "what conversation
// commands are there", "how do I manage conversations".
export type HelpConversationAction = {
    actionName: "help";
};
