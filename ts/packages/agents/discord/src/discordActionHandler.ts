// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    TypeAgentAction,
    ActionResult,
    SessionContext,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import { ChatModel, openai } from "@typeagent/aiclient";
import { DiscordActions } from "./discordSchema.js";

const DISCORD_API = "https://discord.com/api/v10";
const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes
const ENCODING = "utf8" as const;

// Discord channel type sets — used by fetchAndCacheChannels
const TEXT_TYPES = new Set([0, 5]); // text and announcement channels
const MESSAGEABLE_TYPES = new Set([0, 5, 10, 11, 12, 15]); // types you can send messages to

interface DiscordAgentContext {
    guildId: string | undefined;
    channels: Map<string, string>; // channel name (lowercase) → channel ID
    channelList: DiscordChannel[]; // raw channel data for display
    channelsLastFetched: number;
    pollHandle: ReturnType<typeof setInterval> | undefined;
    craftMessageModel: ChatModel | undefined;
}

interface DiscordChannel {
    id: string;
    name?: string;
    type: number;
    parent_id?: string;
    position?: number;
}

const GUILD_NOT_SET_MESSAGE = `To get started, I need your Discord server ID.

To find it:
1. Open Discord and enable Developer Mode: **Settings → Advanced → Developer Mode**
2. Right-click your server name in the left sidebar
3. Click **"Copy Server ID"**

Then tell me: "set my discord server to YOUR_SERVER_ID"`;

export function instantiate(): AppAgent {
    return {
        initializeAgentContext,
        updateAgentContext,
        executeAction,
    };
}

async function initializeAgentContext(): Promise<DiscordAgentContext> {
    // Storage is not available at init time — loaded lazily on first action
    return {
        guildId: undefined,
        channels: new Map(),
        channelList: [],
        channelsLastFetched: 0,
        pollHandle: undefined,
        craftMessageModel: undefined,
    };
}

async function loadFromStorage(
    agentContext: DiscordAgentContext,
    sessionContext: SessionContext,
): Promise<void> {
    if (agentContext.guildId !== undefined) return; // already loaded
    const storage = sessionContext.sessionStorage;
    if (!storage) return;

    try {
        const guildId = await storage.read("guildId", ENCODING);
        if (guildId) agentContext.guildId = guildId;
    } catch {
        /* not set yet */
    }

    try {
        const channelsRaw = await storage.read("channels", ENCODING);
        if (channelsRaw) {
            const parsed = JSON.parse(channelsRaw) as [string, string][];
            agentContext.channels = new Map(parsed);
        }
    } catch {
        /* ignore corrupt cache */
    }

    try {
        const channelListRaw = await storage.read("channelList", ENCODING);
        if (channelListRaw) {
            agentContext.channelList = JSON.parse(
                channelListRaw,
            ) as DiscordChannel[];
        }
    } catch {
        /* ignore corrupt cache */
    }

    try {
        const ts = await storage.read("channelsLastFetched", ENCODING);
        if (ts) agentContext.channelsLastFetched = Number(ts);
    } catch {
        /* ignore */
    }
}

async function updateAgentContext(
    enable: boolean,
    context: SessionContext,
    _schemaName: string,
): Promise<void> {
    const agentContext = context.agentContext as DiscordAgentContext;
    if (enable) {
        await loadFromStorage(agentContext, context);
        if (agentContext.guildId && !agentContext.pollHandle) {
            agentContext.pollHandle = setInterval(() => {
                if (agentContext.guildId) {
                    fetchAndCacheChannels(
                        agentContext.guildId,
                        agentContext,
                        context,
                    ).catch(() => {
                        /* silently ignore polling errors */
                    });
                }
            }, POLL_INTERVAL);
        }
    } else {
        if (agentContext.pollHandle) {
            clearInterval(agentContext.pollHandle);
            agentContext.pollHandle = undefined;
        }
    }
}

