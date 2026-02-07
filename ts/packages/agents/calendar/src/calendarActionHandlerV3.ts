// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAction,
    AppAgent,
    ActionContext,
    ActionResult,
    SessionContext,
} from "@typeagent/agent-sdk";
import {
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
    createCalendarGraphClient,
    CalendarClient,
} from "graph-utils";
import { getNWeeksDateRangeISO, generateQueryFromFuzzyDay } from "./calendarQueryHelper.js";
import { createCalendarGraphClient, CalendarClient } from "graph-utils";
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
    calendarClient: CalendarClient | undefined;
};

// Login command handler
export class CalendarClientLoginCommandHandler
    implements CommandHandlerNoParams
{
    public readonly description = "Log into MS Graph to access calendar";
    public async run(context: ActionContext<CalendarActionContext>) {
        const calendarClient: CalendarClient | undefined =
            context.sessionContext.agentContext.calendarClient;
        if (calendarClient === undefined) {
            throw new Error("Calendar client not initialized");
        }
        if (calendarClient.isAuthenticated()) {
            const name = await calendarClient.getUserAsync();
            displayWarn(
                `Already logged in as ${name.displayName}<${name.mail}>`,
                context,
            );
            return;
        }

        await calendarClient.login((prompt) => {
            displayStatus(prompt, context);
        });

        const name = await calendarClient.getUserAsync();
        displaySuccess(
            `Successfully logged in as ${name.displayName}<${name.mail}>`,
            context,
        );
    }
}

// Logout command handler
export class CalendarClientLogoutCommandHandler
    implements CommandHandlerNoParams
{
    public readonly description = "Log out of MS Graph to access calendar";
    public async run(context: ActionContext<CalendarActionContext>) {
        const calendarClient: CalendarClient | undefined =
            context.sessionContext.agentContext.calendarClient;
        if (calendarClient === undefined) {
            throw new Error("Calendar client not initialized");
        }
        if (calendarClient.logout()) {
            displaySuccess("Successfully logged out", context);
        } else {
            displayWarn("Already logged out", context);
        }
    }
}

