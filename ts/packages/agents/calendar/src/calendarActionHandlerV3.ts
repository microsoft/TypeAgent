// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAction,
    AppAgent,
    ActionContext,
    ActionResult,
    ActionResultSuccess,
    ReadinessReport,
    SessionContext,
    ParsedCommandParams,
    StructuredBlock,
} from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayStatus,
    displaySuccess,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import {
    createActionResultFromHtmlDisplay,
    createActionResultFromError,
    createActionResultFromTextDisplay,
    createStructuredResult,
    createYesNoChoiceResult,
    createMultiChoiceResult,
    ChoiceManager,
} from "@typeagent/agent-sdk/helpers/action";
import { CalendarActionV3 } from "./calendarActionsSchemaV3.js";
import {
    CalendarClient,
    ICalendarProvider,
    CalendarProviderType,
    createCalendarProviderFromConfig,
    claimSilentRestoreAnnouncement,
    evaluateGraphReadiness,
    getAvailableProviders,
    GoogleCalendarClient,
    probeGraphConfig,
} from "graph-utils";
import {
    getNWeeksDateRangeISO,
    generateQueryFromFuzzyDay,
} from "./calendarQueryHelper.js";
import {
    getDateRelativeToDayV2,
    parseFuzzyDateString,
    parseTimeString,
} from "@typeagent/typechat-utils";
import chalk from "chalk";
import registerDebug from "debug";

const debug = registerDebug("typeagent:calendar");
const debugError = registerDebug("typeagent:calendar:error");

// Calendar context to hold the client
export type CalendarActionContext = {
    calendarClient: CalendarClient | undefined; // Legacy - kept for backward compatibility
    calendarProvider: ICalendarProvider | undefined;
    providerType: CalendarProviderType | undefined;
};

// Login command handler
export class CalendarClientLoginCommandHandler
    implements CommandHandlerNoParams
{
    public readonly description = "Log into calendar service";
    public async run(context: ActionContext<CalendarActionContext>) {
        const provider = context.sessionContext.agentContext.calendarProvider;
        const providerType = context.sessionContext.agentContext.providerType;

        if (provider === undefined) {
            throw new Error("Calendar provider not initialized");
        }

        if (provider.isAuthenticated()) {
            const user = await provider.getUser();
            const name = user.displayName || "Unknown";
            const email = user.email || "Unknown";
            displayWarn(`Already logged in as ${name}<${email}>`, context);
            // Re-emit the signed-in marker so the avatar (name + photo)
            // resyncs even when the user was already authenticated — e.g.
            // restored silently on launch before the photo had been fetched.
            const photoAttr = user.photoUrl
                ? ` data-photo="${escapeHtml(user.photoUrl)}"`
                : "";
            context.actionIO.appendDisplay({
                type: "html",
                content: `<span class="typeagent-user-signed-in" data-name="${escapeHtml(name)}" data-email="${escapeHtml(email)}"${photoAttr} hidden></span>`,
            });
            return;
        }

        displayStatus(
            `Logging into ${providerType || "calendar"} service...`,
            context,
        );

        const success = await provider.login((prompt) => {
            if (prompt.kind === "error") {
                displayWarn(prompt.message, context);
            } else {
                // Both deviceCode and browser surface the message as-is; the
                // device-code message contains the URL+code, the browser
                // message says "opening your browser..." (the SDK auto-opens
                // the system browser via the open package).
                displayStatus(prompt.message, context);
            }
        });

        if (success) {
            const user = await provider.getUser();
            const name = user.displayName || "Unknown";
            const email = user.email || "Unknown";
            displaySuccess(
                `Successfully logged in as ${name} <${email}>`,
                context,
            );
            // Hidden marker the chat-ui / shell scan for after each agent
            // message. Lifts the signed-in identity into UI state so the
            // user-letter avatar shows the real initial and stops triggering
            // login on click. data-photo carries the base64 profile photo
            // (when the provider has one) so the avatar can render the image.
            const photoAttr = user.photoUrl
                ? ` data-photo="${escapeHtml(user.photoUrl)}"`
                : "";
            context.actionIO.appendDisplay({
                type: "html",
                content: `<span class="typeagent-user-signed-in" data-name="${escapeHtml(name)}" data-email="${escapeHtml(email)}"${photoAttr} hidden></span>`,
            });
        } else {
            displayWarn(
                "Login failed. If using Google Calendar, you can also try '@calendar google-auth <code>' with a manual authorization code.",
                context,
            );
        }
    }
}

// Logout command handler
export class CalendarClientLogoutCommandHandler
    implements CommandHandlerNoParams
{
    public readonly description = "Log out of calendar service";
    public async run(context: ActionContext<CalendarActionContext>) {
        const provider = context.sessionContext.agentContext.calendarProvider;
        if (provider === undefined) {
            throw new Error("Calendar provider not initialized");
        }
        const wasLoggedIn = provider.logout();
        if (wasLoggedIn) {
            displaySuccess("Successfully logged out", context);
        } else {
            displayWarn("Already logged out", context);
        }
        // Emit the signed-out marker regardless of whether logout() found a
        // live in-memory client — the user clicked logout, so the UI should
        // reflect signed-out state even if the client was already cleared
        // by an earlier action (e.g. logout from the email agent first).
        context.actionIO.appendDisplay({
            type: "html",
            content: `<span class="typeagent-user-signed-out" hidden></span>`,
        });
    }
}

