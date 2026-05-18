// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// User-tunable configuration for the OS notifications agent. Stored on the
// agent context; future work will wire this through the dispatcher's
// per-agent config plumbing so users can edit it via @config.
export type OsNotificationsConfig = {
    // How forwarded notifications render in chat clients.
    //   - "toast"  : ephemeral toast/notification chrome (default)
    //   - "inline" : inserted as an inline chat bubble
    //   - "info"   : surfaced as an Info-style entry (CLI-friendly)
    mode: "toast" | "inline" | "info";

    // Routing target.
    //   - "broadcast"   : send to every connected client (v1 default)
    //   - "currentOnly" : send only to the conversation the user is in
    //                     (TODO: dispatcher needs a "focused conversation"
    //                     signal — falls back to broadcast for now)
    routing: "broadcast" | "currentOnly";

    // If true, drop the notification body and forward title + app only.
    redactBody: boolean;

    // Hard cap on body length when redactBody is false. Truncated with an
    // ellipsis. Title is never truncated.
    bodyMaxChars: number;

    // App-name allowlist. When set and non-empty, only matching apps are
    // forwarded. Match is case-insensitive equality on the app/sender field.
    allowList?: string[];

    // App-name blocklist. Matched apps are dropped. Ignored when allowList
    // is set (allowList wins).
    blockList?: string[];

    // Maximum notifications forwarded per rolling 60-second window. Excess
    // are silently dropped.
    maxPerMinute: number;
};

export const defaultOsNotificationsConfig: OsNotificationsConfig = {
    mode: "toast",
    routing: "broadcast",
    redactBody: false,
    bodyMaxChars: 200,
    maxPerMinute: 20,
};
