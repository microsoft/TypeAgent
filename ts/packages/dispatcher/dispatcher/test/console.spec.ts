// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs";
import { PassThrough } from "node:stream";
import { processCommands } from "../src/helpers/console.js";

describe("processCommands", () => {
    it("processes batch inputs without initializing an interactive console", async () => {
        const realStdin = process.stdin;
        const fakeStdin = new PassThrough();
        Object.defineProperty(fakeStdin, "isTTY", { value: false });
        const resumeSpy = jest.spyOn(fakeStdin, "resume");
        const historyExistsSpy = jest.spyOn(fs, "existsSync");
        const historyReadSpy = jest.spyOn(fs, "readFileSync");
        const historyWriteSpy = jest.spyOn(fs, "writeFileSync");
        jest.spyOn(console, "log").mockImplementation(() => {});
        Object.defineProperty(process, "stdin", {
            value: fakeStdin,
            writable: true,
            configurable: true,
        });

        try {
            const processed: string[] = [];
            await processCommands(
                "test> ",
                async (request) => {
                    processed.push(request);
                },
                {},
                ["# comment", "", "@display first", "@display second"],
            );

            expect(processed).toEqual(["@display first", "@display second"]);
            expect(resumeSpy).not.toHaveBeenCalled();
            expect(fakeStdin.listenerCount("data")).toBe(0);
            expect(historyExistsSpy).not.toHaveBeenCalled();
            expect(historyReadSpy).not.toHaveBeenCalled();
            expect(historyWriteSpy).not.toHaveBeenCalled();
        } finally {
            Object.defineProperty(process, "stdin", {
                value: realStdin,
                writable: true,
                configurable: true,
            });
            fakeStdin.destroy();
            jest.restoreAllMocks();
        }
    });
});
