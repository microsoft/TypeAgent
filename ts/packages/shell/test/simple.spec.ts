import test, { ElectronApplication,Page,_electron,
    _electron as electron, } from "@playwright/test";
import { getAppPath, startShell } from "./testHelper";

test("dummy", async () => {
    // do nothing
});

test("simple", async () => {
    const app: ElectronApplication = await electron.launch({ args: [getAppPath()] });
    const mainWindow: Page = await app.firstWindow();
    await mainWindow.bringToFront();
    await app.close();
});