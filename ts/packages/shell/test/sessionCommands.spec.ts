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
    sendUserRequestAndWaitForResponse,
    testSetup,
    waitForAgentMessage,
} from "./testHelper";

// Annotate entire file as serial.
test.describe.configure({ mode: 'serial' });

test.describe("@session Commands", () => {

    test("@session new/list", async () => {

        // launch the app
        const mainWindow: Page = await testSetup();

        // get the session count
        let msg = await sendUserRequestAndWaitForResponse(`@session list`, mainWindow);
        
        const sessions: string[] = msg.split("\n");
        
        msg = await sendUserRequestAndWaitForResponse(`@session new`, mainWindow);
        expect(msg.toLowerCase()).toContain("New session created: ");

        msg = await sendUserRequestAndWaitForResponse(`@session list`, mainWindow);
        const newSessions: string[] = msg.split("\n");

        expect(newSessions.length, "Session count mismatch!").toBe(sessions.length + 1);

        msg = await sendUserRequestAndWaitForResponse(`@history`, mainWindow);
        expect(msg.length, "History NOT cleared!").toBe(0);

        // close the application
        await exitApplication(mainWindow);
    });
});

// TODO: Test action correction