// Google auth command handler - completes OAuth flow with authorization code
export class GoogleAuthCommandHandler implements CommandHandler {
    public readonly description =
        "Complete Google Calendar OAuth flow with authorization code";
    public readonly parameters = {
        args: {
            code: {
                description: "Authorization code from Google OAuth redirect",
                type: "string",
                optional: false,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CalendarActionContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const provider = context.sessionContext.agentContext.calendarProvider;
        const providerType = context.sessionContext.agentContext.providerType;

        if (provider === undefined) {
            throw new Error("Calendar provider not initialized");
        }

        if (providerType !== "google") {
            displayWarn(
                "This command is only for Google Calendar. Use '@calendar login' for Microsoft Graph.",
                context,
            );
            return;
        }

        const code = params.args.code as string;
        if (!code || code.trim() === "") {
            displayWarn(
                "Please provide the authorization code: @calendar google-auth <code>",
                context,
            );
            return;
        }

        displayStatus("Completing Google Calendar authorization...", context);

        const googleProvider = provider as GoogleCalendarClient;
        const success = await googleProvider.completeAuth(code);

        if (success) {
            const user = await provider.getUser();
            displaySuccess(
                `Successfully logged in to Google Calendar as ${user.displayName || "Unknown"} <${user.email || "Unknown"}>`,
                context,
            );
        } else {
            displayWarn(
                "Failed to complete authorization. Please try '@calendar login' again to get a new code.",
                context,
            );
        }
    }
}

const handlers: CommandHandlerTable = {
    description: "Calendar login command",
    defaultSubCommand: "login",
    commands: {
        login: new CalendarClientLoginCommandHandler(),
        logout: new CalendarClientLogoutCommandHandler(),
        "google-auth": new GoogleAuthCommandHandler(),
    },
};

// Escape HTML special characters to prevent injection
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// Attempt a silent, non-interactive sign-in using cached MS Graph
// credentials so a previously signed-in user sees the signed-in avatar
// (name + photo) on app launch without clicking login. Only runs for the
// Microsoft provider and never prompts: provider.login() with no callback
// uses the persisted auth record and fails quietly when there is none or it
// has expired. On success it posts a short "signed in" message carrying the
// hidden user-signed-in marker (via an agent-initiated bubble thread — the
// only display path both chat UIs scan for the marker), so both UIs lift the
// identity into the avatar state. A process-wide guard ensures only the first
// agent (calendar or email) to restore announces it.
async function trySilentCalendarSignIn(
    provider: ICalendarProvider,
    context: SessionContext<CalendarActionContext>,
): Promise<void> {
    try {
        if (provider.providerName !== "microsoft") {
            return;
        }
        if (!provider.isAuthenticated()) {
            const ok = await provider.login();
            if (!ok) {
                return;
            }
        }
        if (!claimSilentRestoreAnnouncement()) {
            // Another agent already restored + announced this session; our
            // client is warmed, nothing more to surface.
            return;
        }
        const user = await provider.getUser();
        const name = user.displayName || "Unknown";
        const email = user.email || "Unknown";
        const photoAttr = user.photoUrl
            ? ` data-photo="${escapeHtml(user.photoUrl)}"`
            : "";
        const thread = context.beginAgentThread("bubble");
        thread.appendDisplay(
            {
                type: "html",
                content:
                    `Signed in as ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;` +
                    `<span class="typeagent-user-signed-in" data-name="${escapeHtml(name)}" data-email="${escapeHtml(email)}"${photoAttr} hidden></span>`,
            },
            "block",
        );
        thread.complete();
    } catch {
        // Silent: no cached creds / expired / offline — leave the avatar in
        // its signed-out state; the user can still click to sign in.
    }
}

// Format a date portion: "Mon, Jan 20"
function formatEventDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
    });
}

// Format a time portion: "9:00 AM"
function formatEventTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
    });
}

// Format a time range: "9:00 AM – 9:30 AM"
function formatEventTimeRange(startIso: string, endIso: string): string {
    return `${formatEventTime(startIso)} \u2013 ${formatEventTime(endIso)}`;
}

// Return location string from an event object (handles both string and object forms)
function getEventLocation(event: any): string {
    return (
        event.location?.displayName ||
        (typeof event.location === "string" ? event.location : "")
    );
}

// Styled empty-state message for when no events are found
function emptyStateHtml(message: string): string {
    return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#888;padding:8px 12px;border-left:3px solid #ddd;background:#f8f9fa;">${escapeHtml(message)}</div>`;
}

// Helper function to format events as professional plain text
function formatEventsAsText(events: any[]): string {
    if (!events || events.length === 0) {
        return "No events found.";
    }

    const lines: string[] = [];
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const subject = event.subject || "Untitled";
        const num = `${i + 1}.`;

        const datePart = event.start?.dateTime
            ? formatEventDate(event.start.dateTime)
            : "";
        const timePart =
            event.start?.dateTime && event.end?.dateTime
                ? formatEventTimeRange(event.start.dateTime, event.end.dateTime)
                : "";
        const location = getEventLocation(event);

        lines.push(`${num.padEnd(4)}${subject}`);
        const meta = [datePart, timePart].filter(Boolean).join("  \u00B7  ");
        if (meta) {
            lines.push(`    ${meta}`);
        }
        if (location) {
            lines.push(`    ${location}`);
        }
        if (i < events.length - 1) {
            lines.push("");
        }
    }
    return lines.join("\n");
}

// Build a structured agenda result: an optional heading + a table of events
// (Subject as a link, When, Location) plus a machine-readable rawData payload.
// The SDK derives the markdown/text fallback for clients that can't render
// blocks.
//
// Exported for unit tests.
export function buildStructuredEventList(
    events: any[],
    heading?: string,
): ActionResultSuccess {
    const rows = events.map((event) => {
        const subject = event.subject || "Untitled";
        const datePart = event.start?.dateTime
            ? formatEventDate(event.start.dateTime)
            : "";
        const timePart =
            event.start?.dateTime && event.end?.dateTime
                ? formatEventTimeRange(event.start.dateTime, event.end.dateTime)
                : "";
        const when = [datePart, timePart].filter(Boolean).join(" · ");
        const location = getEventLocation(event);
        return [
            event.htmlLink ? { text: subject, href: event.htmlLink } : subject,
            when,
            location,
        ];
    });

    const blocks: StructuredBlock[] = [];
    if (heading) {
        blocks.push({ kind: "heading", level: 3, text: heading });
    }
    blocks.push({
        kind: "table",
        columns: [
            { id: "subject", header: "Event", type: "link" },
            { id: "when", header: "When", type: "date" },
            { id: "location", header: "Location" },
        ],
        rows,
        sortable: true,
        pageSize: 15,
    });

    return createStructuredResult(blocks, {
        historyText: heading
            ? `${heading}\n\n${formatEventsAsText(events)}`
            : formatEventsAsText(events),
        rawData: events,
    });
}

