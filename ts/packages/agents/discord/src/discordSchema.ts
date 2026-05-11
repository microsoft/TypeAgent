// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DiscordActions =
    | CreateMessageAction
    | GetChannelMessagesAction
    | CreateGuildAction
    | GetGuildAction
    | CreateWebhookAction
    | GetWebhookAction
    | ExecuteWebhookAction
    | GetCurrentUserAction
    | GetUserAction
    | ModifyCurrentUserAction
    | GetCurrentUserGuildsAction
    | GetCurrentUserGuildMemberAction
    | LeaveGuildAction
    | CreateDMAction
    | CreateGroupDMAction
    | GetCurrentUserConnectionsAction
    | GetCurrentUserApplicationRoleConnectionAction
    | UpdateCurrentUserApplicationRoleConnectionAction
    | GetInviteAction
    | DeleteInviteAction
    | GetTargetUsersAction
    | UpdateTargetUsersAction
    | GetTargetUsersJobStatusAction
    | GetChannelAction
    | ModifyChannelAction
    | SetVoiceChannelStatusAction
    | DeleteChannelAction
    | EditChannelPermissionsAction
    | GetChannelInvitesAction
    | CreateChannelInviteAction
    | DeleteChannelPermissionAction
    | FollowAnnouncementChannelAction
    | TriggerTypingIndicatorAction
    | GroupDmAddRecipientAction
    | GroupDmRemoveRecipientAction
    | StartThreadFromMessageAction
    | StartThreadWithoutMessageAction
    | StartThreadInForumOrMediaChannelAction
    | JoinThreadAction
    | AddThreadMemberAction
    | LeaveThreadAction
    | RemoveThreadMemberAction
    | GetThreadMemberAction
    | ListThreadMembersAction
    | ListPublicArchivedThreadsAction
    | ListPrivateArchivedThreadsAction
    | ListJoinedPrivateArchivedThreadsAction
    | SetGuildAction
    | ListChannelsAction
    | RefreshChannelsAction;

// Creates a new message in a specified channel.
// Sample phrases:
//   - "Send a message to the general channel saying 'Hello everyone!'"
//   - "Post 'Meeting starts at 3 PM' in the announcements channel, please."
//   - "Can you create a new message in the #updates channel with the text 'New features are live!'?"
export type CreateMessageAction = {
    actionName: "createMessage";
    parameters: {
        // The ID of the channel where the message will be sent.
        channel_id: string;
        // The content of the message.
        content: string;
        // A unique identifier for the message.
        nonce?: string;
        // Whether the message should be sent as text-to-speech.
        tts?: boolean;
    };
};

// Fetches messages from a specified channel.
// Sample phrases:
//   - "Can you show me the latest messages from the channel with ID 12345?"
//   - "Fetch the last 50 messages from the channel 67890, please."
//   - "Get messages from the channel 54321, but only those sent after yesterday."
export type GetChannelMessagesAction = {
    actionName: "getChannelMessages";
    parameters: {
        // The ID of the channel from which to fetch messages.
        channel_id: string;
        // The maximum number of messages to return.
        limit?: number;
        // Get messages before this message ID.
        before?: string;
        // Get messages after this message ID.
        after?: string;
    };
};

// Creates a new guild.
// Sample phrases:
//   - "Can you create a new guild for me called 'Knights of Valor' in the US region with this icon?"
//   - "I need a new guild named 'Dragon Slayers' in the EU region. Use this icon for it."
//   - "Please set up a guild called 'Mystic Warriors' in the Asia region and use this icon."
export type CreateGuildAction = {
    actionName: "createGuild";
    parameters: {
        // The name of the guild.
        name: string;
        // The region where the guild will be created.
        region?: string;
        // The icon for the guild.
        icon?: string;
    };
};

// Fetches a guild object for a given guild ID.
// Sample phrases:
//   - "Can you get the details for the guild with ID 12345?"
//   - "Fetch the guild information for guild ID 67890, please."
//   - "I need the guild object for the guild with ID abcdef."
export type GetGuildAction = {
    actionName: "getGuild";
    parameters: {
        // The ID of the guild to fetch.
        guild_id: string;
    };
};

