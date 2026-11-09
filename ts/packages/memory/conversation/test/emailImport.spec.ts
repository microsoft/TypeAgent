// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { importEmailFromMimeText } from "../src/emailImport.js";
import {
    importEmailMessage,
    EmailMessageSerializer,
} from "../src/emailMessage.js";

describe("email import", () => {
    test("preserves encoded headers, folded recipients, and plain text", async () => {
        const mime = [
            "From: =?UTF-8?Q?Ada_Lovelace?= <ada@example.test>",
            "To: Grace Hopper <grace@example.test>,",
            " Alan Turing <alan@example.test>",
            "Cc: Katherine Johnson <katherine@example.test>",
            "Subject: =?UTF-8?Q?Project_update?=",
            "Date: Tue, 13 Oct 2026 18:00:00 -0700",
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: quoted-printable",
            "",
            "Hello team,",
            "The report is ready.",
        ].join("\r\n");

        const email = await importEmailFromMimeText(mime);

        expect(email).toMatchObject({
            from: {
                displayName: "Ada Lovelace",
                address: "ada@example.test",
            },
            to: [
                {
                    displayName: "Grace Hopper",
                    address: "grace@example.test",
                },
                {
                    displayName: "Alan Turing",
                    address: "alan@example.test",
                },
            ],
            cc: [
                {
                    displayName: "Katherine Johnson",
                    address: "katherine@example.test",
                },
            ],
            subject: "Project update",
            sentOn: "2026-10-14T01:00:00.000Z",
        });
        expect(email?.body.trim()).toBe("Hello team,\nThe report is ready.");
        expect(email?.bcc).toBeUndefined();
        const message = importEmailMessage(email!);
        expect(message.metadata.temporalContext?.messageTime).toMatchObject({
            raw: "Tue, 13 Oct 2026 18:00:00 -0700",
            localDateTime: "2026-10-13T18:00:00",
            instantUtc: "2026-10-14T01:00:00.000Z",
            offsetMinutes: -420,
        });
        const serializer = new EmailMessageSerializer();
        expect(
            serializer.deserialize(serializer.serialize(message)).metadata
                .temporalContext,
        ).toEqual(message.metadata.temporalContext);
    });

    test("uses the plain text alternative from multipart mail", async () => {
        const mime = [
            "From: ada@example.test",
            "MIME-Version: 1.0",
            'Content-Type: multipart/alternative; boundary="message-parts"',
            "",
            "--message-parts",
            "Content-Type: text/plain; charset=utf-8",
            "",
            "Plain text report.",
            "--message-parts",
            "Content-Type: text/html; charset=utf-8",
            "",
            "<p>HTML report.</p>",
            "--message-parts--",
        ].join("\r\n");

        const email = await importEmailFromMimeText(mime);

        expect(email?.body.trim()).toBe("Plain text report.");
        expect(email?.from.address).toBe("ada@example.test");
    });

    test("converts HTML-only mail to text while preserving links", async () => {
        const mime = [
            "From: ada@example.test",
            "MIME-Version: 1.0",
            "Content-Type: text/html; charset=utf-8",
            "",
            '<p>Review the report.</p><p><a href="https://example.test/report">Open report</a></p>',
        ].join("\r\n");

        const email = await importEmailFromMimeText(mime);

        expect(email?.body).toContain("Review the report.");
        expect(email?.body).toContain("https://example.test/report");
    });

    test.each([
        {
            name: "mail without a sender",
            mime: "Content-Type: text/plain\r\n\r\nReport text.",
        },
        {
            name: "mail without a body",
            mime: "From: ada@example.test\r\n\r\n",
        },
    ])("does not import $name", async ({ mime }) => {
        expect(await importEmailFromMimeText(mime)).toBeUndefined();
    });
});
