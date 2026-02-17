#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Build script to combine all action schema files into a single file for asc compilation
 * This is needed because the action schema compiler (asc) cannot handle imports or exports
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcDir = path.join(__dirname, "..", "src");
const distDir = path.join(__dirname, "..", "dist");
const outputFile = path.join(distDir, "combinedActionsSchema.ts");

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

// Sub-schema files to include (in order)
const subSchemaFiles = [
    path.join(srcDir, "windows", "displayActionsSchema.ts"),
    path.join(srcDir, "windows", "personalizationActionsSchema.ts"),
    path.join(srcDir, "windows", "taskbarActionsSchema.ts"),
    path.join(srcDir, "windows", "inputActionsSchema.ts"),
    path.join(srcDir, "windows", "privacyActionsSchema.ts"),
    path.join(srcDir, "windows", "powerActionsSchema.ts"),
    path.join(srcDir, "windows", "systemActionsSchema.ts"),
];

const mainSchemaFile = path.join(srcDir, "actionsSchema.ts");

// Read and combine sub-schema files first
let combinedContent = "";

for (const file of subSchemaFiles) {
    console.log(`Reading ${path.basename(file)}...`);
    const content = fs.readFileSync(file, "utf-8");

    // Remove copyright headers
    const cleanedContent = content.replace(
        /\/\/ Copyright.*\n\/\/ Licensed.*\n\n?/g,
        "",
    );

    combinedContent += cleanedContent;
    combinedContent += "\n";
}

// Read main schema file
console.log(`Reading ${path.basename(mainSchemaFile)}...`);
const mainContent = fs.readFileSync(mainSchemaFile, "utf-8");

// Remove copyright headers
const cleanedMainContent = mainContent.replace(
    /\/\/ Copyright.*\n\/\/ Licensed.*\n\n?/g,
    "",
);

// Find and expand the DesktopActions type to include sub-schema types
// Replace the line "| AdjustScreenBrightnessAction;" with an expanded version
const expandedMainContent = cleanedMainContent.replace(
    /(\|\s*AdjustScreenBrightnessAction);/,
    `$1
    | DesktopDisplayActions
    | DesktopPersonalizationActions
    | DesktopTaskbarActions
    | DesktopInputActions
    | DesktopPrivacyActions
    | DesktopPowerActions
    | DesktopSystemActions;`,
);

combinedContent += expandedMainContent;

// Write combined file
fs.writeFileSync(outputFile, combinedContent, "utf-8");
console.log(`\n✅ Combined schema written to ${path.basename(outputFile)}`);
console.log(`   Total size: ${Math.round(combinedContent.length / 1024)}KB`);
