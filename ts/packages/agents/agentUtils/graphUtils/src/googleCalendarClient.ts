// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Google Calendar Provider Implementation
 *
 * Implements ICalendarProvider for Google Calendar API.
 * Uses a local HTTP redirect listener for OAuth (like the player agent),
 * with automatic token refresh. Token is stored in a shared location
 * (~/.typeagent/google_auth_token.json) so calendar and email can share it.
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
import registerDebug from "debug";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as http from "http";
import * as url from "url";

const debug = registerDebug("typeagent:graphUtils:googlecalendar");
const debugError = registerDebug("typeagent:graphUtils:googlecalendar:error");

// Buffer before token expiry to trigger refresh (60 seconds)
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;

// Google OAuth scopes shared across Google services (calendar, email, etc.)
// Exported so googleEmailClient.ts can reuse the same scopes
export const GOOGLE_AUTH_SCOPES = [
    // Calendar
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events",
    // User info (shared)
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    // Gmail
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
];

// Google API types
interface GoogleAuth {
    generateAuthUrl(options: any): string;
    getToken(code: string): Promise<any>;
    setCredentials(tokens: any): void;
    refreshAccessToken(): Promise<any>;
    on(event: string, callback: (...args: any[]) => void): void;
    credentials: any;
}

interface GoogleCalendarAPI {
    events: {
        list(params: any): Promise<any>;
        insert(params: any): Promise<any>;
        delete(params: any): Promise<any>;
        patch(params: any): Promise<any>;
        get(params: any): Promise<any>;
    };
    freebusy: {
        query(params: any): Promise<any>;
    };
}

/**
 * Load Google auth settings from environment variables.
 * These are shared across Google services (calendar, email, etc.)
 */
export function loadGoogleCalendarSettings():
    | {
          clientId: string;
          clientSecret: string;
      }
    | undefined {
    const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        debug("Google Calendar credentials not configured");
        return undefined;
    }

    return { clientId, clientSecret };
}

/**
 * Shared token path for Google auth.
 * Both calendar and email agents use the same token file.
 * Exported so googleEmailClient.ts can reuse it.
 */
export function getGoogleAuthTokenPath(): string {
    const typeagentDir = path.join(os.homedir(), ".typeagent");
    if (!fs.existsSync(typeagentDir)) {
        fs.mkdirSync(typeagentDir, { recursive: true });
    }
    return path.join(typeagentDir, "google_auth_token.json");
}

/**
 * Google Calendar client implementing ICalendarProvider.
 *
 * Auth flow (modeled after the player agent):
 * 1. login() starts a local HTTP server on the redirect port
 * 2. Opens the browser to the Google consent page
 * 3. After user authorizes, Google redirects to the local server
 * 4. Server captures the auth code, exchanges it for tokens
 * 5. Tokens (including refresh token) are saved to disk
 * 6. On subsequent logins, the refresh token is used silently
 */
