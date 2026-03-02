// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Google Gmail Provider Implementation
 *
 * Implements IEmailProvider for Gmail API.
 * Shares the same OAuth token as Google Calendar
 * (~/.typeagent/google_auth_token.json).
 */

import { EventEmitter } from "events";
import {
    IEmailProvider,
    EmailMessage,
    EmailUser,
    EmailSearchQuery,
    EmailDeviceCodeCallback,
} from "./emailProvider.js";
import {
    loadGoogleCalendarSettings,
    getGoogleAuthTokenPath,
    GOOGLE_AUTH_SCOPES,
} from "./googleCalendarClient.js";
import registerDebug from "debug";
import * as fs from "fs";
import * as http from "http";
import * as url from "url";

const debug = registerDebug("typeagent:graphUtils:googleemail");
const debugError = registerDebug("typeagent:graphUtils:googleemail:error");

const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;

// Gmail API type
interface GmailAPI {
    users: {
        messages: {
            list(params: any): Promise<any>;
            get(params: any): Promise<any>;
            send(params: any): Promise<any>;
            modify(params: any): Promise<any>;
        };
        getProfile(params: any): Promise<any>;
    };
}

// Google Auth type
interface GoogleAuth {
    generateAuthUrl(options: any): string;
    getToken(code: string): Promise<any>;
    setCredentials(tokens: any): void;
    refreshAccessToken(): Promise<any>;
    on(event: string, callback: (...args: any[]) => void): void;
    credentials: any;
}

export class GoogleEmailClient extends EventEmitter implements IEmailProvider {
    public readonly providerName = "google";