const handlers: CommandHandlerTable = {
    description: "Calendar login command",
    defaultSubCommand: "login",
    commands: {
        login: new CalendarClientLoginCommandHandler(),
        logout: new CalendarClientLogoutCommandHandler(),
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

// Calendar action handler V3 - with Graph API integration
export class CalendarActionHandlerV3 implements AppAgent {
    public async initializeAgentContext(): Promise<CalendarActionContext> {
        return {
            calendarClient: undefined,
        };
    }

    public async updateAgentContext(
        enable: boolean,
        context: SessionContext<CalendarActionContext>,
    ): Promise<void> {
        if (enable) {
            context.agentContext.calendarClient =
                await createCalendarGraphClient();
        } else {
            context.agentContext.calendarClient = undefined;
        }
    }

    public async executeAction(
        action: AppAction,
        context: ActionContext<CalendarActionContext>,
    ): Promise<ActionResult | undefined> {
        const calendarAction = action as CalendarActionV3;
        const calendarClient =
            context.sessionContext.agentContext.calendarClient;

        console.log(
            chalk.cyan(
                `\n[Calendar V3] Executing action: ${calendarAction.actionName}`,
            ),
        );

        if (!calendarClient) {
            return createActionResultFromError(
                "Calendar client not initialized. Please run '@calendar login' first.",
            );
        }

        if (!calendarClient.isAuthenticated()) {
            return createActionResultFromError(
                "Not logged in. Please run '@calendar login' first.",
            );
        }

        switch (calendarAction.actionName) {
            case "scheduleEvent":
                return await this.handleScheduleEvent(
                    calendarAction,
                    context,
                    calendarClient,
                );
            case "findEvents":
                return await this.handleFindEvents(
                    calendarAction,
                    context,
                    calendarClient,
                );
            case "addParticipant":
                return await this.handleAddParticipant(
                    calendarAction,
                    context,
                    calendarClient,
                );
            case "findTodaysEvents":
                return await this.handleFindTodaysEvents(
                    context,
                    calendarClient,
                );
            case "findThisWeeksEvents":
                return await this.handleFindThisWeeksEvents(
                    context,
                    calendarClient,
                );
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
        client: CalendarClient,
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
            if (time) {
                // Try simple parsing like "2pm", "14:00"
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

            eventDate.setHours(startHour, startMinute, 0, 0);
            const endDate = new Date(eventDate);
            endDate.setHours(startHour + 1); // Default 1 hour duration

            const startDateTime = eventDate.toISOString();
            const endDateTime = endDate.toISOString();
            const attendees = participant ? [participant] : undefined;

            // Create the event via Graph API using correct signature
            const eventId = await client.createCalendarEvent(
                description, // subject
                "", // body
                startDateTime, // startDateTime
                endDateTime, // endDateTime
                timeZone, // timeZone
                attendees, // attendees
            );

            if (eventId) {
                const dateStr = eventDate.toLocaleDateString();
                const timeStr = eventDate.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                });
                return createActionResultFromHtmlDisplay(
                    `<p>✓ Event created: <strong>${description}</strong> on ${dateStr} at ${timeStr}</p>`,
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
        
        return undefined;
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

    private async handleFindEvents(
        action: CalendarActionV3 & { actionName: "findEvents" },
        context: ActionContext<CalendarActionContext>,
        client: CalendarClient,
    ): Promise<ActionResult | undefined> {
        const { date, description } = action.parameters;

        console.log(chalk.green(`\n✓ Searching for events`));

        try {
            let events: any[] = [];

            if (description) {
                // Search by description using embeddings
                events = (await client.findEventsFromEmbeddings(
                    description,
                )) as any[];
            } else if (date) {
                // Try to use generateQueryFromFuzzyDay for natural language dates
                const query = generateQueryFromFuzzyDay(date);
                if (query) {
                    events = await client.findCalendarEventsByDateRange(query);
                } else {
                    // Fall back to parsing the date manually
                    const parsedDate = this.parseNaturalDate(date);
                    if (parsedDate) {
                        const startDate = new Date(parsedDate);
                        startDate.setHours(0, 0, 0, 0);
                        const endDate = new Date(parsedDate);
                        endDate.setHours(23, 59, 59, 999);
                        const manualQuery = `startDateTime=${startDate.toISOString()}&endDateTime=${endDate.toISOString()}`;
                        events =
                            await client.findCalendarEventsByDateRange(
                                manualQuery,
                            );
                    } else {
                        return createActionResultFromError(
                            `Could not parse date: ${date}`,
                        );
                    }
                }
            } else {
                // Default: get this week's events
                const dateRange = getNWeeksDateRangeISO(1);
                const query = `startDateTime=${dateRange.startDateTime}&endDateTime=${dateRange.endDateTime}`;
                events = await client.findCalendarEventsByDateRange(query);
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
        client: CalendarClient,
    ): Promise<ActionResult | undefined> {
        const { description, participant } = action.parameters;

        console.log(
            chalk.green(
                `\n✓ Adding participant ${participant} to ${description}`,
            ),
        );

        try {
            // Find the event first - returns event objects despite type saying string[]
            const events = (await client.findEventsFromEmbeddings(
                description,
            )) as any[];
            if (!events || events.length === 0) {
                return createActionResultFromError(
                    `Could not find event: ${description}`,
                );
            }

            const event = events[0];
            // Add participant to the event using the correct API
            await client.addParticipantsToExistingMeeting(
                event.id,
                event.attendees || [],
                [participant],
            );

            return createActionResultFromHtmlDisplay(
                `<p>✓ Added <strong>${participant}</strong> to <strong>${description}</strong></p>`,
            );
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
        client: CalendarClient,
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

            const query = `startDateTime=${startOfDay.toISOString()}&endDateTime=${endOfDay.toISOString()}`;
            const events = await client.findCalendarEventsByDateRange(query);

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
        client: CalendarClient,
    ): Promise<ActionResult | undefined> {
        console.log(chalk.green(`\n✓ Finding this week's events`));

        try {
            const dateRange = getNWeeksDateRangeISO(1);
            const query = `startDateTime=${dateRange.startDateTime}&endDateTime=${dateRange.endDateTime}`;
            const events = await client.findCalendarEventsByDateRange(query);

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
