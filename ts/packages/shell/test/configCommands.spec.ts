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

test("@config dev", async () => {

    // launch the app
    const mainWindow: Page = await testSetup();

    await sendUserRequestAndWaitForResponse(`@config dev`, mainWindow);
    let msg = await getLastAgentMessage(mainWindow);

    expect(msg.toLowerCase(), "Dev mode was not turned on as expected.").toBe("development mode is enabled.")

    await sendUserRequestAndWaitForResponse(`@config dev on`, mainWindow);
    msg = await getLastAgentMessage(mainWindow);

    expect(msg.toLowerCase(), "Dev mode was not turned on as expected.").toBe("development mode is enabled.")

    await sendUserRequestAndWaitForResponse(`@config dev off`, mainWindow);
    msg = await getLastAgentMessage(mainWindow);

    expect(msg.toLowerCase(), "Dev mode was not turned off as expected.").toBe("development mode is disabled.")

    // close the application
    await exitApplication(mainWindow);
});

// TODO: Test action correction