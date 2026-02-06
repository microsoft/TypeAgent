// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Quick test script to verify grammar matching for desktop agent
import { loadGrammarRules } from "../../actionGrammar/dist/grammarLoader.js";
import { compileGrammarToNFA } from "../../actionGrammar/dist/nfaCompiler.js";
import { matchGrammarWithNFA } from "../../actionGrammar/dist/nfaMatcher.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load the grammar file
console.log("Loading grammar file...");
const grammarPath = path.join(__dirname, "src/desktopSchema.agr");
const grammarText = fs.readFileSync(grammarPath, "utf-8");
const grammar = loadGrammarRules("desktopSchema.agr", grammarText);

// Compile to NFA
console.log("Compiling grammar to NFA...");
const nfa = compileGrammarToNFA(grammar);

console.log("\n=== Testing Desktop Agent Grammar Matching ===\n");

// Test phrases for different action categories
const testCases = [
    // Network Settings
    { phrase: "turn on bluetooth", expected: "BluetoothToggle" },
    { phrase: "disable wifi", expected: "enableWifi" },
    {
        phrase: "enable metered connection",
        expected: "enableMeteredConnections",
    },

    // Display Settings
    { phrase: "increase brightness", expected: "AdjustScreenBrightness" },
    { phrase: "make the screen dimmer", expected: "AdjustScreenBrightness" },
    { phrase: "enable night light", expected: "EnableBlueLightFilterSchedule" },
    {
        phrase: "set orientation to landscape",
        expected: "AdjustScreenOrientation",
    },
    { phrase: "lock rotation", expected: "RotationLock" },

    // Personalization
    { phrase: "enable transparency", expected: "EnableTransparency" },
    {
        phrase: "show accent color on title bars",
        expected: "ApplyColorToTitleBar",
    },
    { phrase: "enable high contrast", expected: "HighContrastTheme" },

    // Taskbar
    { phrase: "auto hide taskbar", expected: "AutoHideTaskbar" },
    { phrase: "center the taskbar", expected: "TaskbarAlignment" },
    { phrase: "show task view button", expected: "TaskViewVisibility" },
    { phrase: "hide widgets", expected: "ToggleWidgetsButtonVisibility" },
    {
        phrase: "show seconds in clock",
        expected: "DisplaySecondsInSystrayClock",
    },

    // Mouse
    { phrase: "set mouse speed to 12", expected: "MouseCursorSpeed" },
    { phrase: "scroll 5 lines per notch", expected: "MouseWheelScrollLines" },
    { phrase: "swap mouse buttons", expected: "setPrimaryMouseButton" },
    {
        phrase: "enable mouse acceleration",
        expected: "EnhancePointerPrecision",
    },

    // Privacy
    { phrase: "allow microphone access", expected: "ManageMicrophoneAccess" },
    { phrase: "deny camera access", expected: "ManageCameraAccess" },
    { phrase: "enable location services", expected: "ManageLocationAccess" },

    // Accessibility
    { phrase: "start narrator", expected: "EnableNarratorAction" },
    { phrase: "turn off magnifier", expected: "EnableMagnifier" },
    { phrase: "enable sticky keys", expected: "enableStickyKeys" },

    // File Explorer
    { phrase: "show file extensions", expected: "ShowFileExtensions" },
    { phrase: "show hidden files", expected: "ShowHiddenAndSystemFiles" },

    // Power
    {
        phrase: "set battery saver to 20 percent",
        expected: "BatterySaverActivationLevel",
    },
    {
        phrase: "set power mode to best performance",
        expected: "setPowerModePluggedIn",
    },

    // Existing actions
    { phrase: "set theme to dark", expected: "setThemeMode" },
    { phrase: "set volume to 50", expected: "volume" },
];

let passed = 0;
let failed = 0;

for (const { phrase, expected } of testCases) {
    const results = matchGrammarWithNFA(grammar, nfa, phrase);

    if (results.length > 0) {
        const action = results[0].match.actionName;
        if (action === expected) {
            console.log(`✅ "${phrase}"`);
            console.log(
                `   → ${action} ${JSON.stringify(results[0].match.parameters)}`,
            );
            passed++;
        } else {
            console.log(`❌ "${phrase}"`);
            console.log(`   Expected: ${expected}, Got: ${action}`);
            failed++;
        }
    } else {
        console.log(`❌ "${phrase}"`);
        console.log(`   Expected: ${expected}, Got: NO MATCH`);
        failed++;
    }
}

console.log(`\n=== Test Results ===`);
console.log(`✅ Passed: ${passed}/${testCases.length}`);
console.log(`❌ Failed: ${failed}/${testCases.length}`);
console.log(`Success Rate: ${((passed / testCases.length) * 100).toFixed(1)}%`);

if (failed === 0) {
    console.log("\n🎉 All tests passed!");
    process.exit(0);
} else {
    console.log("\n⚠️  Some tests failed");
    process.exit(1);
}