// HH:MM timestamp prefix for setup status updates — same convention used by
// screencapture / desktop runInstall + runDotnetBuild so progress reads
// consistently across agents.
function ts(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Calendar action handler V3 - with multi-provider calendar integration
export class CalendarActionHandlerV3 implements AppAgent {
    public choiceManager = new ChoiceManager();
    public async initializeAgentContext(): Promise<CalendarActionContext> {
        return {
            calendarClient: undefined,
            calendarProvider: undefined,
            providerType: undefined,
        };
    }

    // Cheap probe: env-var read + (optional) provider.isAuthenticated().
    // Doesn't trigger any network call — providers cache their tokens on
    // disk, so a fresh provider can answer isAuthenticated() purely from
    // local state. See graphUtils/readiness.ts for the decision logic.
    public async checkReadiness(
        context: SessionContext<CalendarActionContext>,
    ): Promise<ReadinessReport> {
        const config = probeGraphConfig(process.env);
        // Prefer the agentContext's provider when available (already set
        // up by updateAgentContext on enable). Fall back to a fresh
        // provider when the agent was disabled or env vars were set after
        // the last enable — token cache on disk means the fresh instance
        // still reports isAuthenticated() correctly.
        let provider = context.agentContext?.calendarProvider;
        if (
            !provider &&
            (config.msGraphConfigured || config.googleConfigured)
        ) {
            provider = createCalendarProviderFromConfig();
        }
        return evaluateGraphReadiness("calendar", {
            ...config,
            isAuthenticated: provider?.isAuthenticated() === true,
            providerName: provider?.providerName,
        });
    }

    // setup hook — drives the device-code / OAuth login flow via the same
    // provider.login() path as @calendar login, but routed through a yes/no
    // choice card so the user can confirm before we open browsers / show
    // device codes. Manual-config (env vars missing) is surfaced as an
    // error — there's nothing setup() can automate for that.
    public async setup(
        actionContext: ActionContext<CalendarActionContext>,
    ): Promise<ActionResult> {
        return offerCalendarLogin(actionContext, this.choiceManager);
    }

    public async updateAgentContext(
        enable: boolean,
        context: SessionContext<CalendarActionContext>,
    ): Promise<void> {
        if (enable) {
            // Create provider from configuration (auto-detects MS Graph or Google)
            const provider = createCalendarProviderFromConfig();

            if (provider) {
                context.agentContext.calendarProvider = provider;
                context.agentContext.providerType =
                    provider.providerName as CalendarProviderType;

                // For backward compatibility, also set the legacy calendarClient
                // if we're using Microsoft Graph
                if (provider.providerName === "microsoft") {
                    const msProvider = provider as any;
                    if (msProvider.getUnderlyingClient) {
                        context.agentContext.calendarClient =
                            msProvider.getUnderlyingClient();
                    }
                }

                debug(
                    chalk.cyan(
                        `[Calendar] Using ${provider.providerName} calendar provider`,
                    ),
                );

                // Restore a prior session from cached credentials so the
                // avatar shows the signed-in user (name + photo) on launch
                // without an explicit login. Fire-and-forget so agent enable
                // isn't blocked on a network round-trip.
                void trySilentCalendarSignIn(provider, context);
            } else {
                const availableProviders = getAvailableProviders();
                debug(
                    chalk.yellow(
                        `[Calendar] No calendar provider configured. Available: ${availableProviders.length > 0 ? availableProviders.join(", ") : "none"}`,
                    ),
                );
                debug(
                    chalk.yellow(
                        `[Calendar] Set MSGRAPH_APP_CLIENTID for Microsoft Graph or GOOGLE_CALENDAR_CLIENT_ID for Google Calendar`,
                    ),
                );
            }
        } else {
            context.agentContext.calendarClient = undefined;
            context.agentContext.calendarProvider = undefined;
            context.agentContext.providerType = undefined;
        }
    }

    public async executeAction(
        action: AppAction,
        context: ActionContext<CalendarActionContext>,
    ): Promise<ActionResult | undefined> {
        const calendarAction = action as CalendarActionV3;
        const provider = context.sessionContext.agentContext.calendarProvider;
        const providerType = context.sessionContext.agentContext.providerType;

        debug(
            chalk.cyan(
                `\n[Calendar V3] Executing action: ${calendarAction.actionName} (provider: ${providerType || "none"})`,
            ),
        );

        if (!provider) {
            return createActionResultFromError(
                "Calendar provider not initialized. Please configure MSGRAPH_APP_CLIENTID or GOOGLE_CALENDAR_CLIENT_ID.",
            );
        }

        if (!provider.isAuthenticated()) {
            return createActionResultFromError(
                "Not logged in. Please run '@calendar login' first.",
            );
        }

        // Per-request token-usage accumulator. Calendar's only model usage is
        // text embeddings (via graph-utils' calendarDataIndex). aiclient's
        // TextEmbeddingModel exposes no usage/completionCallback and discards
        // API usage internally, so embedding tokens aren't observable here.
        // Report an all-zero accumulator on success so the agent participates
        // in the token-usage contract (all-zero = ran but no reportable LLM
        // usage; undefined = not reported).
        const tokenUsage = {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        };

        let result: ActionResult | undefined;
        switch (calendarAction.actionName) {
            case "scheduleEvent":
                result = await this.handleScheduleEvent(
                    calendarAction,
                    context,
                    provider,
                );
                break;
            case "findEvents":
                result = await this.handleFindEvents(
                    calendarAction,
                    context,
                    provider,
                );
                break;
            case "addParticipant":
                result = await this.handleAddParticipant(
                    calendarAction,
                    context,
                    provider,
                );
                break;
            case "findTodaysEvents":
                result = await this.handleFindTodaysEvents(context, provider);
                break;
            case "findThisWeeksEvents":
                result = await this.handleFindThisWeeksEvents(
                    context,
                    provider,
                );
                break;
            case "removeEvent":
                result = await this.handleRemoveEvent(
                    calendarAction,
                    context,
                    provider,
                );
                break;
            default:
                debug(
                    chalk.red(
                        `Unknown action: ${(calendarAction as any).actionName}`,
                    ),
                );
                return createActionResultFromError(
                    `Unknown action: ${(calendarAction as any).actionName}`,
                );
        }

        // Attach usage to success results only; error/undefined carry none.
        if (result !== undefined && result.error === undefined) {
            result.tokenUsage = tokenUsage;
        }
        return result;
    }

    private async handleScheduleEvent(
        action: CalendarActionV3 & { actionName: "scheduleEvent" },
        context: ActionContext<CalendarActionContext>,
        provider: ICalendarProvider,
    ): Promise<ActionResult | undefined> {
        const { description, date, time, participant } = action.parameters;

        debug(chalk.green(`\n✓ Scheduling event: ${description}`));

        try {
            const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

            // Parse the natural language date (default to today if not provided)
            const eventDate = date ? this.parseNaturalDate(date) : new Date();
            if (!eventDate) {
                return createActionResultFromError(
                    `Could not parse date: ${date}`,
                );
            }

            // Parse the time and set it on the date
            let startHour = 9,
                startMinute = 0;
            let endHour: number | undefined;
            let endMinute = 0;

            if (time) {
                // Try parsing as time range first (canonical "HH:MM-HH:MM" or user formats)
                const timeRange = this.parseTimeRange(time);
                if (timeRange) {
                    startHour = timeRange.start.hours;
                    startMinute = timeRange.start.minutes;
                    endHour = timeRange.end.hours;
                    endMinute = timeRange.end.minutes;
                } else {
                    // Try simple parsing like "2pm", "14:00", or canonical "HH:MM"
                    const simpleTime = this.parseSimpleTime(time);
                    if (simpleTime) {
                        startHour = simpleTime.hours;
                        startMinute = simpleTime.minutes;
                    } else {
                        // Try parseTimeString which returns "HH:mm:ss" format
                        try {
                            const parsedTime = parseTimeString(time);
                            const [h, m] = parsedTime.split(":").map(Number);
                            startHour = h;
                            startMinute = m;
                        } catch {
                            // Fall back to default 9am
                            debug(
                                chalk.yellow(
                                    `Could not parse time: ${time}, using 9am`,
                                ),
                            );
                        }
                    }
                }
            }

            eventDate.setHours(startHour, startMinute, 0, 0);
            const endDate = new Date(eventDate);
            if (endHour !== undefined) {
                // Use specified end time
                endDate.setHours(endHour, endMinute, 0, 0);
            } else {
                // Default 1 hour duration
                endDate.setHours(startHour + 1, startMinute, 0, 0);
            }

            const startDateTime = eventDate.toISOString();
            const endDateTime = endDate.toISOString();
            const attendees = participant ? [participant] : undefined;

            // Create the event via calendar provider
            const eventId = await provider.createEvent(
                description, // subject
                "", // body
                startDateTime, // startDateTime
                endDateTime, // endDateTime
                timeZone, // timeZone
                attendees, // attendees
            );

            if (eventId) {
                const dateStr = eventDate.toLocaleDateString();
                const startTimeStr = eventDate.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                });
                const endTimeStr = endDate.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                });
                // Show time range if end time differs from start + 1 hour (explicit end time was specified)
                const timeDisplay =
                    endHour !== undefined
                        ? `${startTimeStr} \u2013 ${endTimeStr}`
                        : startTimeStr;
                const longDate = eventDate.toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                });
                const textResult = [
                    `Event scheduled: "${description}"`,
                    `  Date:  ${longDate}`,
                    `  Time:  ${timeDisplay}`,
                ].join("\n");
                return createActionResultFromHtmlDisplay(
                    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;"><div style="border-left:3px solid #34a853;padding:6px 10px;background:#f8f9fa;"><div style="font-weight:600;color:#34a853;">Event Scheduled</div><div style="margin-top:4px;">${escapeHtml(description)}</div><div style="color:#555;font-size:12px;margin-top:2px;">${dateStr} &nbsp;&middot;&nbsp; ${timeDisplay}</div></div></div>`,
                    textResult,
                );
            } else {
                return createActionResultFromError("Failed to create event");
            }
        } catch (error: any) {
            debugError(chalk.red(`Error creating event: ${error.message}`));
            return createActionResultFromError(
                `Failed to create event: ${error.message}`,
            );
        }
    }

    private parseNaturalDate(dateStr: string): Date | undefined {
        // Handle special keywords
        const lowerDate = dateStr.toLowerCase().trim();

        if (lowerDate === "today") {
            return new Date();
        }
        if (lowerDate === "tomorrow") {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            return d;
        }

        // Try parsing relative day ("next Monday", "this Friday")
        const relativeDate = getDateRelativeToDayV2(dateStr);
        if (relativeDate) {
            return relativeDate;
        }

        // Try parsing fuzzy date string ("July 15", "2026-03-15")
        const fuzzyDate = parseFuzzyDateString(dateStr);
        if (fuzzyDate) {
            return fuzzyDate;
        }

        // Try ISO format directly
        const isoDate = new Date(dateStr);
        if (!isNaN(isoDate.getTime())) {
            return isoDate;
        }

        return undefined;
    }

    private parseSimpleTime(
        timeStr: string,
    ): { hours: number; minutes: number } | undefined {
        // Handle "2pm", "2:30pm", "14:00", "noon", "midnight"
        const lowerTime = timeStr.toLowerCase().trim();

        if (lowerTime === "noon") {
            return { hours: 12, minutes: 0 };
        }
        if (lowerTime === "midnight") {
            return { hours: 0, minutes: 0 };
        }

        // Match patterns like "2pm", "2:30pm", "14:00"
        const amPmMatch = lowerTime.match(
            /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
        );
        if (amPmMatch) {
            let hours = parseInt(amPmMatch[1], 10);
            const minutes = amPmMatch[2] ? parseInt(amPmMatch[2], 10) : 0;
            const period = amPmMatch[3]?.toLowerCase();

            if (period === "pm" && hours < 12) {
                hours += 12;
            } else if (period === "am" && hours === 12) {
                hours = 0;
            }

            return { hours, minutes };
        }

        return undefined;
    }

    private parseTimeRange(timeStr: string):
        | {
              start: { hours: number; minutes: number };
              end: { hours: number; minutes: number };
          }
        | undefined {
        let lower = timeStr.toLowerCase().trim();

        // Strip "from" prefix if present: "from 1 to 2pm" -> "1 to 2pm"
        if (lower.startsWith("from ")) {
            lower = lower.slice(5);
        }

        // Canonical format from converter: "HH:MM-HH:MM" (e.g., "22:00-23:00")
        const canonicalMatch = lower.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
        if (canonicalMatch) {
            return {
                start: {
                    hours: parseInt(canonicalMatch[1], 10),
                    minutes: parseInt(canonicalMatch[2], 10),
                },
                end: {
                    hours: parseInt(canonicalMatch[3], 10),
                    minutes: parseInt(canonicalMatch[4], 10),
                },
            };
        }

        // User format: "10-11pm" or "1-2pm" (shared AM/PM suffix)
        const sharedSuffixMatch = lower.match(
            /^(\d{1,2})(?::(\d{2}))?-(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i,
        );
        if (sharedSuffixMatch) {
            let startHours = parseInt(sharedSuffixMatch[1], 10);
            const startMinutes = sharedSuffixMatch[2]
                ? parseInt(sharedSuffixMatch[2], 10)
                : 0;
            let endHours = parseInt(sharedSuffixMatch[3], 10);
            const endMinutes = sharedSuffixMatch[4]
                ? parseInt(sharedSuffixMatch[4], 10)
                : 0;
            const period = sharedSuffixMatch[5].toLowerCase();

            if (period === "pm") {
                if (startHours < 12) startHours += 12;
                if (endHours < 12) endHours += 12;
            } else if (period === "am") {
                if (startHours === 12) startHours = 0;
                if (endHours === 12) endHours = 0;
            }

            return {
                start: { hours: startHours, minutes: startMinutes },
                end: { hours: endHours, minutes: endMinutes },
            };
        }

        // User format: "2pm to 3pm" or "2pm-3pm" (each time has its own AM/PM)
        // Use bounded whitespace quantifiers to avoid regex backtracking warnings
        const separateMatch = lower.match(
            /^(\d{1,2})(?::(\d{2}))?\s{0,5}(am|pm)?\s{0,5}(?:to|-)\s{0,5}(\d{1,2})(?::(\d{2}))?\s{0,5}(am|pm)?$/i,
        );
        if (separateMatch) {
            const startStr = `${separateMatch[1]}${separateMatch[2] ? ":" + separateMatch[2] : ""}${separateMatch[3] || ""}`;
            const endStr = `${separateMatch[4]}${separateMatch[5] ? ":" + separateMatch[5] : ""}${separateMatch[6] || ""}`;

            const start = this.parseSimpleTime(startStr);
            const end = this.parseSimpleTime(endStr);

            if (start && end) {
                return { start, end };
            }
        }

        return undefined;
    }

    private async handleFindEvents(
        action: CalendarActionV3 & { actionName: "findEvents" },
        context: ActionContext<CalendarActionContext>,
        provider: ICalendarProvider,
    ): Promise<ActionResult | undefined> {
        const { date, description } = action.parameters;

        debug(chalk.green(`\n✓ Searching for events`));

        try {
            let events: any[] = [];

            if (description) {
                // Search by description/subject
                events = await provider.findEventsBySubject(description);
            } else if (date) {
                // Try to use generateQueryFromFuzzyDay for natural language dates
                const queryString = generateQueryFromFuzzyDay(date);
                if (queryString) {
                    // Parse the query string to extract dates
                    // Format: "startdatetime=...&enddatetime=..."
                    const params = new URLSearchParams(
                        queryString.toLowerCase(),
                    );
                    const startDateTime = params.get("startdatetime");
                    const endDateTime = params.get("enddatetime");
                    if (startDateTime && endDateTime) {
                        events = await provider.findEventsByDateRange({
                            startDateTime,
                            endDateTime,
                        });
                    }
                } else {
                    // Fall back to parsing the date manually
                    const parsedDate = this.parseNaturalDate(date);
                    if (parsedDate) {
                        const startDate = new Date(parsedDate);
                        startDate.setHours(0, 0, 0, 0);
                        const endDate = new Date(parsedDate);
                        endDate.setHours(23, 59, 59, 999);
                        events = await provider.findEventsByDateRange({
                            startDateTime: startDate.toISOString(),
                            endDateTime: endDate.toISOString(),
                        });
                    } else {
                        return createActionResultFromError(
                            `Could not parse date: ${date}`,
                        );
                    }
                }
            } else {
                // Default: get this week's events
                const dateRange = getNWeeksDateRangeISO(1);
                events = await provider.findEventsByDateRange({
                    startDateTime: dateRange.startDateTime,
                    endDateTime: dateRange.endDateTime,
                });
            }

            if (!events || events.length === 0) {
                return createActionResultFromHtmlDisplay(
                    emptyStateHtml("No events found matching your criteria."),
                    "No events found matching your criteria.",
                );
            }

            return buildStructuredEventList(events);
        } catch (error: any) {
            debugError(chalk.red(`Error finding events: ${error.message}`));
            return createActionResultFromError(
                `Failed to find events: ${error.message}`,
            );
        }
    }

    private async handleAddParticipant(
        action: CalendarActionV3 & { actionName: "addParticipant" },
        context: ActionContext<CalendarActionContext>,
        provider: ICalendarProvider,
    ): Promise<ActionResult | undefined> {
        const { description, participant } = action.parameters;

        debug(
            chalk.green(
                `\n✓ Adding participant ${participant} to ${description}`,
            ),
        );

        try {
            // Find the event first
            const events = await provider.findEventsBySubject(description);
            if (!events || events.length === 0) {
                return createActionResultFromError(
                    `Could not find event: ${description}`,
                );
            }

            const event = events[0];
            // Resolve participant name to email if needed
            const emails = await provider.resolveUserEmails([participant]);
            const participantEmail = emails[0] || participant;

            // Add participant to the event
            const success = await provider.addParticipants(event.id, [
                participantEmail,
            ]);

            if (success) {
                const textResult = [
                    `Participant added: ${participant}`,
                    `  Event: ${description}`,
                ].join("\n");
                return createActionResultFromHtmlDisplay(
                    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;"><div style="border-left:3px solid #34a853;padding:6px 10px;background:#f8f9fa;"><div style="font-weight:600;color:#34a853;">Participant Added</div><div style="margin-top:4px;">${escapeHtml(participant)}</div><div style="color:#555;font-size:12px;margin-top:2px;">Event: ${escapeHtml(description)}</div></div></div>`,
                    textResult,
                );
            } else {
                return createActionResultFromError(
                    `Failed to add ${participant} to ${description}`,
                );
            }
        } catch (error: any) {
            debugError(chalk.red(`Error adding participant: ${error.message}`));
            return createActionResultFromError(
                `Failed to add participant: ${error.message}`,
            );
        }
    }

    private async handleFindTodaysEvents(
        context: ActionContext<CalendarActionContext>,
        provider: ICalendarProvider,
    ): Promise<ActionResult | undefined> {
        debug(chalk.green(`\n✓ Finding today's events`));

        try {
            const today = new Date();
            const startOfDay = new Date(
                today.getFullYear(),
                today.getMonth(),
                today.getDate(),
                0,
                0,
                0,
                0,
            );
            const endOfDay = new Date(
                today.getFullYear(),
                today.getMonth(),
                today.getDate(),
                23,
                59,
                59,
                999,
            );

            const events = await provider.findEventsByDateRange({
                startDateTime: startOfDay.toISOString(),
                endDateTime: endOfDay.toISOString(),
            });

            if (!events || events.length === 0) {
                return createActionResultFromHtmlDisplay(
                    emptyStateHtml("No events scheduled for today."),
                    "No events scheduled for today.",
                );
            }

            const todayLabel = today.toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
            });
            const heading = `Today's Schedule \u2014 ${todayLabel}`;
            return buildStructuredEventList(events, heading);
        } catch (error: any) {
            debugError(
                chalk.red(`Error finding today's events: ${error.message}`),
            );
            return createActionResultFromError(
                `Failed to find today's events: ${error.message}`,
            );
        }
    }

    private async handleFindThisWeeksEvents(
        context: ActionContext<CalendarActionContext>,
        provider: ICalendarProvider,
    ): Promise<ActionResult | undefined> {
        debug(chalk.green(`\n✓ Finding this week's events`));

        try {
            const dateRange = getNWeeksDateRangeISO(1);
            const events = await provider.findEventsByDateRange({
                startDateTime: dateRange.startDateTime,
                endDateTime: dateRange.endDateTime,
            });

            if (!events || events.length === 0) {
                return createActionResultFromHtmlDisplay(
                    emptyStateHtml("No events scheduled for this week."),
                    "No events scheduled for this week.",
                );
            }

            const weekStart = new Date(dateRange.startDateTime);
            const weekEnd = new Date(dateRange.endDateTime);
            const weekRangeLabel = `${weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} \u2013 ${weekEnd.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
            const weekHeading = `This Week's Schedule \u2014 ${weekRangeLabel}`;
            return buildStructuredEventList(events, weekHeading);
        } catch (error: any) {
            debugError(
                chalk.red(`Error finding this week's events: ${error.message}`),
            );
            return createActionResultFromError(
                `Failed to find this week's events: ${error.message}`,
            );
        }
    }

    private async handleRemoveEvent(
        action: CalendarActionV3 & { actionName: "removeEvent" },
        _context: ActionContext<CalendarActionContext>,
        provider: ICalendarProvider,
    ): Promise<ActionResult | undefined> {
        const { description, date } = action.parameters;

        debug(
            chalk.green(
                `\n✓ Searching for events to remove: ${description}${date ? ` (${date})` : ""}`,
            ),
        );

        try {
            let events = await provider.findEventsBySubject(description);

            // Filter by date if provided
            if (date && events.length > 0) {
                const parsedDate = this.parseNaturalDate(date);
                if (parsedDate) {
                    const startDate = new Date(parsedDate);
                    startDate.setHours(0, 0, 0, 0);
                    const endDate = new Date(parsedDate);
                    endDate.setHours(23, 59, 59, 999);

                    events = events.filter((event) => {
                        if (!event.start?.dateTime) return false;
                        const eventDate = new Date(event.start.dateTime);
                        return eventDate >= startDate && eventDate <= endDate;
                    });
                } else {
                    return createActionResultFromError(
                        `Could not parse date: ${date}`,
                    );
                }
            }

            if (!events || events.length === 0) {
                return createActionResultFromError(
                    `No events found matching "${description}"${date ? ` on ${date}` : ""}`,
                );
            }

            if (events.length === 1) {
                // Single match — confirm with the user before deleting
                const event = events[0];
                const subject = event.subject || "Untitled";
                const startTime = event.start?.dateTime
                    ? event.end?.dateTime
                        ? `${formatEventDate(event.start.dateTime)}, ${formatEventTimeRange(event.start.dateTime, event.end.dateTime)}`
                        : `${formatEventDate(event.start.dateTime)}, ${formatEventTime(event.start.dateTime)}`
                    : "Unknown time";

                return createYesNoChoiceResult(
                    this.choiceManager,
                    `Remove "${subject}" scheduled for ${startTime}?`,
                    async (confirmed: boolean) => {
                        if (!confirmed) {
                            return createActionResultFromHtmlDisplay(
                                `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;"><div style="border-left:3px solid #888;padding:6px 10px;background:#f8f9fa;color:#555;">Removal cancelled: ${escapeHtml(subject)}</div></div>`,
                                `Removal cancelled: "${subject}"`,
                            );
                        }
                        const deleted = await provider.deleteEvent(event.id);
                        if (deleted) {
                            return createActionResultFromHtmlDisplay(
                                `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;"><div style="border-left:3px solid #ea4335;padding:6px 10px;background:#f8f9fa;"><div style="font-weight:600;color:#ea4335;">Event Removed</div><div style="margin-top:4px;">${escapeHtml(subject)}</div><div style="color:#555;font-size:12px;margin-top:2px;">${startTime}</div></div></div>`,
                                `Event removed: "${subject}" (${startTime})`,
                            );
                        }
                        return createActionResultFromError(
                            `Failed to delete "${subject}"`,
                        );
                    },
                    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;padding:6px 0;">Remove <strong>${escapeHtml(subject)}</strong> scheduled for ${startTime}?</div>`,
                );
            }

            if (events.length <= 5) {
                // Multiple matches — show checkboxes to select which to delete
                const choiceLabels = events.map((event) => {
                    const subject = event.subject || "Untitled";
                    const when = event.start?.dateTime
                        ? event.end?.dateTime
                            ? `${formatEventDate(event.start.dateTime)}, ${formatEventTimeRange(event.start.dateTime, event.end.dateTime)}`
                            : `${formatEventDate(event.start.dateTime)}, ${formatEventTime(event.start.dateTime)}`
                        : "Unknown time";
                    return `${subject} — ${when}`;
                });

                const choiceItems = events
                    .map((event, i) => {
                        const subject = escapeHtml(event.subject || "Untitled");
                        const when = event.start?.dateTime
                            ? event.end?.dateTime
                                ? `${formatEventDate(event.start.dateTime)}, ${formatEventTimeRange(event.start.dateTime, event.end.dateTime)}`
                                : `${formatEventDate(event.start.dateTime)}, ${formatEventTime(event.start.dateTime)}`
                            : "Unknown time";
                        return `<div style="border-left:3px solid #fbbc04;padding:6px 10px;margin-bottom:6px;background:#f8f9fa;"><span style="font-weight:600;">${i + 1}. ${subject}</span><div style="color:#555;font-size:12px;margin-top:2px;">${when}</div></div>`;
                    })
                    .join("");
                const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;"><div style="color:#555;margin-bottom:8px;">Found ${events.length} events matching <strong>${escapeHtml(description)}</strong>. Select which to remove:</div>${choiceItems}</div>`;

                return createMultiChoiceResult(
                    this.choiceManager,
                    `Select events to delete:`,
                    choiceLabels,
                    async (selectedIndices: number[]) => {
                        if (selectedIndices.length === 0) {
                            return createActionResultFromHtmlDisplay(
                                `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;"><div style="border-left:3px solid #888;padding:6px 10px;background:#f8f9fa;color:#555;">No events selected. Removal cancelled.</div></div>`,
                                `Removal cancelled — no events selected.`,
                            );
                        }
                        const htmlResults: string[] = [];
                        const textResults: string[] = [];
                        for (const idx of selectedIndices) {
                            const event = events[idx];
                            const subject = event.subject || "Untitled";
                            const deleted = await provider.deleteEvent(
                                event.id,
                            );
                            if (deleted) {
                                htmlResults.push(
                                    `<div style="color:#ea4335;">Removed: <strong>${escapeHtml(subject)}</strong></div>`,
                                );
                                textResults.push(`Removed: ${subject}`);
                            } else {
                                htmlResults.push(
                                    `<div style="color:#888;">Failed to remove: <strong>${escapeHtml(subject)}</strong></div>`,
                                );
                                textResults.push(
                                    `Failed to remove: ${subject}`,
                                );
                            }
                        }
                        return createActionResultFromHtmlDisplay(
                            `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;padding:6px 0;">${htmlResults.join("")}</div>`,
                            textResults.join("\n"),
                        );
                    },
                    html,
                );
            }

            return createActionResultFromError(
                `Found ${events.length} events matching "${description}". Please be more specific (try adding a date or more details).`,
            );
        } catch (error: any) {
            debugError(chalk.red(`Error removing event: ${error.message}`));
            return createActionResultFromError(
                `Failed to remove event: ${error.message}`,
            );
        }
    }
}

