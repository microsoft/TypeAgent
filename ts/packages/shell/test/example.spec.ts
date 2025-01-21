// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test, { _electron as electron, expect } from '@playwright/test';
import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export default defineConfig({
  timeout: 120_000, // Set global timeout to 120 seconds
});

/**
 * Gets the correct path based on test context (cmdline vs. VSCode extension)
 * @returns The root path to the project containing the playwright configuration
 */
function getAppPath(): string {
  if (fs.existsSync('playwright.config.ts')) {
    return '.';
  } else {
    return path.join('.', 'packages/shell');
  }
}

test('launch app', async () => {
  const electronApp = await electron.launch({ args: [getAppPath()] })
  // close app
  await electronApp.close()
});

test('get isPackaged', async () => {
  const electronApp = await electron.launch({ args: [getAppPath()] })
  const isPackaged = await electronApp.evaluate(async ({ app }) => {
    // This runs in Electron's main process, parameter here is always
    // the result of the require('electron') in the main app script.
    return app.isPackaged
  })
  console.log(isPackaged) // false (because we're in development mode)
  // close app
  await electronApp.close()
});


test('launch app2', async() => {
  // Launch Electron app.
  const electronApp = await electron.launch({ args: [getAppPath()] });

  // Evaluation expression in the Electron context.
  const appPath = await electronApp.evaluate(async ({ app }) => {
    // This runs in the main Electron process, parameter here is always
    // the result of the require('electron') in the main app script.
    return app.getAppPath();
  });
  console.log(appPath);

  // Get the first window that the app opens, wait if necessary.
  const window = await electronApp.firstWindow();
  // Print the title.
  console.log(await window.title());
  // Capture a screenshot.
  await window.screenshot({ path: 'test-results/intro.png' });
  // Direct Electron console to Node terminal.
  window.on('console', console.log);
  //// Click button.
  //await window.click('text=Click me');
  // Exit app.
  await electronApp.close();
});

test('save screenshot', async () => {
  const electronApp = await electron.launch({ args: [getAppPath()] })
  const window = await electronApp.firstWindow()
  await window.screenshot({ path: 'test-results/intro.png' })
  // close app
  await electronApp.close()
});

test('example test', async () => {
  const electronApp = await electron.launch({ args: [getAppPath()] })
  const isPackaged = await electronApp.evaluate(async ({ app }) => {
    // This runs in Electron's main process, parameter here is always
    // the result of the require('electron') in the main app script.
    return app.isPackaged
  })

  expect(isPackaged).toBe(false)

  // Wait for the first BrowserWindow to open
  // and return its Page object
  const window = await electronApp.firstWindow()
  await window.screenshot({ path: 'test-results/intro.png' })

  // close app
  await electronApp.close()
});
