import test, { ElectronApplication,_electron,
    _electron as electron, } from "@playwright/test";
import { getAppPath, testSetup } from "./testHelper";

test("dummy", async () => {
    // do nothing
});

test("simple", async () => {
    const window = await testSetup();
    await window.waitForTimeout(3000);
    await window.close();
});