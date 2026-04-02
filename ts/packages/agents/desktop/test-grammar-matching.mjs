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

// Load grammar files
console.log("Loading grammar files...");

function loadGrammar(relPath) {
    const grammarPath = path.join(__dirname, relPath);
    const grammarText = fs.readFileSync(grammarPath, "utf-8");
    const grammar = loadGrammarRules(path.basename(relPath), grammarText);
    const nfa = compileGrammarToNFA(grammar);
    console.log(`  Loaded: ${relPath}`);
    return { grammar, nfa };
}

// Load main grammar + all sub-action grammars from manifest
const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "src/manifest.json"), "utf-8"),
);

const grammars = [loadGrammar("src/desktopSchema.agr")];

if (manifest.subActionManifests) {
    for (const [key, sub] of Object.entries(manifest.subActionManifests)) {
        const agrFileName = path
            .basename(sub.schema.grammarFile)
            .replace(".ag.json", ".agr");
        const agrPath = path.join("src/windows", agrFileName);
        if (fs.existsSync(path.join(__dirname, agrPath))) {
            grammars.push(loadGrammar(agrPath));
        } else {
            console.warn(`⚠️  Grammar file not found for ${key}: ${agrPath}`);
        }
    }
}

// Try matching a phrase against all loaded grammars
function matchPhrase(phrase) {
    for (const { grammar, nfa } of grammars) {
        const results = matchGrammarWithNFA(grammar, nfa, phrase);
        if (results.length > 0) {
            return results[0];
        }
    }
    return null;
}

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
    { phrase: "enable cursor trail", expected: "CursorTrail" },
    { phrase: "disable mouse trail", expected: "CursorTrail" },
    { phrase: "set cursor trail length to 8", expected: "CursorTrail" },

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
    const result = matchPhrase(phrase);

    if (result) {
        const action = result.match.actionName;
        if (action === expected) {
            console.log(`✅ "${phrase}"`);
            console.log(
                `   → ${action} ${JSON.stringify(result.match.parameters)}`,
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
