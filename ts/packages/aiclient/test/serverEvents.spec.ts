// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readMessages } from "../src/serverEvents.js";

const messages = ["data: hello", "data: world", "data: foo", "data: bar"];

function getTextStream(text: string, breakAt: number) {
    return (async function* () {
        yield text.slice(0, breakAt);
        yield text.slice(breakAt);
    })();
}
describe("serverEvents", () => {
    describe("readMessage", () => {
        const fullMessage = messages.join("\n\n");
        for (let i = 0; i < fullMessage.length; i++) {
            it(`should read messages break at ${i}`, async () => {
                const textStream = getTextStream(fullMessage, i);
                let index = 0;
                for await (const message of readMessages(textStream)) {
                    expect(message).toEqual(messages[index++]);
                }
            });
        }
    });
});