// Creates a new webhook in a specified channel.
// Sample phrases:
//   - "Can you set up a new webhook in the channel with ID 12345? Name it 'Updates' and use the avatar image from this link."
//   - "Please create a webhook named 'Alerts' in the channel 67890 and use this avatar for it."
//   - "I need a new webhook in channel 54321 called 'Notifications'. Use this avatar image for it."
export type CreateWebhookAction = {
    actionName: "createWebhook";
    parameters: {
        // The ID of the channel where the webhook will be created.
        channel_id: string;
        // The name of the webhook.
        name: string;
        // The avatar for the webhook.
        avatar?: string;
    };
};

// Fetches a webhook object for a given webhook ID.
// Sample phrases:
//   - "Can you fetch the webhook details for ID 12345?"
//   - "I need the webhook information for webhook ID 12345."
//   - "Please get the webhook object for the ID 12345."
export type GetWebhookAction = {
    actionName: "getWebhook";
    parameters: {
        // The ID of the webhook to fetch.
        webhook_id: string;
    };
};

// Executes a webhook, sending a message to the channel.
// Sample phrases:
//   - "Send a message using the webhook with ID 12345 and token abcde. The content should be 'Hello everyone!', and use the username 'Bot' with the avatar URL 'http://example.com/avatar.png'. Make it a TTS message."
//   - "Can you execute the webhook with ID 12345 and token abcde? The message should say 'Hello everyone!', and use the username 'Bot' with the avatar 'http://example.com/avatar.png'. Also, make it a TTS message."
//   - "Please trigger the webhook with ID 12345 and token abcde to send a message saying 'Hello everyone!'. Use 'Bot' as the username and 'http://example.com/avatar.png' as the avatar. Enable TTS for this message."
export type ExecuteWebhookAction = {
    actionName: "executeWebhook";
    parameters: {
        // The ID of the webhook to execute.
        webhook_id: string;
        // The token for the webhook.
        webhook_token: string;
        // The content of the message.
        content?: string;
        // The username to use for the message.
        username?: string;
        // The avatar URL to use for the message.
        avatar_url?: string;
        // Whether the message should be sent as text-to-speech.
        tts?: boolean;
    };
};

// Returns the user object of the requester's account.
// Sample phrases:
//   - "Can you show me my account details?"
//   - "What's my user info?"
//   - "Get my profile information, please."
export type GetCurrentUserAction = {
    actionName: "getCurrentUser";
};

// Returns a user object for a given user ID.
// Sample phrases:
//   - "Can you fetch the user details for ID 123456?"
//   - "I need information on the user with ID 123456."
//   - "Please get me the user object for ID 123456."
export type GetUserAction = {
    actionName: "getUser";
    parameters: {
        // The ID of the user to fetch.
        user_id: string;
    };
};

// Modify the requester's user account settings. Returns a user object on success.
// Sample phrases:
//   - "Can you update my username and profile picture?"
//   - "I'd like to change my username and avatar, please."
//   - "Please modify my account settings with a new username and banner image."
export type ModifyCurrentUserAction = {
    actionName: "modifyCurrentUser";
    parameters?: {
        // The new username for the account.
        username?: string;
        // The new avatar for the account.
        avatar?: string;
        // The new banner image for the account.
        banner?: string;
    };
};

// Returns a list of partial guild objects the current user is a member of.
// Sample phrases:
//   - "Can you show me the servers I'm part of?"
//   - "List all the guilds I'm currently in, please."
//   - "What are the Discord servers I belong to?"
export type GetCurrentUserGuildsAction = {
    actionName: "getCurrentUserGuilds";
    parameters?: {
        // Get guilds before this ID.
        before?: string;
        // Get guilds after this ID.
        after?: string;
        // The maximum number of guilds to return.
        limit?: number;
        // Whether to include member counts.
        with_counts?: boolean;
    };
};

// Returns a guild member object for the current user.
// Sample phrases:
//   - "Can you show me my member details for the server with ID 123456?"
//   - "Get my guild member info for the server 123456, please."
//   - "I need my member object for the guild with ID 123456."
export type GetCurrentUserGuildMemberAction = {
    actionName: "getCurrentUserGuildMember";
    parameters: {
        // The ID of the guild to fetch the member object from.
        guild_id: string;
    };
};