// Builds the yes/no card for sign-in. Manual-config cases (no env vars)
// are returned as a plain error — the choice card is only useful when
// there's a flow we can actually drive. Already-authenticated case
// short-circuits with a confirmation message.
async function offerCalendarLogin(
    actionContext: ActionContext<CalendarActionContext>,
    choiceManager: ChoiceManager,
): Promise<ActionResult> {
    const ctx = actionContext.sessionContext.agentContext;
    const config = probeGraphConfig(process.env);
    if (!config.msGraphConfigured && !config.googleConfigured) {
        return createActionResultFromError(
            "No calendar provider configured. Set MSGRAPH_APP_CLIENTID + MSGRAPH_APP_TENANTID or GOOGLE_CALENDAR_CLIENT_ID + GOOGLE_CALENDAR_CLIENT_SECRET in `ts/.env`, then run `@config agent refresh calendar`.",
        );
    }
    if (!ctx.calendarProvider) {
        ctx.calendarProvider = createCalendarProviderFromConfig();
        if (ctx.calendarProvider) {
            ctx.providerType = ctx.calendarProvider
                .providerName as CalendarProviderType;
        }
    }
    const provider = ctx.calendarProvider;
    if (!provider) {
        return createActionResultFromError(
            "Calendar env vars are set but the provider could not be created. Check `ts/.env` and restart the agent server.",
        );
    }
    if (provider.isAuthenticated()) {
        return createActionResultFromTextDisplay(
            "Already signed in to calendar.",
        );
    }
    const providerLabel =
        ctx.providerType === "google" ? "Google Calendar" : "Microsoft 365";
    return createYesNoChoiceResult(
        choiceManager,
        `Sign in to ${providerLabel}? You'll be shown a device code (or browser link) to complete the flow. Sign-in usually takes under a minute — I'll post the result here.`,
        async (confirmed, liveActionContext) => {
            if (!confirmed) {
                return createActionResultFromTextDisplay(
                    "Sign-in skipped. Run `@calendar login` later to sign in.",
                );
            }
            return runCalendarLogin(
                liveActionContext as ActionContext<CalendarActionContext>,
            );
        },
    );
}