export class GoogleCalendarClient
    extends EventEmitter
    implements ICalendarProvider
{
    public readonly providerName = "google";

    private auth: GoogleAuth | undefined;
    private calendar: GoogleCalendarAPI | undefined;
    private currentUser: CalendarUser | undefined;
    private _isAuthenticated = false;
    private tokenExpiryTime = 0;

    // Dynamically imported googleapis
    private google: any;

    constructor() {
        super();
        this.initializeClient();
    }

    private async initializeClient(): Promise<void> {
        try {
            const { google } = await import("googleapis");
            this.google = google;

            const settings = loadGoogleCalendarSettings();
            if (!settings) {
                debug(
                    "Google Calendar not configured, skipping initialization",
                );
                return;
            }

            // Create OAuth2 client without a fixed redirect URI.
            // For Desktop app clients, Google allows any loopback port
            // dynamically - the redirect URI is set at login time using
            // whatever ephemeral port the OS assigns.
            this.auth = new google.auth.OAuth2(
                settings.clientId,
                settings.clientSecret,
            ) as unknown as GoogleAuth;

            // Listen for token refresh events from the Google client
            this.auth.on("tokens", (tokens: any) => {
                this.onTokensRefreshed(tokens);
            });

            // Try to load existing token for silent login
            await this.tryLoadToken();
        } catch (error) {
            debugError(`Failed to initialize Google Calendar client: ${error}`);
        }
    }

    /**
     * Called when the Google OAuth2 client auto-refreshes tokens.
     * Saves the updated tokens to disk.
     */
    private onTokensRefreshed(tokens: any): void {
        debug("Google tokens refreshed automatically");
        // Merge with existing credentials (refresh_token may not be in the response)
        const existingCredentials = this.auth?.credentials || {};
        const merged = { ...existingCredentials, ...tokens };
        this.saveToken(merged);
        if (tokens.expiry_date) {
            this.tokenExpiryTime = tokens.expiry_date;
        }
    }

    private async tryLoadToken(): Promise<boolean> {
        const tokenPath = getGoogleAuthTokenPath();
        if (fs.existsSync(tokenPath)) {
            try {
                const tokenData = JSON.parse(
                    fs.readFileSync(tokenPath, "utf-8"),
                );
                if (this.auth) {
                    this.auth.setCredentials(tokenData);

                    // Track token expiry
                    if (tokenData.expiry_date) {
                        this.tokenExpiryTime = tokenData.expiry_date;
                    }

                    // If we have a refresh token, we can refresh silently
                    if (tokenData.refresh_token) {
                        // Check if access token is expired
                        if (this.isTokenExpired()) {
                            debug(
                                "Access token expired, refreshing with refresh token",
                            );
                            try {
                                const { credentials } = await (
                                    this.auth as any
                                ).refreshAccessToken();
                                this.auth.setCredentials(credentials);
                                this.saveToken(credentials);
                                if (credentials.expiry_date) {
                                    this.tokenExpiryTime =
                                        credentials.expiry_date;
                                }
                            } catch (refreshError) {
                                debugError(
                                    `Failed to refresh token: ${refreshError}`,
                                );
                                return false;
                            }
                        }

                        this.calendar = this.google.calendar({
                            version: "v3",
                            auth: this.auth,
                        });
                        this._isAuthenticated = true;
                        this.emit("connected", this.calendar);
                        debug("Loaded and validated Google auth token");
                        return true;
                    }
                }
            } catch (error) {
                debugError(`Failed to load token: ${error}`);
            }
        }
        return false;
    }

    private isTokenExpired(): boolean {
        if (this.tokenExpiryTime === 0) return false;
        return Date.now() >= this.tokenExpiryTime - TOKEN_EXPIRY_BUFFER_MS;
    }

    /**
     * Ensure we have a valid access token before making API calls.
     * Refreshes automatically if expired.
     */
    private async ensureValidToken(): Promise<void> {
        if (!this.auth || !this._isAuthenticated) return;
        if (this.isTokenExpired() && this.auth.credentials?.refresh_token) {
            debug("Access token expired, auto-refreshing");
            try {
                const { credentials } = await (
                    this.auth as any
                ).refreshAccessToken();
                this.auth.setCredentials(credentials);
                this.saveToken(credentials);
                if (credentials.expiry_date) {
                    this.tokenExpiryTime = credentials.expiry_date;
                }
            } catch (error) {
                debugError(`Token refresh failed: ${error}`);
                this._isAuthenticated = false;
                throw new Error(
                    "Token refresh failed. Please run '@calendar login' again.",
                );
            }
        }
    }

    private saveToken(tokens: any): void {
        const tokenPath = getGoogleAuthTokenPath();
        fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
        debug("Saved Google auth token");
    }

    // =========================================================================
    // Authentication
    // =========================================================================

    /**
     * Login to Google Calendar.
     *
     * If a valid refresh token exists on disk, silently refreshes and returns true.
     * Otherwise, starts a local HTTP server, opens the browser for consent,
     * and waits for the redirect callback with the auth code.
     */
    async login(callback?: DeviceCodeCallback): Promise<boolean> {
        if (!this.auth) {
            await this.initializeClient();
            if (!this.auth) {
                const msg =
                    "Google Calendar not configured. Set GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET.";
                debugError(msg);
                if (callback) {
                    callback("ERROR", "", msg);
                }
                return false;
            }
        }

        // Already authenticated with valid token
        if (this._isAuthenticated && this.auth.credentials?.access_token) {
            // Try a quick refresh if expired
            if (this.isTokenExpired() && this.auth.credentials?.refresh_token) {
                try {
                    await this.ensureValidToken();
                    return true;
                } catch {
                    // Fall through to interactive login
                }
            } else {
                return true;
            }
        }

        // Try silent login with stored refresh token
        if (await this.tryLoadToken()) {
            return true;
        }

        // Interactive login: start local redirect server and open browser
        return this.interactiveLogin(callback);
    }

    /**
     * Start a local HTTP server on an ephemeral port, open browser for
     * Google consent, capture the redirect with auth code, exchange for tokens.
     *
     * For Desktop app clients, Google allows any loopback port dynamically -
     * no need to pre-register the redirect URI in the Cloud Console.
     */
    private async interactiveLogin(
        callback?: DeviceCodeCallback,
    ): Promise<boolean> {
        // Start local HTTP server on port 0 (OS assigns a free port)
        const { authCode, redirectUri } =
            await this.startRedirectListenerAndAuthorize(callback);

        if (!authCode) {
            debugError("Did not receive authorization code");
            return false;
        }

        // Exchange authorization code for tokens, passing the exact
        // redirect URI that was used in the auth URL
        return this.completeAuth(authCode, redirectUri);
    }

    /**
     * Start a temporary HTTP server on an ephemeral port, generate the
     * auth URL with that port's redirect URI, open the browser, and wait
     * for Google to redirect back with the code.
     */
    private startRedirectListenerAndAuthorize(
        callback?: DeviceCodeCallback,
    ): Promise<{ authCode: string | undefined; redirectUri: string }> {
        return new Promise((resolve) => {
            const server = http.createServer((req, res) => {
                const parsedUrl = url.parse(req.url || "", true);

                if (parsedUrl.pathname === "/oauth2callback") {
                    const code = parsedUrl.query.code as string | undefined;
                    const error = parsedUrl.query.error as string | undefined;

                    if (error) {
                        res.writeHead(200, { "Content-Type": "text/html" });
                        const safeError = String(error)
                            .replace(/&/g, "&amp;")
                            .replace(/</g, "&lt;")
                            .replace(/>/g, "&gt;");
                        res.end(
                            "<html><body><h2>Authorization Failed</h2>" +
                                `<p>Error: ${safeError}</p>` +
                                "<p>You can close this window.</p></body></html>",
                        );
                        server.close();
                        resolve({ authCode: undefined, redirectUri: "" });
                    } else if (code) {
                        res.writeHead(200, { "Content-Type": "text/html" });
                        res.end(
                            "<html><body><h2>Authorization Successful!</h2>" +
                                "<p>You can close this window and return to TypeAgent.</p></body></html>",
                        );
                        server.close();
                        resolve({
                            authCode: code,
                            redirectUri: actualRedirectUri,
                        });
                    } else {
                        res.writeHead(400, { "Content-Type": "text/html" });
                        res.end(
                            "<html><body><h2>Missing authorization code</h2></body></html>",
                        );
                    }
                } else {
                    res.writeHead(404);
                    res.end();
                }
            });

            let actualRedirectUri = "";

            // Listen on port 0 = OS assigns an available ephemeral port
            server.listen(0, "127.0.0.1", async () => {
                const addr = server.address();
                const port = typeof addr === "object" && addr ? addr.port : 0;
                actualRedirectUri = `http://127.0.0.1:${port}/oauth2callback`;

                debug(
                    `OAuth redirect listener started on ${actualRedirectUri}`,
                );

                // Generate auth URL with the dynamic redirect URI
                const authUrl = (this.auth as GoogleAuth).generateAuthUrl({
                    access_type: "offline",
                    scope: GOOGLE_AUTH_SCOPES,
                    prompt: "consent",
                    redirect_uri: actualRedirectUri,
                });

                if (callback) {
                    callback(
                        "BROWSER_AUTH",
                        authUrl,
                        "Opening browser for Google authorization...",
                    );
                }

                try {
                    const open = (await import("open")).default;
                    await open(authUrl, { wait: false });
                    debug("Opened browser for Google authorization");
                } catch (err) {
                    console.log(
                        `\nPlease open this URL in your browser:\n${authUrl}\n`,
                    );
                }
            });

            // Timeout after 5 minutes
            setTimeout(
                () => {
                    server.close();
                    debugError("OAuth callback timed out after 5 minutes");
                    resolve({ authCode: undefined, redirectUri: "" });
                },
                5 * 60 * 1000,
            );
        });
    }

    /**
     * Complete the OAuth flow with an authorization code.
     * Called automatically by the redirect listener, or manually via google-auth command.
     * @param redirectUri - The exact redirect URI used when generating the auth URL
     *                      (required for ephemeral port matching)
     */
    async completeAuth(
        authorizationCode: string,
        redirectUri?: string,
    ): Promise<boolean> {
        if (!this.auth) {
            debugError("Auth not initialized");
            return false;
        }

        try {
            // Pass redirect_uri explicitly to match the one used in the auth URL.
            // For ephemeral ports, the OAuth2 client won't know the URI otherwise.
            const tokenOptions: any = { code: authorizationCode };
            if (redirectUri) {
                tokenOptions.redirect_uri = redirectUri;
            }
            const { tokens } = await (this.auth as any).getToken(tokenOptions);
            this.auth.setCredentials(tokens);
            this.saveToken(tokens);

            if (tokens.expiry_date) {
                this.tokenExpiryTime = tokens.expiry_date;
            }

            this.calendar = this.google.calendar({
                version: "v3",
                auth: this.auth,
            });
            this._isAuthenticated = true;
            this.emit("connected", this.calendar);

            debug("Google Calendar authentication successful");
            return true;
        } catch (error: any) {
            debugError(`Failed to complete auth: ${error}`);
            console.error(`[Google Calendar] Auth failed: ${error}`);
            console.error(`[Google Calendar] error.code=${error?.code} error.type=${error?.type} error.cause=${error?.cause} error.status=${error?.status}`);
            if (error?.stack) console.error(error.stack);
            return false;
        }
    }

    logout(): boolean {
        const tokenPath = getGoogleAuthTokenPath();
        if (fs.existsSync(tokenPath)) {
            fs.unlinkSync(tokenPath);
        }
        this._isAuthenticated = false;
        this.currentUser = undefined;
        this.calendar = undefined;
        this.tokenExpiryTime = 0;
        this.emit("disconnected");
        debug("Logged out of Google Calendar");
        return true;
    }

    isAuthenticated(): boolean {
        return this._isAuthenticated;
    }

    async getUser(): Promise<CalendarUser> {
        if (this.currentUser) {
            return this.currentUser;
        }

        if (!this._isAuthenticated || !this.auth) {
            throw new Error("Not authenticated");
        }

        await this.ensureValidToken();

        try {
            const oauth2 = this.google.oauth2({
                version: "v2",
                auth: this.auth,
            });
            const response = await oauth2.userinfo.get();

            this.currentUser = {
                id: response.data.id,
                displayName: response.data.name,
                email: response.data.email,
            };

            return this.currentUser;
        } catch (error) {
            debugError(`Failed to get user info: ${error}`);
            throw error;
        }
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
        if (!this.calendar) {
            const msg =
                "Google Calendar not initialized - please run '@calendar login' first";
            debugError(msg);
            console.error(`[Google Calendar] ${msg}`);
            return undefined;
        }

        await this.ensureValidToken();

        try {
            const event: any = {
                summary: subject,
                description: body,
                start: {
                    dateTime: startDateTime,
                    timeZone: timeZone,
                },
                end: {
                    dateTime: endDateTime,
                    timeZone: timeZone,
                },
            };

            if (attendees && attendees.length > 0) {
                event.attendees = attendees.map((email) => ({ email }));
            }

            debug(`Creating event: ${JSON.stringify(event)}`);
            const response = await this.calendar.events.insert({
                calendarId: "primary",
                requestBody: event,
                sendUpdates: attendees ? "all" : "none",
            });

            debug(`Created event: ${response.data.id}`);
            return response.data.id;
        } catch (error: any) {
            const errorMsg =
                error?.message || error?.toString() || "Unknown error";
            debugError(`Failed to create event: ${errorMsg}`);
            console.error(
                `[Google Calendar] Failed to create event: ${errorMsg}`,
            );
            if (error?.response?.data) {
                console.error(
                    `[Google Calendar] API Error:`,
                    JSON.stringify(error.response.data, null, 2),
                );
            }
            return undefined;
        }
    }

    async deleteEvent(eventId: string): Promise<boolean> {
        if (!this.calendar) {
            debugError("Calendar not initialized");
            return false;
        }

        await this.ensureValidToken();

        try {
            await this.calendar.events.delete({
                calendarId: "primary",
                eventId: eventId,
            });
            debug(`Deleted event: ${eventId}`);
            return true;
        } catch (error) {
            debugError(`Failed to delete event: ${error}`);
            return false;
        }
    }

    async findEventsBySubject(subject: string): Promise<CalendarEvent[]> {
        if (!this.calendar) {
            debugError("Calendar not initialized");
            return [];
        }

        await this.ensureValidToken();

        try {
            const response = await this.calendar.events.list({
                calendarId: "primary",
                q: subject,
                maxResults: 50,
                singleEvents: true,
                orderBy: "startTime",
            });

            return this.convertGoogleEvents(response.data.items || []);
        } catch (error) {
            debugError(`Failed to find events: ${error}`);
            return [];
        }
    }

    async findEventsByDateRange(
        query: CalendarDateRangeQuery,
    ): Promise<CalendarEvent[]> {
        if (!this.calendar) {
            debugError("Calendar not initialized");
            return [];
        }

        await this.ensureValidToken();

        try {
            const response = await this.calendar.events.list({
                calendarId: "primary",
                timeMin: query.startDateTime,
                timeMax: query.endDateTime,
                maxResults: query.maxResults || 100,
                singleEvents: true,
                orderBy: "startTime",
            });

            return this.convertGoogleEvents(response.data.items || []);
        } catch (error) {
            debugError(`Failed to find events by date range: ${error}`);
            return [];
        }
    }

    async getCalendarView(
        query: CalendarDateRangeQuery,
    ): Promise<CalendarEvent[]> {
        return this.findEventsByDateRange(query);
    }

    // =========================================================================
    // Availability
    // =========================================================================

    async findFreeSlots(
        startTime: string,
        endTime: string,
        durationInMinutes: number,
    ): Promise<TimeSlot[]> {
        if (!this.calendar) {
            debugError("Calendar not initialized");
            return [];
        }

        await this.ensureValidToken();

        try {
            const user = await this.getUser();
            if (!user.email) {
                debugError("User email not available");
                return [];
            }

            const response = await this.calendar.freebusy.query({
                requestBody: {
                    timeMin: startTime,
                    timeMax: endTime,
                    items: [{ id: user.email }],
                },
            });

            const busyTimes = response.data.calendars?.[user.email]?.busy || [];

            const freeSlots: TimeSlot[] = [];
            let currentStart = new Date(startTime);
            const endDate = new Date(endTime);

            for (const busy of busyTimes) {
                const busyStart = new Date(busy.start);
                const busyEnd = new Date(busy.end);

                if (currentStart < busyStart) {
                    const slotDuration =
                        (busyStart.getTime() - currentStart.getTime()) / 60000;
                    if (slotDuration >= durationInMinutes) {
                        freeSlots.push({
                            start: currentStart.toISOString(),
                            end: busyStart.toISOString(),
                        });
                    }
                }
                currentStart = busyEnd;
            }

            if (currentStart < endDate) {
                const slotDuration =
                    (endDate.getTime() - currentStart.getTime()) / 60000;
                if (slotDuration >= durationInMinutes) {
                    freeSlots.push({
                        start: currentStart.toISOString(),
                        end: endDate.toISOString(),
                    });
                }
            }

            return freeSlots;
        } catch (error) {
            debugError(`Failed to find free slots: ${error}`);
            return [];
        }
    }

    // =========================================================================
    // Participant Management
    // =========================================================================

    async addParticipants(
        eventId: string,
        participants: string[],
    ): Promise<boolean> {
        if (!this.calendar) {
            debugError("Calendar not initialized");
            return false;
        }

        await this.ensureValidToken();

        try {
            const event = await this.calendar.events.get({
                calendarId: "primary",
                eventId: eventId,
            });

            const existingAttendees = event.data.attendees || [];
            const newAttendees = participants.map((email) => ({ email }));

            const existingEmails = new Set(
                existingAttendees.map((a: any) => a.email?.toLowerCase()),
            );
            const mergedAttendees = [
                ...existingAttendees,
                ...newAttendees.filter(
                    (a) => !existingEmails.has(a.email.toLowerCase()),
                ),
            ];

            await this.calendar.events.patch({
                calendarId: "primary",
                eventId: eventId,
                requestBody: {
                    attendees: mergedAttendees,
                },
                sendUpdates: "all",
            });

            debug(`Added participants to event: ${eventId}`);
            return true;
        } catch (error) {
            debugError(`Failed to add participants: ${error}`);
            return false;
        }
    }

    async resolveUserEmails(usernames: string[]): Promise<string[]> {
        debug(
            "Google Calendar: resolveUserEmails returns usernames as-is (no directory lookup)",
        );
        return usernames;
    }

    // =========================================================================
    // Helper Methods
    // =========================================================================

    private convertGoogleEvents(googleEvents: any[]): CalendarEvent[] {
        return googleEvents.map((ge) => {
            const event: CalendarEvent = {
                id: ge.id,
                subject: ge.summary || "(No title)",
                body: ge.description,
                start: {
                    dateTime: ge.start?.dateTime || ge.start?.date,
                    timeZone: ge.start?.timeZone || "UTC",
                },
                end: {
                    dateTime: ge.end?.dateTime || ge.end?.date,
                    timeZone: ge.end?.timeZone || "UTC",
                },
                attendees: ge.attendees?.map((a: any) => ({
                    email: a.email,
                    name: a.displayName,
                    type: a.optional ? "optional" : "required",
                    responseStatus: a.responseStatus,
                })),
                location: ge.location,
                isAllDay: !!ge.start?.date,
            };
            if (ge.htmlLink) {
                event.htmlLink = ge.htmlLink;
            }
            return event;
        });
    }
}

// Export singleton factory
let googleCalendarInstance: GoogleCalendarClient | undefined;

export function getGoogleCalendarClient(): GoogleCalendarClient {
    if (!googleCalendarInstance) {
        googleCalendarInstance = new GoogleCalendarClient();
    }
    return googleCalendarInstance;
}
