#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Script to add schemaName field to all sub-schema actions in the grammar
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const grammarFile = path.join(__dirname, "..", "src", "desktopSchema.agr");

// Map of action names to their sub-schema names (using sub-action manifest keys)
const actionToSchema = {
    // Display actions
    EnableBlueLightFilterSchedule: "desktop-display",
    adjustColorTemperature: "desktop-display",
    DisplayScaling: "desktop-display",
    AdjustScreenOrientation: "desktop-display",
    RotationLock: "desktop-display",

    // Personalization actions (already done, but include for completeness)
    EnableTransparency: "desktop-personalization",
    ApplyColorToTitleBar: "desktop-personalization",
    HighContrastTheme: "desktop-personalization",

    // Taskbar actions
    AutoHideTaskbar: "desktop-taskbar",
    TaskbarAlignment: "desktop-taskbar",
    TaskViewVisibility: "desktop-taskbar",
    ToggleWidgetsButtonVisibility: "desktop-taskbar",
    ShowBadgesOnTaskbar: "desktop-taskbar",
    DisplayTaskbarOnAllMonitors: "desktop-taskbar",
    DisplaySecondsInSystrayClock: "desktop-taskbar",

    // Input actions
    SetPointerSpeed: "desktop-input",
    MouseScrollWheelLines: "desktop-input",
    SwapMouseButtons: "desktop-input",
    EnablePointerPrecision: "desktop-input",
    SetDoubleClickSpeed: "desktop-input",
    ConfigureTouchpad: "desktop-input",
    TouchpadScrollDirection: "desktop-input",
    TouchpadSensitivity: "desktop-input",

    // Privacy actions
    ManageMicrophoneAccess: "desktop-privacy",
    ManageCameraAccess: "desktop-privacy",
    ManageLocationAccess: "desktop-privacy",

    // Power actions
    BatterySaverActivationLevel: "desktop-power",
    setPowerModePluggedIn: "desktop-power",
    SetPowerModeOnBattery: "desktop-power",

    // System actions
    StartNarrator: "desktop-system",
    StartMagnifier: "desktop-system",
    StopMagnifier: "desktop-system",
    enableStickyKeys: "desktop-system",
    ShowFileExtensions: "desktop-system",
    ShowHiddenAndSystemFiles: "desktop-system",
    Set12Or24HourClock: "desktop-system",
    SetTimeZone: "desktop-system",
    ToggleFocusAssist: "desktop-system",
    EnableMeteredConnections: "desktop-system",
    SetScreensaverTimeout: "desktop-system",
    SetPrimaryMonitor: "desktop-system",
    DuplicateDisplay: "desktop-system",
    ExtendDisplay: "desktop-system",
};

console.log("Reading grammar file...");
let grammarContent = fs.readFileSync(grammarFile, "utf-8");

let changeCount = 0;

// For each action, find patterns and add schemaName
for (const [actionName, schemaName] of Object.entries(actionToSchema)) {
    // Match patterns like: -> { actionName: "ActionName", parameters: {...} }
    // And replace with: -> { schemaName: "schema.name", actionName: "ActionName", parameters: {...} }

    // Pattern without schemaName already
    const pattern = new RegExp(
        `(->\\s*\\{\\s*)actionName:\\s*"${actionName}"(,\\s*parameters:)`,
        "g",
    );

    const replacement = `$1schemaName: "${schemaName}", actionName: "${actionName}"$2`;

    const before = grammarContent;
    grammarContent = grammarContent.replace(pattern, replacement);

    if (grammarContent !== before) {
        const count = (before.match(pattern) || []).length;
        console.log(
            `  Updated ${count} occurrences of ${actionName} with ${schemaName}`,
        );
        changeCount += count;
    }
}

if (changeCount > 0) {
    fs.writeFileSync(grammarFile, grammarContent, "utf-8");
    console.log(`\n✅ Updated ${changeCount} action rules in grammar`);
} else {
    console.log("\n⚠️  No changes made");
}
