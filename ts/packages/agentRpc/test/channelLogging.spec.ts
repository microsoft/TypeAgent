// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import debug from "debug";
import { format } from "node:util";
import { createChannelProviderAdapter } from "../src/common.js";

describe("channel diagnostic privacy", () => {
    it("never logs payloads or untrusted routing fields, including malformed join envelopes", () => {
        const previousNamespaces = debug.disable();
        const previousLog = debug.log;
        const logs: string[] = [];
        const marker = "test-only-private-payload-marker";
        debug.log = (...args: unknown[]) => {
            logs.push(format(...args));
        };
        debug.enable("typeagent:channel-redaction:*");
        try {
            const sent: unknown[] = [];
            const received: unknown[] = [];
            const provider = createChannelProviderAdapter(
                "channel-redaction",
                (message) => {
                    sent.push(message);
                },
            );
            const channel = provider.createChannel("dispatcher");
            channel.on("message", (message) => {
                received.push(message);
            });
            const payload = { structuredActions: { resumeToken: marker } };
            const invoke = {
                type: "invoke",
                name: "joinConversation",
                callId: 1,
                args: [payload],
            };
            const result = { type: "invokeResult", callId: 1, result: payload };
            channel.send(invoke);
            provider.notifyMessage({ name: "dispatcher", message: invoke });
            provider.notifyMessage({ name: "dispatcher", message: result });
            provider.notifyMessage({ ...payload, message: invoke });
            provider.notifyMessage({ name: marker, message: invoke });
            provider.notifyMessage({
                name: "dispatcher",
                message: { type: marker, callId: marker, result: payload },
            });
            provider.notifyDisconnected();

            expect(sent).toEqual([{ name: "dispatcher", message: invoke }]);
            expect(received.slice(0, 2)).toEqual([invoke, result]);
            expect(logs.length).toBeGreaterThan(0);
            expect(logs.join("\n")).toContain("Missing channel name");
            expect(logs.join("\n")).toContain("type=invoke");
            expect(logs.join("\n")).not.toContain(marker);
            expect(logs.join("\n")).not.toContain("resumeToken");
        } finally {
            debug.log = previousLog;
            debug.enable(previousNamespaces);
        }
    });
});
