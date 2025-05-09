// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AddressObject, simpleParser } from "mailparser";
import { email } from "knowledge-processor";
import { readAllText } from "typeagent";

export async function importEmlFile(
    filePath: string,
): Promise<email.Email | undefined> {
    const text = await readAllText(filePath);
    if (!text) {
        return undefined;
    }
    return importEmailFromMimeText(text);
}

export async function importEmailFromMimeText(
    emailText: string,
): Promise<email.Email | undefined> {
    const mimeMail = await simpleParser(emailText);
    if (!mimeMail.text || !mimeMail.from) {
        return undefined;
    }

    const email: email.Email = {
        body: mimeMail.text,
        from: importAddress(mimeMail.from)[0],
        to: importAddresses(mimeMail.to),
        cc: importAddresses(mimeMail.cc),
        bcc: importAddresses(mimeMail.bcc),
        subject: mimeMail.subject,
        sentOn: mimeMail.date?.toISOString(),
    };
    return email;
}

function importAddresses(
    addresses: AddressObject | AddressObject[] | undefined,
): email.EmailAddress[] | undefined {
    if (addresses) {
        if (Array.isArray(addresses)) {
            const emailAddresses: email.EmailAddress[] = [];
            for (const addr of addresses) {
                emailAddresses.push(...importAddress(addr));
            }
            return emailAddresses;
        } else {
            return importAddress(addresses);
        }
    }
    return undefined;
}

function importAddress(address: AddressObject): email.EmailAddress[] {
    return address.value.map((a) => {
        return {
            displayName: a.name,
            address: a.address,
        };
    });
}
