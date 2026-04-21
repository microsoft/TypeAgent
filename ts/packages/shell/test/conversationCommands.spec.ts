// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test, { expect, Page } from "@playwright/test";
import {
    clearMessages,
    runTestCallback,
    sendUserRequestAndWaitForCompletion,
    sendUserRequestAndWaitForResponse,
} from "./testHelper";

// Annotate entire file as serial.
test.describe.configure({ mode: "serial" });

test.describe("@conversation Commands", () => {
    test("@conversation new/list", async ({}, testInfo) => {
        console.log(`Running test '${testInfo.title}'`);

        // launch the app
        await runTestCallback(async (mainWindow: Page) => {
            // get the session count
            let msg = await sendUserRequestAndWaitForResponse(
                `@conversation list`,
                mainWindow,
            );

            const sessions: string[] = msg.split("\n");

            msg = await sendUserRequestAndWaitForResponse(
                `@conversation new`,
                mainWindow,
            );
            expect(msg.toLowerCase()).toContain("new conversation created: ");

            msg = await sendUserRequestAndWaitForResponse(
                `@conversation list`,
                mainWindow,
            );
            const newSessions: string[] = msg.split("\n");

            expect(newSessions.length, "Conversation count mismatch!").toBe(
                sessions.length + 1,
            );

            msg = await sendUserRequestAndWaitForCompletion(
                `@history`,
                mainWindow,
            );
            expect(msg.length, "History NOT cleared!").toBe(0);
        });
    });

    test("@conversation new/delete/list/info", async ({}, testInfo) => {
        console.log(`Running test '${testInfo.title}'`);

        // launch the app
        await runTestCallback(async (mainWindow: Page) => {
            // create a new session so we have at least two
            let msg = await sendUserRequestAndWaitForResponse(
                `@conversation new`,
                mainWindow,
            );
            expect(msg.toLowerCase()).toContain("new conversation created: ");

            // get the session count
            msg = await sendUserRequestAndWaitForResponse(
                `@conversation list`,
                mainWindow,
            );
            let sessions = msg.split("\n");
            const originalSessionCount: number = sessions.length;
            const sessionName: string = sessions[sessions.length - 1];

            // issue delete session command
            msg = await sendUserRequestAndWaitForResponse(
                `@conversation delete ${sessions[0]}`,
                mainWindow,
            );
            expect(msg.toLowerCase()).toContain("are you sure");

            // click on cancel button
            await mainWindow
                .locator(".choice-button", { hasText: "No" })
                .click();

            // verify session not deleted
            msg = await sendUserRequestAndWaitForResponse(
                `@conversation list`,
                mainWindow,
            );
            sessions = msg.split("\n");
            expect(sessions.length, "Conversation accidentally deleted.").toBe(
                originalSessionCount,
            );

            // reissue delete session command
            msg = await sendUserRequestAndWaitForResponse(
                `@conversation delete ${sessions[0]}`,
                mainWindow,
            );
            expect(msg.toLowerCase()).toContain("are you sure");

            // click on Yes button
            await mainWindow
                .locator(".choice-button", { hasText: "Yes" })
                .click();

            // get new session count
            msg = await sendUserRequestAndWaitForResponse(
                `@conversation list`,
                mainWindow,
            );
            sessions = msg.split("\n");
            expect(sessions.length, "Conversation accidentally deleted.").toBe(
                originalSessionCount - 1,
            );

            // get session info
            msg = await sendUserRequestAndWaitForResponse(
                `@conversation info`,
                mainWindow,
            );
            sessions = msg.split("\n");
            expect(sessions[1], "Wrong conversation selected.").toContain(
                sessionName,
            );
        });
    });

    test("@conversation reset/clear", async ({}, testInfo) => {
        console.log(`Running test '${testInfo.title}'`);

        // launch the app
        await runTestCallback(async (mainWindow: Page) => {
            // clear the history so we don't have two confirmation dialogs in the chat view
            await clearMessages(mainWindow);

            // reset
            let msg = await sendUserRequestAndWaitForCompletion(
                `@conversation reset`,
                mainWindow,
            );
            expect(msg).toContain("Conversation settings revert to default.");

            // issue clear session command
            msg = await sendUserRequestAndWaitForResponse(
                `@conversation clear`,
                mainWindow,
            );
            expect(msg.toLowerCase()).toContain("are you sure");

            // click on Yes button
            await mainWindow
                .locator(".choice-button", { hasText: "Yes" })
                .click();

            // close the application
        });
    });

    test("@conversation open", async ({}, testInfo) => {
        console.log(`Running test '${testInfo.title}'`);

        // launch the app
        await runTestCallback(async (mainWindow: Page) => {
            // create a new session
            let msg = await sendUserRequestAndWaitForResponse(
                `@conversation new`,
                mainWindow,
            );
            expect(msg.toLowerCase()).toContain("new conversation created: ");

            // get the session list
            msg = await sendUserRequestAndWaitForResponse(
                `@conversation list`,
                mainWindow,
            );
            const sessions: string[] = msg.split("\n");

            // open the earlier session
            msg = await sendUserRequestAndWaitForResponse(
                `@conversation open ${sessions[0]}`,
                mainWindow,
            );
            expect(msg, `Unexpected conversation opened!`).toBe(
                `Conversation opened: ${sessions[0]}`,
            );

            // close the application
        });
    });
});

// TODO: Test action correction