// Leave a guild. Returns a 204 empty response on success.
// Sample phrases:
//   - "I want to leave the server with ID 123456789."
//   - "Please remove me from the guild with ID 123456789."
//   - "Can you help me exit the guild? The ID is 123456789."
export type LeaveGuildAction = {
    actionName: "leaveGuild";
    parameters: {
        // The ID of the guild to leave.
        guild_id: string;
    };
};

// Create a new DM channel with a user. Returns a DM channel object.
// Sample phrases:
//   - "Can you start a direct message with user ID 123456?"
//   - "I'd like to create a DM channel with the user whose ID is 123456."
//   - "Please open a new DM with the user having the ID 123456."
export type CreateDMAction = {
    actionName: "createDM";
    parameters: {
        // The ID of the recipient user.
        recipient_id: string;
    };
};

// Create a new group DM channel with multiple users. Returns a DM channel object.
// Sample phrases:
//   - "Can you start a new group DM with these friends?"
//   - "Create a group chat with these people, please."
//   - "I'd like to set up a group DM with my buddies."
export type CreateGroupDMAction = {
    actionName: "createGroupDM";
    parameters?: {
        // The access tokens for the users to be added to the group DM.
        access_tokens?: string[];
        // Comma-separated nickname mappings (e.g. "userId1:nick1,userId2:nick2").
        nicks?: string;
    };
};

// Returns a list of connection objects.
// Sample phrases:
//   - "Can you show me my current connections?"
//   - "What are my linked accounts right now?"
//   - "I'd like to see my active connections, please."
export type GetCurrentUserConnectionsAction = {
    actionName: "getCurrentUserConnections";
};

// Returns the application role connection for the user.
// Sample phrases:
//   - "Can you show me my role connection for the app with ID 123456?"
//   - "What's my application role connection for the app with ID 123456?"
//   - "Please get my role connection for the application with ID 123456."
export type GetCurrentUserApplicationRoleConnectionAction = {
    actionName: "getCurrentUserApplicationRoleConnection";
    parameters: {
        // The ID of the application to fetch the role connection for.
        application_id: string;
    };
};

// Updates and returns the application role connection for the user.
// Sample phrases:
//   - "Can you update my role connection for the app with my new username?"
//   - "Please change my application role connection details to reflect my updated platform name and username."
//   - "I need to update my role connection for the app. My platform name is [platform_name] and my username is [platform_username]."
export type UpdateCurrentUserApplicationRoleConnectionAction = {
    actionName: "updateCurrentUserApplicationRoleConnection";
    parameters?: {
        // The ID of the application.
        application_id?: string;
        // The new platform name for the role connection.
        platform_name?: string;
        // The new platform username for the role connection.
        platform_username?: string;
        // The metadata for the role connection (JSON string).
        metadata?: string;
    };
};

// Returns an invite object for the given code.
// Sample phrases:
//   - "Can you fetch the invite details for the code ABC123?"
//   - "I need the invite info for code XYZ789, please."
//   - "Get me the invite object for the code DEF456, and include the counts."
export type GetInviteAction = {
    actionName: "getInvite";
    parameters: {
        // The code of the invite to fetch.
        invite_code: string;
        // Whether to include member counts.
        with_counts?: boolean;
        // The ID of the scheduled event for the invite.
        guild_scheduled_event_id?: string;
    };
};

// Delete an invite. Requires the MANAGE_CHANNELS permission on the channel this invite belongs to, or MANAGE_GUILD to remove any invite across the guild.
// Sample phrases:
//   - "Can you delete the invite with code ABC123?"
//   - "Please remove the invite link with the code XYZ789."
//   - "I need you to delete the invite that has the code LMN456."
export type DeleteInviteAction = {
    actionName: "deleteInvite";
    parameters: {
        // The code of the invite to delete.
        invite_code: string;
    };
};

// Gets the users allowed to see and accept this invite. Response is a CSV file with the header user_id and each user ID from the original file passed to invite create on its own line. Requires the caller to be the inviter, or have MANAGE_GUILD permission, or have VIEW_AUDIT_LOG permission.
// Sample phrases:
//   - "Can you show me the list of users who can accept this invite?"
//   - "Get me the users allowed to see this invite, please."
//   - "I need the user IDs for the invite with code [invite.code]."
export type GetTargetUsersAction = {
    actionName: "getTargetUsers";
    parameters: {
        // The code of the invite to fetch target users for.
        invite_code: string;
    };
};