async function discordFetch(
    path: string,
    options: RequestInit = {},
): Promise<Response> {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
        throw new Error(
            "DISCORD_BOT_TOKEN is not set. Please add it to ts/.env.",
        );
    }
    const headers: Record<string, string> = {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string>),
    };
    const response = await fetch(`${DISCORD_API}${path}`, {
        ...options,
        headers,
    });
    if (!response.ok) {
        let errorMessage = `Discord API error: ${response.status}`;
        try {
            const errorBody = (await response.json()) as Record<
                string,
                unknown
            >;
            if (typeof errorBody.message === "string") {
                errorMessage = errorBody.message;
            }
        } catch {
            /* ignore parse errors */
        }
        throw new Error(errorMessage);
    }
    return response;
}

async function fetchAndCacheChannels(
    guildId: string,
    agentContext: DiscordAgentContext,
    context: SessionContext,
): Promise<void> {
    const response = await discordFetch(`/guilds/${guildId}/channels`);
    const channelsData = (await response.json()) as DiscordChannel[];
    const channelMap = new Map<string, string>();

    // First pass: store type-qualified keys for all channels (used by resolveChannelId)
    for (const ch of channelsData) {
        if (ch.name) {
            channelMap.set(`${ch.name.toLowerCase()}:${ch.type}`, ch.id);
        }
    }

    // Second pass: store plain name keys only for messageable channels,
    // preferring text (type 0, 5) over other messageable types
    for (const ch of channelsData) {
        if (!ch.name || !MESSAGEABLE_TYPES.has(ch.type)) continue;
        const nameKey = ch.name.toLowerCase();
        const existing = channelMap.get(nameKey);
        if (!existing || TEXT_TYPES.has(ch.type)) {
            channelMap.set(nameKey, ch.id);
        }
    }
    agentContext.channels = channelMap;
    agentContext.channelList = channelsData;
    agentContext.channelsLastFetched = Date.now();
    const storage = context.sessionStorage;
    if (storage) {
        await storage.write(
            "channels",
            JSON.stringify(Array.from(channelMap.entries())),
        );
        await storage.write("channelList", JSON.stringify(channelsData));
        await storage.write(
            "channelsLastFetched",
            String(agentContext.channelsLastFetched),
        );
    }
}

