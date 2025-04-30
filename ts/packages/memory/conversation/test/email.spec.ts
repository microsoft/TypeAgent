// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createEmailMemory } from "../src/emailMemory.js";
import { EmailMeta, EmailMessage } from "../src/emailMessage.js";
import { verifyEmailHeadersEqual } from "./verify.js";
import { describeIf, ensureOutputDir, hasTestKeys } from "test-lib";

describeIf(
    "email.online",
    () => hasTestKeys(),
    () => {
        const testTimeout = 5 * 60 * 1000;
        let storeRoot;
        beforeAll(() => {
            storeRoot = ensureOutputDir("emailMemory");
        });
        test(
            "create",
            async () => {
                const emailMemory = createEmailMemory(
                    storeRoot!,
                    "createTest",
                    true,
                );
                try {
                    const messageCount = 4;
                    const messages = createEmails(messageCount);
                    // Test direct add to collection
                    emailMemory.messages.append(...messages);
                    expect(emailMemory.messages.length).toEqual(messageCount);
                    // Test enumeration
                    const messages2 = [...emailMemory.messages];
                    expect(messages).toHaveLength(messages2.length);
                    for (let i = 0; i < messageCount; ++i) {
                        verifyEmailHeadersEqual(
                            messages[i].metadata,
                            messages2[i].metadata,
                        );
                    }
                } finally {
                    emailMemory.close();
                }
            },
            testTimeout,
        );
        test(
            "indexing",
            async () => {
                const emailMemory = createEmailMemory(
                    storeRoot!,
                    "indexingTest",
                    true,
                );
                try {
                    const messageCount = 4;
                    const messages = createEmails(messageCount, "sender@abc");
                    for (const message of messages) {
                        const result = await emailMemory.addMessage(message);
                        expect(result.semanticRefs).toBeDefined();
                        expect(result.secondaryIndexResults).toBeDefined();
                    }
                } finally {
                    emailMemory.close();
                }
            },
            testTimeout,
        );
    },
);

function createEmails(count: number, from?: string): EmailMessage[] {
    const messages: EmailMessage[] = [];
    for (let i = 0; i < count; ++i) {
        let fromAlias = from ?? `alias${i}@xyz.pqr`;
        messages.push(createEmail(fromAlias, `Body\nMessage_${i}`));
    }
    return messages;
}

function createEmail(from: string, body: string): EmailMessage {
    return new EmailMessage(new EmailMeta({ address: from }), body);
}
