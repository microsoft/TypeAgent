// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAction,
    AppAgent,
    ActionContext,
    ActionResult,
    SessionContext,
    ParsedCommandParams,
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
} from "@typeagent/agent-sdk/helpers/action";
import { CalendarActionV3 } from "./calendarActionsSchemaV3.js";
import {
    CalendarClient,
    ICalendarProvider,
    CalendarProviderType,
    createCalendarProviderFromConfig,
    getAvailableProviders,
    GoogleCalendarClient,
} from "graph-utils";
import {
    getNWeeksDateRangeISO,
    generateQueryFromFuzzyDay,
} from "./calendarQueryHelper.js";
import {
    getDateRelativeToDayV2,
    parseFuzzyDateString,
    parseTimeString,
} from "typechat-utils";
import chalk from "chalk";

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
            displayWarn(
                `Already logged in as ${user.displayName || "Unknown"}<${user.email || "Unknown"}>`,
                context,
            );
            return;
        }

        displayStatus(
            `Logging into ${providerType || "calendar"} service...`,
            context,
        );

        const success = await provider.login(
            (userCode, verificationUri, message) => {
                displayStatus(message, context);
            },
        );

        if (success) {
            const user = await provider.getUser();
            displaySuccess(
                `Successfully logged in as ${user.displayName || "Unknown"} <${user.email || "Unknown"}>`,
                context,
            );
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
        if (provider.logout()) {
            displaySuccess("Successfully logged out", context);
        } else {
            displayWarn("Already logged out", context);
        }
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

// Helper function to format events as HTML
function formatEventsAsHtml(events: any[]): string {
    if (!events || events.length === 0) {
        return "<p>No events found.</p>";
    }

    let html = "<ul>";
    for (const event of events) {
        const start = event.start?.dateTime
            ? new Date(event.start.dateTime).toLocaleString()
            : "Unknown";
        const end = event.end?.dateTime
            ? new Date(event.end.dateTime).toLocaleString()
            : "Unknown";
        html += `<li><strong>${event.subject || "No subject"}</strong><br/>`;
        html += `${start} - ${end}`;
        if (event.location?.displayName) {
            html += `<br/>Location: ${event.location.displayName}`;
        }
        html += "</li>";
    }
    html += "</ul>";
    return html;
}

// Calendar action handler V3 - with multi-provider calendar integration
export class CalendarActionHandlerV3 implements AppAgent {
    public async initializeAgentContext(): Promise<CalendarActionContext> {
        return {
            calendarClient: undefined,
            calendarProvider: undefined,
            providerType: undefined,
        };
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

                console.log(
                    chalk.cyan(
                        `[Calendar] Using ${provider.providerName} calendar provider`,
                    ),
                );
            } else {
                const availableProviders = getAvailableProviders();
                console.log(
                    chalk.yellow(
                        `[Calendar] No calendar provider configured. Available: ${availableProviders.length > 0 ? availableProviders.join(", ") : "none"}`,
                    ),
                );
                console.log(
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

        console.log(
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

        switch (calendarAction.actionName) {
            case "scheduleEvent":
                return await this.handleScheduleEvent(
                    calendarAction,
                    context,
                    provider,
                );
            case "findEvents":
                return await this.handleFindEvents(
                    calendarAction,
                    context,
                    provider,
                );
            case "addParticipant":
                return await this.handleAddParticipant(
                    calendarAction,
                    context,
                    provider,
                );
            case "findTodaysEvents":
                return await this.handleFindTodaysEvents(context, provider);
            case "findThisWeeksEvents":
                return await this.handleFindThisWeeksEvents(context, provider);
            default:
                console.log(
                    chalk.red(
                        `Unknown action: ${(calendarAction as any).actionName}`,
                    ),
                );
                return createActionResultFromError(
                    `Unknown action: ${(calendarAction as any).actionName}`,
                );
        }
    }

    private async handleScheduleEvent(
        action: CalendarActionV3 & { actionName: "scheduleEvent" },
        context: ActionContext<CalendarActionContext>,
        provider: ICalendarProvider,
    ): Promise<ActionResult | undefined> {
        const { description, date, time, participant } = action.parameters;

        console.log(chalk.green(`\n✓ Scheduling event: ${description}`));

        try {
            const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

            // Parse the natural language date
            let eventDate = this.parseNaturalDate(date);
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
                            console.log(
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
                        ? `${startTimeStr} - ${endTimeStr}`
                        : startTimeStr;
                return createActionResultFromHtmlDisplay(
                    `<p>✓ Event created: <strong>${description}</strong> on ${dateStr} at ${timeDisplay}</p>`,
                );
            } else {
                return createActionResultFromError("Failed to create event");
            }
        } catch (error: any) {
            console.error(chalk.red(`Error creating event: ${error.message}`));
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

    private parseTimeRange(
        timeStr: string,
    ):
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

        console.log(chalk.green(`\n✓ Searching for events`));

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
                    "<p>No events found matching your criteria.</p>",
                );
            }

            return createActionResultFromHtmlDisplay(
                formatEventsAsHtml(events),
            );
        } catch (error: any) {
            console.error(chalk.red(`Error finding events: ${error.message}`));
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

        console.log(
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
                return createActionResultFromHtmlDisplay(
                    `<p>✓ Added <strong>${participant}</strong> to <strong>${description}</strong></p>`,
                );
            } else {
                return createActionResultFromError(
                    `Failed to add ${participant} to ${description}`,
                );
            }
        } catch (error: any) {
            console.error(
                chalk.red(`Error adding participant: ${error.message}`),
            );
            return createActionResultFromError(
                `Failed to add participant: ${error.message}`,
            );
        }
    }

    private async handleFindTodaysEvents(
        context: ActionContext<CalendarActionContext>,
        provider: ICalendarProvider,
    ): Promise<ActionResult | undefined> {
        console.log(chalk.green(`\n✓ Finding today's events`));

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
                    "<p>No events scheduled for today.</p>",
                );
            }

            return createActionResultFromHtmlDisplay(
                `<h3>Today's Schedule</h3>${formatEventsAsHtml(events)}`,
            );
        } catch (error: any) {
            console.error(
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
        console.log(chalk.green(`\n✓ Finding this week's events`));

        try {
            const dateRange = getNWeeksDateRangeISO(1);
            const events = await provider.findEventsByDateRange({
                startDateTime: dateRange.startDateTime,
                endDateTime: dateRange.endDateTime,
            });

            if (!events || events.length === 0) {
                return createActionResultFromHtmlDisplay(
                    "<p>No events scheduled for this week.</p>",
                );
            }

            return createActionResultFromHtmlDisplay(
                `<h3>This Week's Schedule</h3>${formatEventsAsHtml(events)}`,
            );
        } catch (error: any) {
            console.error(
                chalk.red(`Error finding this week's events: ${error.message}`),
            );
            return createActionResultFromError(
                `Failed to find this week's events: ${error.message}`,
            );
        }
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
        ...getCommandInterface(handlers),
    };
}

// Validation functions for entity types
// These will be called by the grammar matcher to validate wildcard matches

export function validateCalendarDate(value: string): boolean {
    // TODO: Implement sophisticated date parsing
    // For now, accept any non-empty string
    return value.trim().length > 0;
}

export function validateCalendarTime(value: string): boolean {
    // TODO: Implement sophisticated time parsing
    // For now, accept any non-empty string
    return value.trim().length > 0;
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