async function resolveChannelId(
    nameOrId: string,
    agentContext: DiscordAgentContext,
    context: SessionContext,
): Promise<string> {
    if (/^\d+$/.test(nameOrId)) return nameOrId;

    // Check if user specified a channel type prefix, e.g. "voice channel general"
    // or "text channel general"
    let name = nameOrId.toLowerCase().replace(/^#/, "");
    let typeKey: string | undefined;
    if (name.startsWith("voice ")) {
        name = name.replace(/^voice\s+/, "");
        typeKey = `${name}:2`; // voice channel type
    } else if (name.startsWith("text ")) {
        name = name.replace(/^text\s+/, "");
        typeKey = `${name}:0`; // text channel type
    }

    const lookupKey = typeKey ?? name;

    const cached = agentContext.channels.get(lookupKey);
    if (cached) return cached;

    // Refresh and try again
    if (agentContext.guildId) {
        await fetchAndCacheChannels(
            agentContext.guildId,
            agentContext,
            context,
        );
        const refreshed = agentContext.channels.get(lookupKey);
        if (refreshed) return refreshed;
    }

    const known = Array.from(agentContext.channels.keys())
        .filter((k) => !k.includes(":")) // only show plain name keys
        .sort()
        .map((k) => `#${k}`);
    const knownList =
        known.length > 0
            ? `Known channels: ${known.join(", ")}`
            : "No channels cached yet.";
    throw new Error(`Channel "${nameOrId}" not found. ${knownList}`);
}

const GUILD_REQUIRED_ACTIONS = new Set([
    "createMessage",
    "craftMessage",
    "getChannelMessages",
    "listChannels",
    "refreshChannels",
    "createChannelInvite",
]);

function needsGuild(actionName: string): boolean {
    return GUILD_REQUIRED_ACTIONS.has(actionName);
}

// LLM occasionally returns extra words after the channel; keep the first
// token and fold the rest back into the user intent.
function splitChannelToken(raw: string): { channel: string; rest: string } {
    const trimmed = raw.trim();
    const spaceIdx = trimmed.search(/\s/);
    if (spaceIdx === -1) {
        return { channel: trimmed, rest: "" };
    }
    return {
        channel: trimmed.slice(0, spaceIdx),
        rest: trimmed.slice(spaceIdx + 1).trim(),
    };
}

async function craftMessageContent(
    intent: string,
    channelName: string,
    agentContext: DiscordAgentContext,
): Promise<string> {
    agentContext.craftMessageModel ??= openai.createChatModel(
        undefined,
        undefined,
        undefined,
        ["discord:craftMessage"],
    );
    const chatModel = agentContext.craftMessageModel;
    const prompt = [
        "You are drafting a Discord chat message on behalf of a user.",
        `Target channel: #${channelName}`,
        `User intent: ${intent}`,
        "",
        "Write the message body ONLY — no quotes, no preamble, no explanation,",
        "no signature. Keep the tone natural and conversational, suitable for",
        "a Discord channel. Length should fit the intent (usually 1-3 short",
        "sentences). You may use plain Discord-friendly markdown and emoji",
        "when it improves the message, but do not overdo it.",
    ].join("\n");

    const result = await chatModel.complete(prompt);
    if (!result.success) {
        throw new Error(`Failed to craft message: ${result.message}`);
    }

    let content = result.data.trim();
    // Strip a single layer of wrapping quotes the model sometimes adds.
    if (
        (content.startsWith('"') && content.endsWith('"')) ||
        (content.startsWith("'") && content.endsWith("'")) ||
        (content.startsWith("“") && content.endsWith("”"))
    ) {
        content = content.slice(1, -1).trim();
    }
    if (!content) {
        throw new Error("LLM returned empty content for the message.");
    }
    return content;
}

async function executeAction(
    action: TypeAgentAction<DiscordActions>,
    context: ActionContext<DiscordAgentContext>,
): Promise<ActionResult> {
    const sessionContext = context.sessionContext;
    const agentContext = sessionContext.agentContext as DiscordAgentContext;

    // Lazily load persisted state on first action
    await loadFromStorage(agentContext, sessionContext);

    try {
        if (action.actionName === "setGuild") {
            const { guild_id } = action.parameters;
            agentContext.guildId = guild_id;
            await sessionContext.sessionStorage?.write("guildId", guild_id);
            await fetchAndCacheChannels(guild_id, agentContext, sessionContext);
            if (!agentContext.pollHandle) {
                agentContext.pollHandle = setInterval(() => {
                    if (agentContext.guildId) {
                        fetchAndCacheChannels(
                            agentContext.guildId,
                            agentContext,
                            sessionContext,
                        ).catch(() => {
                            /* silently ignore polling errors */
                        });
                    }
                }, POLL_INTERVAL);
            }
            const channelList = Array.from(agentContext.channels.keys())
                .filter((k) => !k.includes(":"))
                .sort()
                .map((n) => `  • ${n}`)
                .join("\n");
            const channelCount = Array.from(
                agentContext.channels.keys(),
            ).filter((k) => !k.includes(":")).length;
            return createActionResultFromTextDisplay(
                `Discord server set! Found ${channelCount} channels:\n${channelList}`,
            );
        }

        if (needsGuild(action.actionName) && !agentContext.guildId) {
            return createActionResultFromTextDisplay(GUILD_NOT_SET_MESSAGE);
        }

        switch (action.actionName) {
            case "createMessage": {
                const { content, tts, nonce } = action.parameters;
                const { channel } = splitChannelToken(
                    action.parameters.channel_id,
                );
                const resolvedId = await resolveChannelId(
                    channel,
                    agentContext,
                    sessionContext,
                );
                const body: Record<string, unknown> = { content };
                if (tts !== undefined) body.tts = tts;
                if (nonce !== undefined) body.nonce = nonce;
                const response = await discordFetch(
                    `/channels/${resolvedId}/messages`,
                    { method: "POST", body: JSON.stringify(body) },
                );
                const msg = (await response.json()) as { id: string };
                return createActionResultFromTextDisplay(
                    `Message sent! ID: ${msg.id} in #${channel.replace(/^#/, "")}`,
                );
            }
            case "craftMessage": {
                const { intent, tts } = action.parameters;
                const { channel, rest } = splitChannelToken(
                    action.parameters.channel_id,
                );
                const resolvedId = await resolveChannelId(
                    channel,
                    agentContext,
                    sessionContext,
                );
                const channelName = channel.replace(/^#/, "");
                const fullIntent = rest ? `${rest} ${intent}`.trim() : intent;
                const content = await craftMessageContent(
                    fullIntent,
                    channelName,
                    agentContext,
                );
                const body: Record<string, unknown> = { content };
                if (tts !== undefined) body.tts = tts;
                const response = await discordFetch(
                    `/channels/${resolvedId}/messages`,
                    { method: "POST", body: JSON.stringify(body) },
                );
                const msg = (await response.json()) as { id: string };
                return createActionResultFromTextDisplay(
                    `Crafted and sent to #${channelName} (ID: ${msg.id}):\n${content}`,
                );
            }
            case "getChannelMessages": {
                const { channel_id, before, after } = action.parameters;
                const resolvedId = await resolveChannelId(
                    channel_id,
                    agentContext,
                    sessionContext,
                );
                const limit = Math.min(action.parameters.limit ?? 10, 100);
                const params = new URLSearchParams({ limit: String(limit) });
                if (before) params.set("before", before);
                if (after) params.set("after", after);
                const response = await discordFetch(
                    `/channels/${resolvedId}/messages?${params}`,
                );
                // Discord system message types and their human-readable descriptions
                const SYSTEM_MESSAGE_TYPES: Record<number, string> = {
                    1: "pinned a message",
                    2: "added a member",
                    3: "removed a member",
                    4: "renamed the channel",
                    5: "pinned a message",
                    6: "added a member",
                    7: "joined the server",
                    8: "boosted the server",
                    9: "boosted the server to level 1",
                    10: "boosted the server to level 2",
                    11: "boosted the server to level 3",
                    12: "added a channel to this channel",
                    14: "is waving",
                    19: "replied to a message",
                    20: "used an application command",
                    23: "started a thread",
                    24: "started an activity",
                };
                interface DiscordMessage {
                    id: string;
                    timestamp: string;
                    content: string;
                    type: number;
                    author?: { username: string };
                }
                const messages = (await response.json()) as DiscordMessage[];
                const allEmpty =
                    messages.length > 0 &&
                    messages.every(
                        (m) =>
                            !m.content?.trim() &&
                            !(m.type in SYSTEM_MESSAGE_TYPES),
                    );
                if (allEmpty) {
                    return createActionResultFromTextDisplay(
                        `Retrieved ${messages.length} message(s) but all have empty content.\n\n` +
                            `This usually means the bot is missing the MESSAGE_CONTENT privileged intent.\n\n` +
                            `To fix:\n` +
                            `1. Go to https://discord.com/developers/applications\n` +
                            `2. Select your bot → Bot → Privileged Gateway Intents\n` +
                            `3. Enable "Message Content Intent"\n` +
                            `4. Save and restart the bot`,
                    );
                }
                const display = messages.slice(0, 10).map((m) => {
                    let content = m.content?.trim() ?? "";
                    if (!content) {
                        content = SYSTEM_MESSAGE_TYPES[m.type]
                            ? `[${SYSTEM_MESSAGE_TYPES[m.type]}]`
                            : "[no content]";
                    } else if (content.length > 100) {
                        content = content.slice(0, 100) + "…";
                    }
                    const ts = new Date(m.timestamp).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        hour12: true,
                    });
                    return `[${ts}] ${m.author?.username ?? "unknown"}: ${content}`;
                });
                return createActionResultFromTextDisplay(
                    display.length > 0
                        ? display.join("\n")
                        : "No messages found.",
                );
            }
            case "getCurrentUser": {
                const response = await discordFetch("/users/@me");
                const user = (await response.json()) as {
                    username: string;
                    discriminator: string;
                    id: string;
                };
                return createActionResultFromTextDisplay(
                    `Bot user: ${user.username}#${user.discriminator} (ID: ${user.id})`,
                );
            }
            case "listChannels": {
                if (
                    agentContext.channelList.length === 0 &&
                    agentContext.guildId
                ) {
                    await fetchAndCacheChannels(
                        agentContext.guildId,
                        agentContext,
                        sessionContext,
                    );
                }

                const TYPE_LABELS: Record<number, string> = {
                    0: "text",
                    2: "voice",
                    5: "announcement",
                    10: "thread",
                    11: "thread",
                    12: "thread",
                    13: "stage",
                    15: "forum",
                    16: "media",
                };

                const all = agentContext.channelList;
                // Categories (type 4), sorted by position
                const categories = all
                    .filter((ch) => ch.type === 4)
                    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
                // Non-category channels grouped by parent_id
                const byParent = new Map<
                    string | undefined,
                    DiscordChannel[]
                >();
                for (const ch of all) {
                    if (ch.type === 4) continue;
                    const key = ch.parent_id;
                    if (!byParent.has(key)) byParent.set(key, []);
                    byParent.get(key)!.push(ch);
                }
                // Sort each group by position
                for (const group of byParent.values()) {
                    group.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
                }

                const lines: string[] = [];
                // Uncategorized channels first
                for (const ch of byParent.get(undefined) ?? []) {
                    const label = TYPE_LABELS[ch.type] ?? `type-${ch.type}`;
                    lines.push(`  • ${ch.name} (${label})`);
                }
                // Each category and its children
                for (const cat of categories) {
                    lines.push(`\n  ${cat.name?.toUpperCase() ?? cat.id}`);
                    for (const ch of byParent.get(cat.id) ?? []) {
                        const label = TYPE_LABELS[ch.type] ?? `type-${ch.type}`;
                        lines.push(`    • ${ch.name} (${label})`);
                    }
                }

                const totalNonCategory = all.filter(
                    (ch) => ch.type !== 4,
                ).length;
                return createActionResultFromTextDisplay(
                    lines.length > 0
                        ? `Channels (${totalNonCategory}):\n${lines.join("\n")}`
                        : "No channels found.",
                );
            }
            case "refreshChannels": {
                await fetchAndCacheChannels(
                    agentContext.guildId!,
                    agentContext,
                    sessionContext,
                );
                const plainCount = Array.from(
                    agentContext.channels.keys(),
                ).filter((k) => !k.includes(":")).length;
                return createActionResultFromTextDisplay(
                    `Channel cache refreshed. Found ${plainCount} channels.`,
                );
            }
            case "createChannelInvite": {
                const {
                    channel_id,
                    max_age,
                    never_expires,
                    max_uses,
                    temporary,
                    unique,
                } = action.parameters;
                const resolvedId = await resolveChannelId(
                    channel_id,
                    agentContext,
                    sessionContext,
                );
                const resolvedMaxAge = never_expires ? 0 : (max_age ?? 86400);
                const body: Record<string, unknown> = {
                    max_age: resolvedMaxAge,
                    max_uses: max_uses ?? 0,
                    temporary: temporary ?? false,
                    unique: unique ?? false,
                };
                const response = await discordFetch(
                    `/channels/${resolvedId}/invites`,
                    { method: "POST", body: JSON.stringify(body) },
                );
                const invite = (await response.json()) as {
                    code: string;
                    max_age: number;
                    max_uses: number;
                };
                const expiry =
                    invite.max_age === 0
                        ? "never expires"
                        : `expires in ${invite.max_age / 3600} hour(s)`;
                const uses =
                    invite.max_uses === 0
                        ? "unlimited uses"
                        : `${invite.max_uses} use(s)`;
                return createActionResultFromTextDisplay(
                    `Invite created!\nhttps://discord.gg/${invite.code}\n${expiry}, ${uses}`,
                );
            }
            default:
                return createActionResultFromTextDisplay(
                    `${action.actionName} — not yet implemented.`,
                );
        }
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return createActionResultFromError(message);
    }
}
