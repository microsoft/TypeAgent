// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Guards against a system sub-schema that compiles (tsc) but fails the runtime
// strict parse the dispatcher runs when a schema is enabled for translation -
// e.g. a doc comment on the entry type, which the action-schema parser rejects.
// Regular tests miss this because schema parsing is lazy (only on enable/use).
//
// The schema files are globbed (not imported) to avoid the systemAgent import
// cycle; ENTRY_TYPES must name every one, so a newly added schema fails here
// until it is covered.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseActionSchemaSource } from "@typeagent/action-schema";

// __dirname is dist/test/, so go up two levels to the package root, then src.
const schemaDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "src",
    "context",
    "system",
    "schema",
);

// schema file name -> its exported entry (action) type, matching the
// subActionManifests registration in systemAgent.ts.
const ENTRY_TYPES: Record<string, string> = {
    "collisionActionSchema.ts": "CollisionAction",
    "configActionSchema.ts": "ConfigAction",
    "constructionActionSchema.ts": "ConstructionAction",
    "conversationActionSchema.ts": "ConversationAction",
    "copilotActionSchema.ts": "CopilotAction",
    "feedbackActionSchema.ts": "FeedbackAction",
    "grammarActionSchema.ts": "GrammarAction",
    "helpActionSchema.ts": "HelpAction",
    "historyActionSchema.ts": "HistoryAction",
    "indexActionSchema.ts": "IndexAction",
    "memoryActionSchema.ts": "MemoryAction",
    "notificationActionSchema.ts": "NotificationAction",
    "sessionActionSchema.ts": "SessionAction",
    "settingsActionSchema.ts": "UserSettingsAction",
    "systemDiagnosticsActionSchema.ts": "SystemDiagnosticsAction",
    "systemOperationsActionSchema.ts": "SystemOperationsAction",
};

const schemaFiles = fs
    .readdirSync(schemaDir)
    .filter((f) => f.endsWith("ActionSchema.ts"));

describe("system sub-schemas parse in strict mode", () => {
    test("every schema file has a known entry type", () => {
        const missing = schemaFiles.filter((f) => !(f in ENTRY_TYPES));
        expect(missing).toEqual([]);
    });

    test.each(schemaFiles)("%s parses strictly", (file) => {
        const schemaType = ENTRY_TYPES[file];
        expect(schemaType).toBeDefined();
        const source = fs.readFileSync(path.join(schemaDir, file), "utf-8");
        // strict=true mirrors the runtime schema-enable path.
        const parsed = parseActionSchemaSource(
            source,
            `system.${file}`,
            schemaType,
            file,
            undefined,
            true,
        );
        expect(parsed.actionSchemas.size).toBeGreaterThan(0);
    });
});