// Drives provider.login() in the choice callback. Streams device-code
// instructions as they arrive from the provider, so the user sees the URL
// + code as soon as the provider issues them. Exported for unit tests.
export async function runCalendarLogin(
    actionContext: ActionContext<CalendarActionContext>,
): Promise<ActionResult> {
    const ctx = actionContext.sessionContext.agentContext;
    const provider = ctx.calendarProvider;
    if (!provider) {
        return createActionResultFromError(
            "Calendar provider not initialized.",
        );
    }
    actionContext.actionIO.appendDisplay(
        {
            type: "text",
            content: `[${ts()}] Starting sign-in…`,
            kind: "status",
        },
        "block",
    );
    try {
        const success = await provider.login((prompt) => {
            actionContext.actionIO.appendDisplay(
                {
                    type: "text",
                    content: `[${ts()}] ${prompt.message}`,
                    kind: "status",
                },
                "block",
            );
        });
        if (!success) {
            const tip =
                ctx.providerType === "google"
                    ? " You can also try `@calendar google-auth <code>` with a manual authorization code."
                    : "";
            return createActionResultFromError(
                `[${ts()}] Sign-in failed.${tip}`,
            );
        }
        const user = await provider.getUser();
        return createActionResultFromTextDisplay(
            `[${ts()}] Signed in as ${user.displayName || user.email || "Unknown"}. Re-run your calendar command — readiness was re-checked automatically.`,
        );
    } catch (e: any) {
        return createActionResultFromError(
            `[${ts()}] Sign-in failed: ${e?.message ?? e}`,
        );
    }
}

