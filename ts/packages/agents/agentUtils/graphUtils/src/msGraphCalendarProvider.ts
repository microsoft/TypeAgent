// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Microsoft Graph Calendar Provider
 *
 * Wraps the existing CalendarClient to implement ICalendarProvider interface
 */

import { EventEmitter } from "events";
import {
    ICalendarProvider,
    CalendarEvent,
    CalendarUser,
    CalendarDateRangeQuery,
    TimeSlot,
    DeviceCodeCallback,
} from "./calendarProvider.js";
import { CalendarClient } from "./calendarClient.js";
import { DevicePromptCallback } from "./graphClient.js";

/**
 * Microsoft Graph Calendar Provider
 * Wraps the existing CalendarClient to implement the ICalendarProvider interface
 */
export class MSGraphCalendarProvider
    extends EventEmitter
    implements ICalendarProvider
{
    public readonly providerName = "microsoft";

    private client: CalendarClient;

    constructor(client?: CalendarClient) {
        super();
        this.client = client || new CalendarClient();

        // Forward events from underlying client
        this.client.on("connected", (graphClient) => {
            this.emit("connected", graphClient);
        });
        this.client.on("disconnected", () => {
            this.emit("disconnected");
        });
    }

    /**
     * Get the underlying CalendarClient for advanced operations
     */
    getUnderlyingClient(): CalendarClient {
        return this.client;
    }

    // =========================================================================
    // Authentication
    // =========================================================================

    async login(callback?: DeviceCodeCallback): Promise<boolean> {
        // The graph client and the provider interface now share the same
        // discriminated SignInPrompt shape, so this is a straight pass-through.
        const graphCallback: DevicePromptCallback | undefined = callback;
        return this.client.login(graphCallback);
    }

    logout(): boolean {
        return this.client.logout();
    }

    isAuthenticated(): boolean {
        return this.client.isAuthenticated();
    }

    async getUser(): Promise<CalendarUser> {
        const user = await this.client.getUserAsync();
        const photoUrl = await this.client.getUserPhotoAsync();
        return {
            id: user.id,
            displayName: user.displayName || undefined,
            email: user.mail || user.userPrincipalName || undefined,
            photoUrl,
        };
    }

    // =========================================================================
    // Event Operations
    // =========================================================================

    async createEvent(
        subject: string,
        body: string,
        startDateTime: string,
        endDateTime: string,
        timeZone: string,
        attendees?: string[],
    ): Promise<string | undefined> {
        return this.client.createCalendarEvent(
            subject,
            body,
            startDateTime,
            endDateTime,
            timeZone,
            attendees,
        );
    }

    async deleteEvent(eventId: string): Promise<boolean> {
        return this.client.deleteCalendarEvent(eventId);
    }

    async findEventsBySubject(subject: string): Promise<CalendarEvent[]> {
        const events = await this.client.findCalendarEventsBySubject(subject);
        return this.convertMSGraphEvents(events);
    }

    async findEventsByDateRange(
        query: CalendarDateRangeQuery,
    ): Promise<CalendarEvent[]> {
        const events = await this.client.findCalendarEventsByDateRange({
            startDateTime: query.startDateTime,
            endDateTime: query.endDateTime,
        });
        return this.convertMSGraphEvents(events);
    }

    async getCalendarView(
        query: CalendarDateRangeQuery,
    ): Promise<CalendarEvent[]> {
        // Build query string for the underlying client
        const queryString = `startDateTime=${encodeURIComponent(query.startDateTime)}&endDateTime=${encodeURIComponent(query.endDateTime)}`;
        const events = await this.client.findCalendarView(queryString);
        return this.convertMSGraphEvents(events);
    }

    // =========================================================================
    // Availability
    // =========================================================================

    async findFreeSlots(
        startTime: string,
        endTime: string,
        durationInMinutes: number,
    ): Promise<TimeSlot[]> {
        const slots = await this.client.findFreeSlots(
            startTime,
            endTime,
            durationInMinutes,
        );
        return slots.map((s) => ({
            start: s.start,
            end: s.end,
        }));
    }

    // =========================================================================
    // Participant Management
    // =========================================================================

    async addParticipants(
        eventId: string,
        participants: string[],
    ): Promise<boolean> {
        // Use the underlying client's method
        const result = await this.client.addParticipantsToExistingMeeting(
            eventId,
            [], // existing attendees (will be fetched by the method)
            participants,
        );
        return typeof result === "string"; // Returns eventId on success, ErrorResponse on failure
    }

    async resolveUserEmails(usernames: string[]): Promise<string[]> {
        return this.client.getEmailAddressesOfUsernames(usernames);
    }

    // =========================================================================
    // Helper Methods
    // =========================================================================

    private convertMSGraphEvents(msEvents: any[]): CalendarEvent[] {
        if (!msEvents) return [];

        return msEvents.map((me) => ({
            id: me.id,
            subject: me.subject || "(No title)",
            body: me.bodyPreview || me.body?.content,
            start: {
                dateTime: me.start?.dateTime,
                timeZone: me.start?.timeZone || "UTC",
            },
            end: {
                dateTime: me.end?.dateTime,
                timeZone: me.end?.timeZone || "UTC",
            },
            attendees: me.attendees?.map((a: any) => ({
                email: a.emailAddress?.address,
                name: a.emailAddress?.name,
                type: a.type === "optional" ? "optional" : "required",
                responseStatus: this.convertResponseStatus(a.status?.response),
            })),
            location: me.location?.displayName,
            isAllDay: me.isAllDay,
        }));
    }

    private convertResponseStatus(
        msStatus: string | undefined,
    ): "accepted" | "declined" | "tentative" | "needsAction" | undefined {
        switch (msStatus) {
            case "accepted":
                return "accepted";
            case "declined":
                return "declined";
            case "tentativelyAccepted":
                return "tentative";
            case "notResponded":
                return "needsAction";
            default:
                return undefined;
        }
    }
}

// Export singleton factory
let msGraphProviderInstance: MSGraphCalendarProvider | undefined;

export function getMSGraphCalendarProvider(
    existingClient?: CalendarClient,
): MSGraphCalendarProvider {
    if (!msGraphProviderInstance) {
        msGraphProviderInstance = new MSGraphCalendarProvider(existingClient);
    }
    return msGraphProviderInstance;
}
