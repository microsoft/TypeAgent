// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Email Provider Interface
 *
 * Abstracts email operations to support multiple providers
 * (Microsoft Graph, Google Gmail, etc.)
 */

import { EventEmitter } from "events";

/**
 * Represents an email message in a provider-agnostic format
 */
export interface EmailMessage {
    id: string;
    subject: string;
    body?: string;
    bodyPreview?: string;
    from?: EmailAddress;
    toRecipients?: EmailAddress[];
    ccRecipients?: EmailAddress[];
    bccRecipients?: EmailAddress[];
    receivedDateTime?: string;
    isRead?: boolean;
    hasAttachments?: boolean;
}

/**
 * Represents an email address with optional display name
 */
export interface EmailAddress {
    address: string;
    name?: string;
}

/**
 * Query parameters for finding emails
 */
export interface EmailSearchQuery {
    sender?: string;
    subject?: string;
    content?: string;
    startDateTime?: string;
    endDateTime?: string;
    maxResults?: number;
    folder?: string;
}

/**
 * User information from the email provider
 */
export interface EmailUser {
    id: string | undefined;
    displayName: string | undefined;
    email: string | undefined;
}

/**
 * Callback for device code / browser authentication flow
 */
export type EmailDeviceCodeCallback = (
    userCode: string,
    verificationUri: string,
    message: string,
) => void;

/**
 * Email provider interface - implement this for each email service
 */
export interface IEmailProvider extends EventEmitter {
    /**
     * Provider name (e.g., "microsoft", "google")
     */
    readonly providerName: string;

    // =========================================================================
    // Authentication
    // =========================================================================

    login(callback?: EmailDeviceCodeCallback): Promise<boolean>;
    logout(): boolean;
    isAuthenticated(): boolean;
    getUser(): Promise<EmailUser>;

    // =========================================================================
    // Email Operations
    // =========================================================================

    /**
     * Send a new email
     */
    sendEmail(
        subject: string,
        body: string,
        toAddresses?: string[],
        ccAddresses?: string[],
        bccAddresses?: string[],
    ): Promise<boolean>;

    /**
     * Reply to an existing email by message ID
     */
    replyToEmail(
        messageId: string,
        body: string,
        ccAddresses?: string[],
        bccAddresses?: string[],
    ): Promise<boolean>;

    /**
     * Forward an existing email by message ID
     */
    forwardEmail(
        messageId: string,
        body: string,
        toAddresses?: string[],
        ccAddresses?: string[],
        bccAddresses?: string[],
    ): Promise<boolean>;

    /**
     * Find an email matching search criteria
     * @returns message ID of the best match, or undefined
     */
    findEmail(query: EmailSearchQuery): Promise<string | undefined>;

    /**
     * Search for emails matching criteria, returning full message details
     */
    searchEmails(query: EmailSearchQuery): Promise<EmailMessage[]>;

    /**
     * Get inbox messages, optionally filtered by date range.
     * @param since - ISO date string; only return emails after this date
     * @param before - ISO date string; only return emails before this date
     */
    getInbox(
        maxResults?: number,
        since?: string,
        before?: string,
    ): Promise<EmailMessage[]>;

    // =========================================================================
    // Contact Resolution
    // =========================================================================

    /**
     * Resolve display names to email addresses (provider-specific)
     */
    resolveUserEmails(usernames: string[]): Promise<string[]>;
}

/**
 * Email provider type for configuration
 */
export type EmailProviderType = "microsoft" | "google";

/**
 * Configuration for email providers
 */
export interface EmailProviderConfig {
    provider: EmailProviderType;
    msGraphClientId?: string;
    msGraphTenantId?: string;
    googleClientId?: string;
    googleClientSecret?: string;
}