// Instantiate function required by the agent loader
export function instantiate(): AppAgent {
    const handler = new CalendarActionHandlerV3();
    return {
        initializeAgentContext: () => handler.initializeAgentContext(),
        updateAgentContext: (
            enable: boolean,
            context: SessionContext<CalendarActionContext>,
        ) => handler.updateAgentContext(enable, context),
        executeAction: (
            action: AppAction,
            context: ActionContext<CalendarActionContext>,
        ) => handler.executeAction(action, context),
        handleChoice: (
            choiceId: string,
            response: boolean | number[],
            context: ActionContext<CalendarActionContext>,
        ) => handler.choiceManager.handleChoice(choiceId, response, context),
        checkReadiness: (context: SessionContext<CalendarActionContext>) =>
            handler.checkReadiness(context),
        setup: (context: ActionContext<CalendarActionContext>) =>
            handler.setup(context),
        ...getCommandInterface(handlers),
    };
}

// Validation functions for entity types
// These will be called by the grammar matcher to validate wildcard matches

export function validateCalendarDate(value: string): boolean {
    const trimmed = value.trim();
    if (trimmed.length === 0) return false;
    if (/^(today|tomorrow|yesterday)$/i.test(trimmed)) return true;
    if (/^(next|last|this)\s+\w+$/i.test(trimmed)) return true;
    return parseFuzzyDateString(trimmed) !== undefined;
}

