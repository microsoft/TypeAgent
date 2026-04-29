// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type TeamsActions =
  | SummarizeChatThreadAction
  | SendChatMessageAction
  | ReplyToMessageAction
  | GetJoinLinkAction
  | FindMessageAction;

// Sample phrases:
//   - "Summarize my chat with Alex."
//   - "Catch me up on the design review thread."
//   - "What did Alex and I talk about yesterday?"
// Fetch the most recent messages from a chat the signed-in user is in and produce a natural-language summary.
export type SummarizeChatThreadAction = {
  actionName: "summarizeChatThread";
  parameters: {
    // original user message
    userRequest?: string;
    // The ID of the chat thread to summarize. Rarely supplied directly; the bridge resolves participantNames into a chatId when omitted.
    chatId?: string;
    // The names or UPNs of the chat participants. Used by the bridge to find an existing chat with those members. Example: ["Alex Lopez"].
    participantNames?: string[];
    // The number of recent messages to include in the summary. Defaults to 50 when omitted.
    messageCount?: number;
  };
};

// Sample phrases:
//   - "Send Alex a Teams message saying I'm running late."
//   - "DM the project team that the deadline moved to Friday."
//   - "Tell Sarah and Bob: meeting moved to 3pm."
// Send a message in a Teams chat the signed-in user is a member of.
export type SendChatMessageAction = {
  actionName: "sendChatMessage";
  parameters: {
    // original user message
    userRequest?: string;
    // Display names, email addresses, or UPNs of the recipients. The bridge calls Graph user search and finds-or-creates a 1:1 or group chat. Use this when the user names people rather than supplying a chatId.
    recipients?: string[];
    // Explicit chat ID. Rarely supplied by users; prefer recipients.
    chatId?: string;
    // The text content of the message to send.
    message: string;
  };
};

// Sample phrases:
//   - "Reply to that message saying 'Got it, thanks!'"
//   - "Reply 'sounds good' to that."
//   - "Respond 'I'll handle it' in this thread."
// Reply to a specific message in a Teams chat. When chatId/messageId are omitted, the bridge resolves "that"/"this thread" against the most recent message in the current chat context.
export type ReplyToMessageAction = {
  actionName: "replyToMessage";
  parameters: {
    // original user message
    userRequest?: string;
    // ID of the chat containing the parent message. Optional — bridge resolves from current context.
    chatId?: string;
    // ID of the parent message being replied to. Optional — bridge resolves from current context.
    messageId?: string;
    // The text content of the reply.
    message: string;
  };
};

// Sample phrases:
//   - "What's the join link for my 3pm meeting?"
//   - "Send me the link for my meeting with Bob."
//   - "Join URL for the standup."
// Retrieve the join URL for an online Teams meeting the signed-in user owns. The bridge resolves meetingDescription against calendar events when meetingId is not supplied.
export type GetJoinLinkAction = {
  actionName: "getJoinLink";
  parameters: {
    // original user message
    userRequest?: string;
    // ID of the online meeting. Rarely supplied by users; prefer meetingDescription.
    meetingId?: string;
    // Description used to find the meeting — subject keywords, time of day, or a participant name. Example: "3pm meeting", "meeting with Bob", "standup".
    meetingDescription?: string;
  };
};

// Sample phrases:
//   - "Search for a message containing 'project update'."
//   - "Look up messages with the keyword 'deadline'."
//   - "Find the message where we discussed the budget."
// Search messages across the signed-in user's chats. Scoped to the user's own chats only — does NOT search organization-wide channel messages.
export type FindMessageAction = {
  actionName: "findMessage";
  parameters: {
    // original user message
    userRequest?: string;
    // The keyword query string to search for.
    query: string;
    // The maximum number of matching messages to return. Defaults to 25 when omitted.
    maxResults?: number;
  };
};