    private auth: GoogleAuth | undefined;
    private gmail: GmailAPI | undefined;
    private currentUser: EmailUser | undefined;
    private _isAuthenticated = false;
    private tokenExpiryTime = 0;
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
                debug("Google not configured, skipping initialization");
                return;
            }

            this.auth = new google.auth.OAuth2(
                settings.clientId,
                settings.clientSecret,
            ) as unknown as GoogleAuth;

            this.auth.on("tokens", (tokens: any) => {
                this.onTokensRefreshed(tokens);
            });

            await this.tryLoadToken();
        } catch (error) {
            debugError(`Failed to initialize Google email client: ${error}`);
        }
    }

    private onTokensRefreshed(tokens: any): void {
        debug("Google tokens refreshed automatically");
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
                    if (tokenData.expiry_date) {
                        this.tokenExpiryTime = tokenData.expiry_date;
                    }
                    if (tokenData.refresh_token) {
                        if (this.isTokenExpired()) {
                            debug("Access token expired, refreshing");
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
                        this.gmail = this.google.gmail({
                            version: "v1",
                            auth: this.auth,
                        });
                        this._isAuthenticated = true;
                        this.emit("connected", this.gmail);
                        debug(
                            "Loaded and validated Google auth token for Gmail",
                        );
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
                    "Token refresh failed. Please run '@email login' again.",
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

    async login(callback?: EmailDeviceCodeCallback): Promise<boolean> {
        if (!this.auth) {
            await this.initializeClient();
            if (!this.auth) {
                const msg =
                    "Google not configured. Set GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET.";
                debugError(msg);
                if (callback) callback("ERROR", "", msg);
                return false;
            }
        }

        if (this._isAuthenticated && this.auth.credentials?.access_token) {
            if (this.isTokenExpired() && this.auth.credentials?.refresh_token) {
                try {
                    await this.ensureValidToken();
                    return true;
                } catch {
                    // Fall through to interactive
                }
            } else {
                return true;
            }
        }

        if (await this.tryLoadToken()) {
            return true;
        }

        return this.interactiveLogin(callback);
    }

    private async interactiveLogin(
        callback?: EmailDeviceCodeCallback,
    ): Promise<boolean> {
        const { authCode, redirectUri } =
            await this.startRedirectListenerAndAuthorize(callback);

        if (!authCode) {
            debugError("Did not receive authorization code");
            return false;
        }

        return this.completeAuth(authCode, redirectUri);
    }

    private startRedirectListenerAndAuthorize(
        callback?: EmailDeviceCodeCallback,
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

            server.listen(0, "127.0.0.1", async () => {
                const addr = server.address();
                const port = typeof addr === "object" && addr ? addr.port : 0;
                actualRedirectUri = `http://127.0.0.1:${port}/oauth2callback`;

                debug(
                    `OAuth redirect listener started on ${actualRedirectUri}`,
                );

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

    async completeAuth(
        authorizationCode: string,
        redirectUri?: string,
    ): Promise<boolean> {
        if (!this.auth) {
            debugError("Auth not initialized");
            return false;
        }

        try {
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

            this.gmail = this.google.gmail({
                version: "v1",
                auth: this.auth,
            });
            this._isAuthenticated = true;
            this.emit("connected", this.gmail);

            debug("Google Gmail authentication successful");
            return true;
        } catch (error) {
            debugError(`Failed to complete auth: ${error}`);
            console.error(`[Gmail] Auth failed: ${error}`);
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
        this.gmail = undefined;
        this.tokenExpiryTime = 0;
        this.emit("disconnected");
        debug("Logged out of Gmail");
        return true;
    }

    isAuthenticated(): boolean {
        return this._isAuthenticated;
    }

    async getUser(): Promise<EmailUser> {
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
    // Email Operations
    // =========================================================================

    // RFC 2047 encode a header value if it contains non-ASCII characters
    private mimeEncodeHeader(value: string): string {
        if (/[^\x00-\x7F]/.test(value)) {
            return `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
        }
        return value;
    }

    async sendEmail(
        subject: string,
        body: string,
        toAddresses?: string[],
        ccAddresses?: string[],
        bccAddresses?: string[],
    ): Promise<boolean> {
        if (!this.gmail) {
            console.error(
                "[Gmail] Not initialized - please run '@email login' first",
            );
            return false;
        }

        await this.ensureValidToken();

        try {
            const messageParts: string[] = [];
            if (toAddresses?.length) {
                messageParts.push(`To: ${toAddresses.join(", ")}`);
            }
            if (ccAddresses?.length) {
                messageParts.push(`Cc: ${ccAddresses.join(", ")}`);
            }
            if (bccAddresses?.length) {
                messageParts.push(`Bcc: ${bccAddresses.join(", ")}`);
            }
            messageParts.push(`Subject: ${this.mimeEncodeHeader(subject)}`);
            messageParts.push("Content-Type: text/html; charset=utf-8");
            messageParts.push("");
            messageParts.push(body);

            const raw = Buffer.from(messageParts.join("\r\n")).toString(
                "base64url",
            );

            const response = await this.gmail.users.messages.send({
                userId: "me",
                requestBody: { raw },
            });

            debug(`Email sent: ${response.data.id}`);
            return !!response.data.id;
        } catch (error: any) {
            debugError(`Failed to send email: ${error}`);
            console.error(`[Gmail] Failed to send: ${error?.message || error}`);
            return false;
        }
    }

    async replyToEmail(
        messageId: string,
        body: string,
        ccAddresses?: string[],
        bccAddresses?: string[],
    ): Promise<boolean> {
        if (!this.gmail) return false;
        await this.ensureValidToken();

        try {
            const original = await this.gmail.users.messages.get({
                userId: "me",
                id: messageId,
                format: "metadata",
                metadataHeaders: ["Subject", "From", "To", "Message-ID"],
            });

            const headers = original.data.payload?.headers || [];
            const getHeader = (name: string) =>
                headers.find(
                    (h: any) => h.name.toLowerCase() === name.toLowerCase(),
                )?.value;

            const subject = getHeader("Subject") || "";
            const replyTo = getHeader("From") || "";
            const messageIdHeader = getHeader("Message-ID") || "";
            const threadId = original.data.threadId;

            const messageParts = [
                `To: ${replyTo}`,
                `Subject: ${this.mimeEncodeHeader(subject.startsWith("Re:") ? subject : `Re: ${subject}`)}`,
                `In-Reply-To: ${messageIdHeader}`,
                `References: ${messageIdHeader}`,
                "Content-Type: text/html; charset=utf-8",
            ];
            if (ccAddresses?.length) {
                messageParts.push(`Cc: ${ccAddresses.join(", ")}`);
            }
            if (bccAddresses?.length) {
                messageParts.push(`Bcc: ${bccAddresses.join(", ")}`);
            }
            messageParts.push("");
            messageParts.push(body);

            const raw = Buffer.from(messageParts.join("\r\n")).toString(
                "base64url",
            );

            const response = await this.gmail.users.messages.send({
                userId: "me",
                requestBody: { raw, threadId },
            });

            debug(`Reply sent: ${response.data.id}`);
            return !!response.data.id;
        } catch (error: any) {
            debugError(`Failed to reply: ${error}`);
            console.error(
                `[Gmail] Failed to reply: ${error?.message || error}`,
            );
            return false;
        }
    }

    async forwardEmail(
        messageId: string,
        body: string,
        toAddresses?: string[],
        ccAddresses?: string[],
        bccAddresses?: string[],
    ): Promise<boolean> {
        if (!this.gmail) return false;
        await this.ensureValidToken();

        try {
            const original = await this.gmail.users.messages.get({
                userId: "me",
                id: messageId,
                format: "full",
            });

            const headers = original.data.payload?.headers || [];
            const getHeader = (name: string) =>
                headers.find(
                    (h: any) => h.name.toLowerCase() === name.toLowerCase(),
                )?.value;

            const subject = getHeader("Subject") || "";
            const originalBody = this.extractBody(original.data.payload);
            const fullBody = `${body}<br/><br/>---------- Forwarded message ----------<br/>${originalBody}`;

            const messageParts = [
                `Subject: ${this.mimeEncodeHeader(subject.startsWith("Fwd:") ? subject : `Fwd: ${subject}`)}`,
                "Content-Type: text/html; charset=utf-8",
            ];
            if (toAddresses?.length) {
                messageParts.push(`To: ${toAddresses.join(", ")}`);
            }
            if (ccAddresses?.length) {
                messageParts.push(`Cc: ${ccAddresses.join(", ")}`);
            }
            if (bccAddresses?.length) {
                messageParts.push(`Bcc: ${bccAddresses.join(", ")}`);
            }
            messageParts.push("");
            messageParts.push(fullBody);

            const raw = Buffer.from(messageParts.join("\r\n")).toString(
                "base64url",
            );

            const response = await this.gmail.users.messages.send({
                userId: "me",
                requestBody: { raw },
            });

            debug(`Forward sent: ${response.data.id}`);
            return !!response.data.id;
        } catch (error: any) {
            debugError(`Failed to forward: ${error}`);
            console.error(
                `[Gmail] Failed to forward: ${error?.message || error}`,
            );
            return false;
        }
    }

    async findEmail(query: EmailSearchQuery): Promise<string | undefined> {
        if (!this.gmail) return undefined;
        await this.ensureValidToken();

        try {
            // Build Gmail search query string
            const queryParts: string[] = [];
            if (query.sender) queryParts.push(`from:${query.sender}`);
            if (query.subject) queryParts.push(`subject:${query.subject}`);
            if (query.content) queryParts.push(query.content);
            if (query.startDateTime) {
                queryParts.push(
                    `after:${this.toGmailDate(query.startDateTime)}`,
                );
            }
            if (query.endDateTime) {
                queryParts.push(
                    `before:${this.toGmailDate(query.endDateTime)}`,
                );
            }
            if (query.folder) queryParts.push(`in:${query.folder}`);

            const response = await this.gmail.users.messages.list({
                userId: "me",
                q: queryParts.join(" "),
                maxResults: query.maxResults || 5,
            });

            const messages = response.data.messages;
            if (messages && messages.length > 0) {
                return messages[0].id;
            }
            return undefined;
        } catch (error) {
            debugError(`Failed to find email: ${error}`);
            return undefined;
        }
    }

    async searchEmails(query: EmailSearchQuery): Promise<EmailMessage[]> {
        if (!this.gmail) return [];
        await this.ensureValidToken();

        try {
            // Build Gmail search query string
            const queryParts: string[] = [];
            if (query.sender) queryParts.push(`from:${query.sender}`);
            if (query.subject) queryParts.push(`subject:${query.subject}`);
            if (query.content) queryParts.push(query.content);
            if (query.startDateTime) {
                queryParts.push(
                    `after:${this.toGmailDate(query.startDateTime)}`,
                );
            }
            if (query.endDateTime) {
                queryParts.push(
                    `before:${this.toGmailDate(query.endDateTime)}`,
                );
            }
            if (query.folder) queryParts.push(`in:${query.folder}`);

            const response = await this.gmail.users.messages.list({
                userId: "me",
                q: queryParts.join(" "),
                maxResults: query.maxResults || 10,
            });

            const messageIds = response.data.messages || [];
            const messages: EmailMessage[] = [];

            for (const msg of messageIds) {
                try {
                    const full = await this.gmail.users.messages.get({
                        userId: "me",
                        id: msg.id,
                        format: "metadata",
                        metadataHeaders: [
                            "Subject",
                            "From",
                            "To",
                            "Date",
                            "Cc",
                        ],
                    });
                    messages.push(this.convertGmailMessage(full.data));
                } catch (err) {
                    debugError(`Failed to fetch message ${msg.id}: ${err}`);
                }
            }

            return messages;
        } catch (error) {
            debugError(`Failed to search emails: ${error}`);
            return [];
        }
    }

    async getInbox(
        maxResults?: number,
        since?: string,
        before?: string,
    ): Promise<EmailMessage[]> {
        if (!this.gmail) return [];
        await this.ensureValidToken();

        try {
            // Build optional date filters using Gmail query syntax
            const queryParts: string[] = [];
            if (since) {
                queryParts.push(`after:${this.toGmailDate(since)}`);
            }
            if (before) {
                queryParts.push(`before:${this.toGmailDate(before)}`);
            }

            const listParams: any = {
                userId: "me",
                labelIds: ["INBOX"],
                maxResults: maxResults || 25,
            };
            if (queryParts.length > 0) {
                listParams.q = queryParts.join(" ");
            }

            const response = await this.gmail.users.messages.list(listParams);

            const messageIds = response.data.messages || [];
            const messages: EmailMessage[] = [];

            for (const msg of messageIds) {
                try {
                    const full = await this.gmail.users.messages.get({
                        userId: "me",
                        id: msg.id,
                        format: "metadata",
                        metadataHeaders: [
                            "Subject",
                            "From",
                            "To",
                            "Date",
                            "Cc",
                        ],
                    });
                    messages.push(this.convertGmailMessage(full.data));
                } catch (err) {
                    debugError(`Failed to fetch message ${msg.id}: ${err}`);
                }
            }

            return messages;
        } catch (error) {
            debugError(`Failed to get inbox: ${error}`);
            return [];
        }
    }

    async resolveUserEmails(usernames: string[]): Promise<string[]> {
        debug("Google: resolveUserEmails returns usernames as-is");
        return usernames;
    }

    // =========================================================================
    // Helper Methods
    // =========================================================================

    private convertGmailMessage(gmailMsg: any): EmailMessage {
        const headers = gmailMsg.payload?.headers || [];
        const getHeader = (name: string) =>
            headers.find(
                (h: any) => h.name.toLowerCase() === name.toLowerCase(),
            )?.value;

        const fromStr = getHeader("From") || "";
        const fromMatch = fromStr.match(/(?:(.+?)\s*)?<?([^\s<>]+@[^\s<>]+)>?/);

        return {
            id: gmailMsg.id,
            subject: getHeader("Subject") || "(No subject)",
            bodyPreview: gmailMsg.snippet,
            from: fromMatch
                ? {
                      address: fromMatch[2],
                      name: fromMatch[1]?.replace(/"/g, "").trim(),
                  }
                : { address: fromStr },
            receivedDateTime: getHeader("Date"),
            isRead: !gmailMsg.labelIds?.includes("UNREAD"),
            hasAttachments:
                gmailMsg.payload?.parts?.some(
                    (p: any) => p.filename && p.filename.length > 0,
                ) || false,
            webLink: `https://mail.google.com/mail/u/0/#inbox/${gmailMsg.id}`,
        };
    }

    private extractBody(payload: any): string {
        if (!payload) return "";

        // Check for direct body
        if (payload.body?.data) {
            return Buffer.from(payload.body.data, "base64").toString("utf-8");
        }

        // Check parts recursively
        if (payload.parts) {
            for (const part of payload.parts) {
                if (
                    part.mimeType === "text/html" ||
                    part.mimeType === "text/plain"
                ) {
                    if (part.body?.data) {
                        return Buffer.from(part.body.data, "base64").toString(
                            "utf-8",
                        );
                    }
                }
                // Recurse into nested parts
                const nested = this.extractBody(part);
                if (nested) return nested;
            }
        }

        return "";
    }

    private toGmailDate(isoDate: string): string {
        // Gmail accepts YYYY/MM/DD format for after:/before: operators
        try {
            const date = new Date(isoDate);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, "0");
            const day = String(date.getDate()).padStart(2, "0");
            return `${year}/${month}/${day}`;
        } catch {
            return isoDate;
        }
    }
}

// Singleton factory
let googleEmailInstance: GoogleEmailClient | undefined;

export function getGoogleEmailClient(): GoogleEmailClient {
    if (!googleEmailInstance) {
        googleEmailInstance = new GoogleEmailClient();
    }
    return googleEmailInstance;
}
