// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createEmailMemoryOnDb } from "../src/emailMemory.js";
import { EmailHeader, EmailMessage } from "../src/emailMessage.js";
import { verifyEmailHeadersEqual } from "./verify.js";
import { describeIf, getDbPath, hasTestKeys } from "test-lib";

describeIf(
    "email.online",
    () => hasTestKeys(),
    () => {
        test("create", async () => {
            const name = "createTest.db";
            const dbPath = await getDbPath(name);
            const emailMemory = createEmailMemoryOnDb(name, dbPath, true);
            const messageCount = 4;
            const messages = createEmails(messageCount);
            for (const msg of messages) {
                emailMemory.messages.append(msg);
            }
            expect(emailMemory.messages.length).toEqual(messageCount);

            const messages2 = [...emailMemory.messages];
            expect(messages).toHaveLength(messages2.length);
            for (let i = 0; i < messageCount; ++i) {
                verifyEmailHeadersEqual(
                    messages[i].metadata,
                    messages2[i].metadata,
                );
            }
        });
    },
);

function createEmails(count: number): EmailMessage[] {
    const messages: EmailMessage[] = [];
    for (let i = 0; i < count; ++i) {
        messages.push(createEmail(`alias${i}@xyz`, `Body\nMessage_${i}`));
    }
    return messages;
}

function createEmail(from: string, body: string): EmailMessage {
    return new EmailMessage(new EmailHeader({ address: from }), body);
}
