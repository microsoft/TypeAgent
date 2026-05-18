// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Calendar Provider Interface
 *
 * Abstracts calendar operations to support multiple providers (Microsoft Graph, Google Calendar, etc.)
 */

import { EventEmitter } from "events";

/**
 * Represents a calendar event in a provider-agnostic format
 */
export interface CalendarEvent {
    id: string;
    subject: string;
    body?: string;
    start: {
        dateTime: string;
        timeZone: string;
    };
    end: {
        dateTime: string;
        timeZone: string;
    };
    attendees?: CalendarAttendee[];
    location?: string;
    isAllDay?: boolean;
    htmlLink?: string;
}

/**
 * Represents an event attendee
 */
export interface CalendarAttendee {
    email: string;
    name?: string;
    type?: "required" | "optional";
    responseStatus?: "accepted" | "declined" | "tentative" | "needsAction";
}

/**
 * Query parameters for finding events by date range
 */
export interface CalendarDateRangeQuery {
    startDateTime: string;
    endDateTime: string;
    maxResults?: number;
}

/**
 * Represents a free/busy time slot
 */
export interface TimeSlot {
    start: string;
    end: string;
}

/**
 * User information from the calendar provider
 */
export interface CalendarUser {
    id: string | undefined;
    displayName: string | undefined;
    email: string | undefined;
}

/**
 * Sign-in prompt surfaced to the user during authentication.
 *
 * The MS Graph + Google flows each pick a kind based on what they need to
 * communicate: a device code, a "we're opening your browser" notice, or a
 * configuration error. Handlers branch on `kind` to render appropriately
 * (status text vs. clickable link).
 */
export type SignInPrompt =
    | {
          kind: "deviceCode";
          userCode: string;
          verificationUri: string;
          message: string;
      }
    | { kind: "browser"; url?: string; message: string }
    | { kind: "error"; message: string };

/**
 * Callback for sign-in prompts (device code, browser open, or error).
 * Renamed from DeviceCodeCallback once the browser flow was added; the old
 * (userCode, verificationUri, message) tuple shape is gone — handlers receive
 * the discriminated SignInPrompt directly.
 */
export type DeviceCodeCallback = (prompt: SignInPrompt) => void;

/**
 * Calendar provider interface - implement this for each calendar service
 */
export interface ICalendarProvider extends EventEmitter {
    /**
     * Provider name (e.g., "microsoft", "google")
     */
    readonly providerName: string;

    // =========================================================================
    // Authentication
    // =========================================================================

    /**
     * Authenticate the user (may use device code flow, OAuth, etc.)
     * @param callback Optional callback for device code flow
     * @returns true if login successful
     */
    login(callback?: DeviceCodeCallback): Promise<boolean>;

    /**
     * Log out the current user
     * @returns true if logout successful
     */
    logout(): boolean;

    /**
     * Check if user is currently authenticated
     */
    isAuthenticated(): boolean;

    /**
     * Get the current user's information
     */
    getUser(): Promise<CalendarUser>;

    // =========================================================================
    // Event Operations
    // =========================================================================

    /**
     * Create a new calendar event
     * @returns The ID of the created event, or undefined on failure
     */
    createEvent(
        subject: string,
        body: string,
        startDateTime: string,
        endDateTime: string,
        timeZone: string,
        attendees?: string[],
    ): Promise<string | undefined>;

    /**
     * Delete an event by ID
     * @returns true if deletion successful
     */
    deleteEvent(eventId: string): Promise<boolean>;

    /**
     * Find events by subject/title search
     */
    findEventsBySubject(subject: string): Promise<CalendarEvent[]>;

    /**
     * Find events within a date range
     */
    findEventsByDateRange(
        query: CalendarDateRangeQuery,
    ): Promise<CalendarEvent[]>;

    /**
     * Get calendar view for a date range (similar to findEventsByDateRange but may include recurring event instances)
     */
    getCalendarView(query: CalendarDateRangeQuery): Promise<CalendarEvent[]>;

    // =========================================================================
    // Availability
    // =========================================================================

    /**
     * Find free time slots within a date range
     * @param startTime ISO datetime string
     * @param endTime ISO datetime string
     * @param durationInMinutes Minimum slot duration
     */
    findFreeSlots(
        startTime: string,
        endTime: string,
        durationInMinutes: number,
    ): Promise<TimeSlot[]>;

    // =========================================================================
    // Participant Management
    // =========================================================================

    /**
     * Add participants to an existing event
     * @param eventId The event ID
     * @param participants Email addresses to add
     */
    addParticipants(eventId: string, participants: string[]): Promise<boolean>;

    /**
     * Resolve usernames to email addresses (provider-specific)
     * @param usernames Names to resolve
     */
    resolveUserEmails(usernames: string[]): Promise<string[]>;
}

/**
 * Calendar provider type for configuration
 */
export type CalendarProviderType = "microsoft" | "google";

/**
 * Configuration for calendar providers
 */
export interface CalendarProviderConfig {
    provider: CalendarProviderType;
    // Microsoft Graph specific
    msGraphClientId?: string;
    msGraphTenantId?: string;
    // Google Calendar specific
    googleClientId?: string;
    googleClientSecret?: string;
}
