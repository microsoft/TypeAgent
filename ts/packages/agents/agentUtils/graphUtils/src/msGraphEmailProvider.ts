// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Microsoft Graph Email Provider
 *
 * Wraps the existing MailClient to implement IEmailProvider interface
 */

import { EventEmitter } from "events";
import {
    IEmailProvider,
    EmailMessage,
    EmailUser,
    EmailSearchQuery,
    EmailDeviceCodeCallback,
} from "./emailProvider.js";
import { MailClient } from "./mailClient.js";
import { DevicePromptCallback } from "./graphClient.js";

export class MSGraphEmailProvider
    extends EventEmitter
    implements IEmailProvider
{
    public readonly providerName = "microsoft";
    private client: MailClient;

    constructor(client?: MailClient) {
        super();
        this.client = client || new MailClient();

        // Forward events from underlying client
        this.client.on("connected", (graphClient) => {
            this.emit("connected", graphClient);
        });
        this.client.on("disconnected", () => {
            this.emit("disconnected");
        });
    }

    /**
     * Get the underlying MailClient for backward compat / advanced operations
     */
    getUnderlyingClient(): MailClient {
        return this.client;
    }

    // =========================================================================
    // Authentication
    // =========================================================================

    async login(callback?: EmailDeviceCodeCallback): Promise<boolean> {
        const graphCallback: DevicePromptCallback | undefined = callback
            ? (prompt: string) => {
                  const codeMatch = prompt.match(/enter the code (\S+)/);
                  const urlMatch = prompt.match(/open the page (\S+)/);
                  callback(
                      codeMatch?.[1] || "",
                      urlMatch?.[1] || "https://microsoft.com/devicelogin",
                      prompt,
                  );
              }
            : undefined;

        return this.client.login(graphCallback);
    }

    logout(): boolean {
        return this.client.logout();
    }

    isAuthenticated(): boolean {
        return this.client.isAuthenticated();
    }

    async getUser(): Promise<EmailUser> {
        const user = await this.client.getUserAsync();
        return {
            id: user.id,
            displayName: user.displayName || undefined,
            email: user.mail || user.userPrincipalName || undefined,
        };
    }

    // =========================================================================
    // Email Operations
    // =========================================================================

    async sendEmail(
        subject: string,
        body: string,
        toAddresses?: string[],
        ccAddresses?: string[],
        bccAddresses?: string[],
    ): Promise<boolean> {
        const result = await this.client.sendMailAsync(
            subject,
            body,
            toAddresses,
            ccAddresses,
            bccAddresses,
        );
        return !!result;
    }

    async replyToEmail(
        messageId: string,
        body: string,
        ccAddresses?: string[],
        bccAddresses?: string[],
    ): Promise<boolean> {
        const result = await this.client.replyMailAsync(
            messageId,
            body,
            ccAddresses,
            bccAddresses,
        );
        return !!result;
    }

    async forwardEmail(
        messageId: string,
        body: string,
        toAddresses?: string[],
        ccAddresses?: string[],
        bccAddresses?: string[],
    ): Promise<boolean> {
        const result = await this.client.forwardMailAsync(
            messageId,
            body,
            toAddresses,
            ccAddresses,
            bccAddresses,
        );
        return !!result;
    }

    async findEmail(query: EmailSearchQuery): Promise<string | undefined> {
        return this.client.findEmailAsync(
            query.sender || "",
            query.subject,
            query.content,
            query.startDateTime,
            query.endDateTime,
        );
    }

    async searchEmails(query: EmailSearchQuery): Promise<EmailMessage[]> {
        // MS Graph: use getInbox and filter client-side for now
        const pageCollection = await this.client.getInboxAsync();
        if (!pageCollection?.value) return [];
        let messages = this.convertMSGraphMessages(pageCollection.value);

        // Apply client-side filters
        if (query.sender) {
            const senderLower = query.sender.toLowerCase();
            messages = messages.filter(
                (m) =>
                    m.from?.address?.toLowerCase().includes(senderLower) ||
                    m.from?.name?.toLowerCase().includes(senderLower),
            );
        }
        if (query.subject) {
            const subjectLower = query.subject.toLowerCase();
            messages = messages.filter((m) =>
                m.subject.toLowerCase().includes(subjectLower),
            );
        }
        if (query.maxResults) {
            messages = messages.slice(0, query.maxResults);
        }
        return messages;
    }

    async getInbox(
        maxResults?: number,
        since?: string,
        before?: string,
    ): Promise<EmailMessage[]> {
        const pageCollection = await this.client.getInboxAsync();
        if (!pageCollection?.value) return [];
        return this.convertMSGraphMessages(pageCollection.value);
    }

    async resolveUserEmails(usernames: string[]): Promise<string[]> {
        return this.client.getEmailAddressesOfUsernamesLocal(usernames);
    }

    // =========================================================================
    // Helper Methods
    // =========================================================================

    private convertMSGraphMessages(msMessages: any[]): EmailMessage[] {
        if (!msMessages) return [];
        return msMessages.map((m) => {
            const msg: EmailMessage = {
                id: m.id,
                subject: m.subject || "(No subject)",
            };
            if (m.body?.content) msg.body = m.body.content;
            if (m.bodyPreview) msg.bodyPreview = m.bodyPreview;
            if (m.from?.emailAddress) {
                msg.from = {
                    address: m.from.emailAddress.address,
                    name: m.from.emailAddress.name,
                };
            }
            if (m.toRecipients) {
                msg.toRecipients = m.toRecipients.map((r: any) => ({
                    address: r.emailAddress?.address,
                    name: r.emailAddress?.name,
                }));
            }
            if (m.ccRecipients) {
                msg.ccRecipients = m.ccRecipients.map((r: any) => ({
                    address: r.emailAddress?.address,
                    name: r.emailAddress?.name,
                }));
            }
            if (m.receivedDateTime) msg.receivedDateTime = m.receivedDateTime;
            if (m.isRead !== undefined) msg.isRead = m.isRead;
            if (m.hasAttachments !== undefined) msg.hasAttachments = m.hasAttachments;
            return msg;
        });
    }
}

// Singleton factory
let msGraphEmailProviderInstance: MSGraphEmailProvider | undefined;

export function getMSGraphEmailProvider(
    existingClient?: MailClient,
): MSGraphEmailProvider {
    if (!msGraphEmailProviderInstance) {
        msGraphEmailProviderInstance = new MSGraphEmailProvider(existingClient);
    }
    return msGraphEmailProviderInstance;
}
