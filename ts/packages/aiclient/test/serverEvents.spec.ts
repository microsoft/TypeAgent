// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readMessages, readServerEventStream } from "../src/serverEvents.js";

const messages = ["data: hello", "data: world", "data: foo", "data: bar"];

function getTextStream(text: string, breakAt: number) {
    return (async function* () {
        yield text.slice(0, breakAt);
        yield text.slice(breakAt);
    })();
}
describe("serverEvents", () => {
    describe.each([
        { format: "LF", lineEnding: "\n" },
        { format: "CRLF", lineEnding: "\r\n" },
        { format: "CR", lineEnding: "\r" },
    ])("readMessages ($format)", ({ lineEnding }) => {
        const fullMessage = messages.join(lineEnding.repeat(2));
        for (let i = 0; i <= fullMessage.length; i++) {
            it(`should read messages break at ${i}`, async () => {
                const textStream = getTextStream(fullMessage, i);
                const actual: string[] = [];
                for await (const message of readMessages(textStream)) {
                    actual.push(message);
                }
                // The final message has no terminating blank line.
                expect(actual).toEqual(messages.slice(0, -1));
            });
        }

        it("yields complete messages before reading the next chunk", async () => {
            let pulls = 0;
            const textStream = (async function* () {
                for (const message of messages) {
                    pulls++;
                    yield message + lineEnding.repeat(2);
                }
            })();
            const iterator = readMessages(textStream);
            for (let i = 0; i < messages.length; i++) {
                expect(await iterator.next()).toEqual({
                    done: false,
                    value: messages[i],
                });
                expect(pulls).toBe(i + 1);
            }
            expect(await iterator.next()).toEqual({ done: true });
        });

        it("parses fields using the same line ending", async () => {
            const response = new Response(
                ["id: 1", "event: reply", "data: hello", "", ""].join(
                    lineEnding,
                ),
            );
            const actual = [];
            for await (const event of readServerEventStream(response)) {
                actual.push(event);
            }
            expect(actual).toEqual([
                { id: "1", event: "reply", data: "hello" },
            ]);
        });
    });

    it("keeps split CRLF pairs together across empty chunks", async () => {
        const textStream = (async function* () {
            yield "id: 1\r";
            yield "";
            yield "\ndata: hello\r";
            yield "";
            yield "\n\r";
            yield "";
            yield "\n";
        })();
        const actual: string[] = [];
        for await (const message of readMessages(textStream)) {
            actual.push(message);
        }
        expect(actual).toEqual(["id: 1\ndata: hello"]);
    });
});
