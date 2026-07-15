// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test, { expect, Page } from "@playwright/test";
import {
    clearMessages,
    getAllAgentMessages,
    runTestCallback,
    sendUserRequestAndWaitForCompletion,
    sendUserRequestAndWaitForResponse,
} from "./testHelper";

// Annotate entire file as serial.
test.describe.configure({ mode: "serial" });

test.describe("@session Commands", () => {
    test("@session new/list", async ({}, testInfo) => {
        console.log(`Running test '${testInfo.title}'`);

        // launch the app
        await runTestCallback(async (mainWindow: Page) => {
            // get the session count
            let msg = await sendUserRequestAndWaitForCompletion(
                `@session list`,
                mainWindow,
            );

            const sessions: string[] = msg.split("\n");

            msg = await sendUserRequestAndWaitForCompletion(
                `@session new`,
                mainWindow,
            );
            expect(msg.toLowerCase()).toContain("new session created: ");

            msg = await sendUserRequestAndWaitForCompletion(
                `@session list`,
                mainWindow,
            );
            const newSessions: string[] = msg.split("\n");

            expect(newSessions.length, "Session count mismatch!").toBe(
                sessions.length + 1,
            );

            msg = await sendUserRequestAndWaitForCompletion(
                `@history`,
                mainWindow,
            );
            expect(msg.length, "History NOT cleared!").toBe(0);
        });
    });

    test("@session new/delete/list/info", async ({}, testInfo) => {
        console.log(`Running test '${testInfo.title}'`);

        // launch the app
        await runTestCallback(async (mainWindow: Page) => {
            // create a new session so we have at least two
            let msg = await sendUserRequestAndWaitForCompletion(
                `@session new`,
                mainWindow,
            );
            expect(msg.toLowerCase()).toContain("new session created: ");

            // get the session count
            msg = await sendUserRequestAndWaitForCompletion(
                `@session list`,
                mainWindow,
            );
            let sessions = msg.split("\n");
            const originalSessionCount: number = sessions.length;
            const sessionName: string = sessions[sessions.length - 1];

            // issue delete session command
            msg = await sendUserRequestAndWaitForResponse(
                `@session delete ${sessions[0]}`,
                mainWindow,
            );
            expect(msg.toLowerCase()).toContain("are you sure");

            // click on cancel button
            await mainWindow
                .locator(".choice-button", { hasText: "No" })
                .click();

            // verify session not deleted
            msg = await sendUserRequestAndWaitForCompletion(
                `@session list`,
                mainWindow,
            );
            sessions = msg.split("\n");
            expect(sessions.length, "Session accidentally deleted.").toBe(
                originalSessionCount,
            );

            // reissue delete session command
            msg = await sendUserRequestAndWaitForResponse(
                `@session delete ${sessions[0]}`,
                mainWindow,
            );
            expect(msg.toLowerCase()).toContain("are you sure");

            // click on Yes button
            await mainWindow
                .locator(".choice-button", { hasText: "Yes" })
                .click();

            // get new session count
            msg = await sendUserRequestAndWaitForCompletion(
                `@session list`,
                mainWindow,
            );
            sessions = msg.split("\n");
            expect(sessions.length, "Session accidentally deleted.").toBe(
                originalSessionCount - 1,
            );

            // get session info
            msg = await sendUserRequestAndWaitForCompletion(
                `@session info`,
                mainWindow,
            );
            sessions = msg.split("\n");
            expect(sessions[1], "Wrong session selected.").toContain(
                sessionName,
            );
        });
    });

    test("@session reset/clear", async ({}, testInfo) => {
        console.log(`Running test '${testInfo.title}'`);

        // launch the app
        await runTestCallback(async (mainWindow: Page) => {
            // clear the history so we don't have two confirmation dialogs in the chat view
            await clearMessages(mainWindow);

            // reset
            let msg = await sendUserRequestAndWaitForCompletion(
                `@session reset`,
                mainWindow,
            );
            expect(msg).toContain("Session settings revert to default.");

            // issue clear session command
            msg = await sendUserRequestAndWaitForResponse(
                `@session clear`,
                mainWindow,
            );
            expect(msg.toLowerCase()).toContain("are you sure");

            // click on Yes button
            await mainWindow
                .locator(".choice-button", { hasText: "Yes" })
                .click();

            // Wait for the clear to fully complete before exiting. Clicking Yes
            // triggers a full context reinitialize inside the @session clear
            // handler (setSessionOnCommandHandlerContext: close all agents,
            // re-init memory, rebuild the agent cache, re-activate agents). If we
            // exit while that is still in-flight, @exit races it and the shell's
            // shutdown queue-drain (up to 30s) blocks the app from quitting, so
            // close() times out. A follow-up command completes only after the
            // clear ahead of it drains from the FIFO request queue, which
            // guarantees a quiescent shutdown.
            await sendUserRequestAndWaitForCompletion(
                `@session info`,
                mainWindow,
            );

            // The clear's success message is emitted only after the
            // reinitialize finishes, so it must be present by now.
            const messages = await getAllAgentMessages(mainWindow);
            expect(
                messages.some((m) => m.includes("Session data cleared.")),
                "Session data was not cleared.",
            ).toBeTruthy();

            // close the application
        });
    });

    test("@session open", async ({}, testInfo) => {
        console.log(`Running test '${testInfo.title}'`);

        // launch the app
        await runTestCallback(async (mainWindow: Page) => {
            // create a new session
            let msg = await sendUserRequestAndWaitForCompletion(
                `@session new`,
                mainWindow,
            );
            expect(msg.toLowerCase()).toContain("new session created: ");

            // get the session list
            msg = await sendUserRequestAndWaitForCompletion(
                `@session list`,
                mainWindow,
            );
            const sessions: string[] = msg.split("\n");

            // open the earlier session
            msg = await sendUserRequestAndWaitForCompletion(
                `@session open ${sessions[0]}`,
                mainWindow,
            );
            expect(msg, `Unexpected session opened!`).toBe(
                `Session opened: ${sessions[0]}`,
            );

            // close the application
        });
    });
});

// TODO: Test action correction
