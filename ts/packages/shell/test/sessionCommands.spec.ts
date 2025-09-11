// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test, {
    _electron,
    _electron as electron,
    expect,
    Page,
} from "@playwright/test";
import {
    exitApplication,
    getAppPath,
    getLastAgentMessage,
    sendUserRequest,
    sendUserRequestAndWaitForCompletion,
    sendUserRequestFast,
    startShell,
    waitForAgentMessage,
} from "./testHelper";
import { session } from "electron";

// Annotate entire file as serial.
test.describe.configure({ mode: "serial" });

test.describe("@session Commands", () => {
    test("@session new/list", async ({}, testInfo) => {
        console.log(`Running test '${testInfo.title}`);

        // launch the app
        const mainWindow: Page = await startShell();

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

        msg = await sendUserRequestAndWaitForCompletion(`@history`, mainWindow);
        expect(msg.length, "History NOT cleared!").toBe(0);

        // close the application
        await exitApplication(mainWindow);
    });

    test("@session new/delete/list/info", async ({}, testInfo) => {
        console.log(`Running test '${testInfo.title}`);

        // launch the app
        const mainWindow: Page = await startShell();

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
        msg = await sendUserRequestAndWaitForCompletion(
            `@session delete ${sessions[0]}`,
            mainWindow,
        );
        expect(msg.toLowerCase()).toContain("are you sure");

        // click on cancel button
        await mainWindow.locator(".choice-button", { hasText: "No" }).click();

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
        msg = await sendUserRequestAndWaitForCompletion(
            `@session delete ${sessions[0]}`,
            mainWindow,
        );
        expect(msg.toLowerCase()).toContain("are you sure");

        // click on Yes button
        await mainWindow.locator(".choice-button", { hasText: "Yes" }).click();

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
        expect(sessions[1], "Wrong session selected.").toContain(sessionName);

        // close the application
        await exitApplication(mainWindow);
    });

    test("@session reset/clear", async ({}, testInfo) => {
        console.log(`Running test '${testInfo.title}`);

        // launch the app
        const mainWindow: Page = await startShell();

        // clear the history so we don't have two confirmation dialogs in the chat view
        sendUserRequestFast(`@clear`, mainWindow);

        // reset
        let msg = await sendUserRequestAndWaitForCompletion(
            `@session reset`,
            mainWindow,
        );
        expect(msg).toContain("Session settings revert to default.");

        // issue clear session command
        msg = await sendUserRequestAndWaitForCompletion(
            `@session clear`,
            mainWindow,
        );
        expect(msg.toLowerCase()).toContain("are you sure");

        // click on Yes button
        await mainWindow.locator(".choice-button", { hasText: "Yes" }).click();

        // close the application
        await exitApplication(mainWindow);
    });

    test("@session open", async ({}, testInfo) => {
        console.log(`Running test '${testInfo.title}`);

        // launch the app
        const mainWindow: Page = await startShell();

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
        expect(msg, `Unexpected session openend!`).toBe(
            `Session opened: ${sessions[0]}`,
        );

        // close the application
        await exitApplication(mainWindow);
    });
});

// TODO: Test action correction