export function validateCalendarTime(value: string): boolean {
    const trimmed = value.trim();
    if (trimmed.length === 0) return false;
    if (/^(noon|midnight|morning|evening|afternoon|night)$/i.test(trimmed))
        return true;
    if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
        const [h, m] = trimmed.split(":").map(Number);
        return h >= 0 && h <= 23 && m >= 0 && m <= 59;
    }
    if (/^\d{1,2}(am|pm)$/i.test(trimmed)) {
        const h = parseInt(trimmed, 10);
        return h >= 1 && h <= 12;
    }
    if (/^\d{1,2}:\d{2}(am|pm)$/i.test(trimmed)) {
        const [timePart] = trimmed.split(/[ap]m/i);
        const [h, m] = timePart.split(":").map(Number);
        return h >= 1 && h <= 12 && m >= 0 && m <= 59;
    }
    try {
        parseTimeString(trimmed);
        return true;
    } catch {
        return false;
    }
}

export function validateEventDescription(value: string): boolean {
    // Accept any non-empty string as event description
    return value.trim().length > 0;
}

export function validateLocationName(value: string): boolean {
    // Accept any non-empty string as location
    return value.trim().length > 0;
}

export function validateParticipantName(value: string): boolean {
    // Accept any non-empty string as participant name
    return value.trim().length > 0;
}

// Default export
export default CalendarActionHandlerV3;
