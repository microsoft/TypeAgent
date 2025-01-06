// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Message } from "@microsoft/microsoft-graph-types";
import { PageCollection } from "@microsoft/microsoft-graph-client";
import registerDebug from "debug";
import chalk from "chalk";
import { GraphClient, DynamicObject } from "./graphClient.js";

enum AddressToType {
    "to",
    "cc",
    "bcc",
}

export class MailClient extends GraphClient {
    private readonly logger = registerDebug("typeagent:graphUtils:mailClient");
    public constructor() {
        super("@email login");
    }

    public async getInboxAsync(): Promise<PageCollection | undefined> {
        const client = await this.ensureClient();
        return client
            .api("/me/mailFolders/inbox/messages")
            .select(["from", "isRead", "receivedDateTime", "subject"])
            .top(25)
            .orderby("receivedDateTime DESC")
            .get();
    }

    public addEmailsToMessage(
        addrs: string[],
        message: Message | DynamicObject,
        addrTo: AddressToType,
    ) {
        if (addrs && addrs.length > 0) {
            switch (addrTo) {
                case AddressToType.to:
                    addrs.forEach((addr) => {
                        if (addr) {
                            message.toRecipients = [];
                            const recipient = {
                                emailAddress: {
                                    address: addr,
                                },
                            };
                            message.toRecipients?.push(recipient);
                        }
                    });
                    break;
                case AddressToType.cc:
                    addrs.forEach((addr) => {
                        if (addr) {
                            message.ccRecipients = [];
                            const recipient = {
                                emailAddress: {
                                    address: addr,
                                },
                            };
                            message.ccRecipients?.push(recipient);
                        }
                    });
                    break;
                case AddressToType.bcc:
                    addrs.forEach((addr) => {
                        if (addr) {
                            message.bccRecipients = [];
                            const recipient = {
                                emailAddress: {
                                    address: addr,
                                },
                            };
                            message.bccRecipients?.push(recipient);
                        }
                    });
                    break;
            }
        }
    }

    public async sendMailAsync(
        subject: string,
        body: string,
        to_addrs: string[] | undefined,
        cc_addrs: string[] | undefined,
        bcc_addrs: string[] | undefined,
    ): Promise<Boolean> {
        const client = await this.ensureClient();
        let fSent = false;
        try {
            const message: Message = {
                subject: subject,
                body: {
                    content: body,
                    contentType: "text",
                },
            };

            if (to_addrs && to_addrs.length > 0) {
                this.addEmailsToMessage(to_addrs, message, AddressToType.to);
            }

            if (cc_addrs && cc_addrs.length > 0) {
                this.addEmailsToMessage(cc_addrs, message, AddressToType.cc);
            }

            if (bcc_addrs && bcc_addrs.length > 0) {
                this.addEmailsToMessage(bcc_addrs, message, AddressToType.bcc);
            }

            await client
                .api("me/sendMail")
                .post({
                    message: message,
                })
                .then(async (response) => {
                    this.logger(chalk.green(`Mail sent successfully`));
                    fSent = true;
                })
                .catch((error) => {
                    this.logger(chalk.red(`Error sending mail: ${error}`));
                });
        } catch (error) {
            this.logger(chalk.red(`Error sending mail: ${error}`));
        }
        return fSent;
    }

    public async replyMailAsync(
        msg_id: string,
        content: string,
        cc_addrs: string[] | undefined,
        bcc_addrs: string[] | undefined,
    ): Promise<Boolean> {
        const client = await this.ensureClient();
        try {
            const reply = {
                message: {},
                comment: `${content}`,
            };

            if (cc_addrs && cc_addrs.length > 0) {
                this.addEmailsToMessage(
                    cc_addrs,
                    reply.message,
                    AddressToType.cc,
                );
            }

            if (bcc_addrs && bcc_addrs.length > 0) {
                this.addEmailsToMessage(
                    bcc_addrs,
                    reply.message,
                    AddressToType.bcc,
                );
            }

            let res = await client
                .api(`me/messages/${msg_id}/reply`)
                .post(reply);

            if (res) {
                this.logger(
                    chalk.green(
                        `Mail replied successfully to msg_id: ${msg_id}`,
                    ),
                );
                return true;
            }
        } catch (error) {
            this.logger(chalk.red(`Error replying to mail: ${error}`));
        }
        return false;
    }

    public async forwardMailAsync(
        msg_id: string,
        content: string,
        to_addrs: string[] | undefined,
        cc_addrs: string[] | undefined,
        bcc_addrs: string[] | undefined,
    ): Promise<Boolean> {
        const client = await this.ensureClient();
        try {
            const message: DynamicObject = {
                comment: `${content}`,
            };

            if (to_addrs && to_addrs.length > 0) {
                this.addEmailsToMessage(to_addrs, message, AddressToType.to);
            }

            if (cc_addrs && cc_addrs.length > 0) {
                this.addEmailsToMessage(cc_addrs, message, AddressToType.cc);
            }

            if (bcc_addrs && bcc_addrs.length > 0) {
                this.addEmailsToMessage(bcc_addrs, message, AddressToType.bcc);
            }

            let res = await client
                .api(`me/messages/${msg_id}/forward`)
                .post(message);

            if (res) {
                this.logger(
                    chalk.green(
                        `Mail replied successfully to msg_id: ${msg_id}`,
                    ),
                );
                return true;
            }
        } catch (error) {
            this.logger(chalk.red(`Error replying to mail: ${error}`));
        }
        return false;
    }

    public async findEmailAsync(
        sender: string,
        subject: string | undefined,
        content: string | undefined,
        startDateTime: string | undefined,
        endDateTime: string | undefined,
    ): Promise<string | undefined> {
        const client = await this.ensureClient();
        try {
            if (sender && sender.length > 0) {
                let msgs = await client
                    .api("/me/messages")
                    .filter(`from/emailAddress/address eq '${sender}'`)
                    .select(["from", "id", "receivedDateTime", "subject"])
                    .top(5)
                    .get();

                if (msgs && msgs.value && msgs.value.length > 0) {
                    // we take the latest message
                    let msg = msgs.value[msgs.value.length - 1];
                    return msg.id;
                }
            }
        } catch (error) {
            this.logger(chalk.red(`Error finding email: ${error}`));
        }
        return undefined;
    }
}

export async function createMailGraphClient(): Promise<MailClient> {
    return new MailClient();
}