// Updates the users allowed to see and accept this invite. Uploading a file with invalid user IDs will result in a 400 with the invalid IDs described. Requires the caller to be the inviter or have the MANAGE_GUILD permission.
// Sample phrases:
//   - "Can you update the invite with these new target users? Here's the file."
//   - "Please refresh the list of users who can access this invite using this file."
//   - "I'd like to change the allowed users for this invite. Uploading the file now."
export type UpdateTargetUsersAction = {
    actionName: "updateTargetUsers";
    parameters: {
        // The code of the invite to update target users for.
        invite_code: string;
        // The file containing the new target users (file path or URL).
        target_users_file?: string;
    };
};

// Processing target users from a CSV when creating or updating an invite is done asynchronously. This endpoint allows you to check the status of that job. Requires the caller to be the inviter, or have MANAGE_GUILD permission, or have VIEW_AUDIT_LOG permission.
// Sample phrases:
//   - "Can you check the status of the job for the invite with code ABC123?"
//   - "What's the current status of the processing job for the invite code ABC123?"
//   - "Please tell me the job status for the invite code ABC123."
export type GetTargetUsersJobStatusAction = {
    actionName: "getTargetUsersJobStatus";
    parameters: {
        // The code of the invite to check the job status for.
        invite_code: string;
    };
};

// Get a channel by ID. Returns a channel object.
export type GetChannelAction = {
    actionName: "getChannel";
    parameters: {
        // The ID of the channel to fetch.
        channel_id: string;
    };
};

// Update a channel's settings.
export type ModifyChannelAction = {
    actionName: "modifyChannel";
    parameters: {
        // The ID of the channel to modify.
        channel_id: string;
        // The new name for the channel.
        name?: string;
        // The new topic for the channel.
        topic?: string;
        // Whether the channel is NSFW.
        nsfw?: boolean;
    };
};

// Set the status of a voice channel.
export type SetVoiceChannelStatusAction = {
    actionName: "setVoiceChannelStatus";
    parameters: {
        // The ID of the voice channel.
        channel_id: string;
        // The new status for the voice channel.
        status: string;
    };
};

// Delete a channel or close a private message.
export type DeleteChannelAction = {
    actionName: "deleteChannel";
    parameters: {
        // The ID of the channel to delete.
        channel_id: string;
    };
};

// Edit the permissions of a channel.
export type EditChannelPermissionsAction = {
    actionName: "editChannelPermissions";
    parameters: {
        // The ID of the channel.
        channel_id: string;
        // The ID of the overwrite (user or role).
        overwrite_id?: string;
        // The allow permission bitfield.
        allow?: string;
        // The deny permission bitfield.
        deny?: string;
        // The type of the overwrite (0 = role, 1 = member).
        type?: number;
    };
};

// Get all invites for a channel.
export type GetChannelInvitesAction = {
    actionName: "getChannelInvites";
    parameters: {
        // The ID of the channel.
        channel_id: string;
    };
};

// Create a new invite for a channel.
export type CreateChannelInviteAction = {
    actionName: "createChannelInvite";
    parameters: {
        // The ID or name of the channel.
        channel_id: string;
        // Duration of invite in seconds (0 = never expires).
        max_age?: number;
        // If true, the invite never expires (sets max_age to 0).
        never_expires?: boolean;
        // Max number of uses (0 = unlimited).
        max_uses?: number;
        // Whether the invite is temporary.
        temporary?: boolean;
        // Whether the invite is unique.
        unique?: boolean;
    };
};

// Delete a permission overwrite from a channel.
export type DeleteChannelPermissionAction = {
    actionName: "deleteChannelPermission";
    parameters: {
        // The ID of the channel.
        channel_id: string;
        // The ID of the overwrite to delete.
        overwrite_id: string;
    };
};

// Follow an announcement channel to receive crossposted messages.
export type FollowAnnouncementChannelAction = {
    actionName: "followAnnouncementChannel";
    parameters: {
        // The ID of the announcement channel to follow.
        channel_id: string;
        // The ID of the channel to receive crossposted messages.
        webhook_channel_id: string;
    };
};

// Trigger the typing indicator in a channel.
export type TriggerTypingIndicatorAction = {
    actionName: "triggerTypingIndicator";
    parameters: {
        // The ID of the channel.
        channel_id: string;
    };
};

// Add a recipient to a Group DM.
export type GroupDmAddRecipientAction = {
    actionName: "groupDmAddRecipient";
    parameters: {
        // The ID of the group DM channel.
        channel_id: string;
        // The ID of the user to add.
        user_id: string;
        // The access token of the user.
        access_token?: string;
        // The nickname for the user in the group DM.
        nick?: string;
    };
};

// Remove a recipient from a Group DM.
export type GroupDmRemoveRecipientAction = {
    actionName: "groupDmRemoveRecipient";
    parameters: {
        // The ID of the group DM channel.
        channel_id: string;
        // The ID of the user to remove.
        user_id: string;
    };
};

// Start a thread from an existing message.
export type StartThreadFromMessageAction = {
    actionName: "startThreadFromMessage";
    parameters: {
        // The ID of the channel containing the message.
        channel_id: string;
        // The ID of the message to start a thread from.
        message_id: string;
        // The name of the thread.
        name?: string;
    };
};

// Start a thread without an existing message.
export type StartThreadWithoutMessageAction = {
    actionName: "startThreadWithoutMessage";
    parameters: {
        // The ID of the channel to start the thread in.
        channel_id: string;
        // The name of the thread.
        name: string;
        // Duration in minutes to automatically archive the thread.
        auto_archive_duration?: number;
        // The type of thread to create.
        type?: number;
    };
};

// Start a thread in a forum or media channel.
export type StartThreadInForumOrMediaChannelAction = {
    actionName: "startThreadInForumOrMediaChannel";
    parameters: {
        // The ID of the forum or media channel.
        channel_id: string;
        // The name of the thread.
        name: string;
        // The initial message for the thread.
        message?: string;
    };
};

// Join a thread.
export type JoinThreadAction = {
    actionName: "joinThread";
    parameters: {
        // The ID of the thread to join.
        channel_id: string;
    };
};

// Add another member to a thread.
export type AddThreadMemberAction = {
    actionName: "addThreadMember";
    parameters: {
        // The ID of the thread.
        channel_id: string;
        // The ID of the user to add.
        user_id: string;
    };
};

// Leave a thread.
export type LeaveThreadAction = {
    actionName: "leaveThread";
    parameters: {
        // The ID of the thread to leave.
        channel_id: string;
    };
};

// Remove another member from a thread.
export type RemoveThreadMemberAction = {
    actionName: "removeThreadMember";
    parameters: {
        // The ID of the thread.
        channel_id: string;
        // The ID of the user to remove.
        user_id: string;
    };
};

// Get a thread member.
export type GetThreadMemberAction = {
    actionName: "getThreadMember";
    parameters: {
        // The ID of the thread.
        channel_id: string;
        // The ID of the user.
        user_id: string;
    };
};

// List members of a thread.
export type ListThreadMembersAction = {
    actionName: "listThreadMembers";
    parameters: {
        // The ID of the thread.
        channel_id: string;
    };
};

// List public archived threads in a channel.
export type ListPublicArchivedThreadsAction = {
    actionName: "listPublicArchivedThreads";
    parameters: {
        // The ID of the channel.
        channel_id: string;
        // Returns threads before this timestamp.
        before?: string;
        // Maximum number of threads to return.
        limit?: number;
    };
};

// List private archived threads in a channel.
export type ListPrivateArchivedThreadsAction = {
    actionName: "listPrivateArchivedThreads";
    parameters: {
        // The ID of the channel.
        channel_id: string;
        // Returns threads before this timestamp.
        before?: string;
        // Maximum number of threads to return.
        limit?: number;
    };
};

// List private archived threads joined by the current user.
export type ListJoinedPrivateArchivedThreadsAction = {
    actionName: "listJoinedPrivateArchivedThreads";
    parameters: {
        // The ID of the channel.
        channel_id: string;
        // Returns threads before this timestamp.
        before?: string;
        // Maximum number of threads to return.
        limit?: number;
    };
};

// Set the default Discord server (guild) for all operations.
export type SetGuildAction = {
    actionName: "setGuild";
    parameters: {
        // The Discord server ID to use as default
        guild_id: string;
    };
};

// List all channels in the current Discord server.
export type ListChannelsAction = {
    actionName: "listChannels";
};

// Refresh the channel cache from the Discord server.
export type RefreshChannelsAction = {
    actionName: "refreshChannels";
};
