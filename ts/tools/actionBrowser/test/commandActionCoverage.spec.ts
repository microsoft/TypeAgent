// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseSchemaSource } from "@typeagent/action-schema";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectCatalog } from "../src/collect.js";
import type { Catalog } from "../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(here, "..", "..", "..", "..");

let catalog: Catalog;

describe("command action coverage", () => {
    beforeAll(async () => {
        catalog = await collectCatalog({ strict: true });
    }, 30_000);

    it("links every bundled executable command to a valid action", () => {
        expect(catalog.commandActionLinkIssues).toEqual([]);
        expect(catalog.missingCommandActions).toEqual([]);
        expect(catalog.counts.linkedCommandEndpoints).toBe(
            catalog.counts.commandEndpoints,
        );
    });

    it("keeps ConfigCommandPath synchronized with executable config commands", () => {
        const schemaPath = path.join(
            workspaceRoot,
            "packages",
            "dispatcher",
            "dispatcher",
            "src",
            "context",
            "system",
            "schema",
            "configActionSchema.ts",
        );
        const definitions = parseSchemaSource(
            fs.readFileSync(schemaPath, "utf8"),
            schemaPath,
        );
        const commandPathType = definitions.get("ConfigCommandPath")?.type;
        expect(commandPathType?.type).toBe("string-union");
        if (commandPathType?.type !== "string-union") {
            return;
        }

        const executablePaths = catalog.commands
            .filter(
                (command) =>
                    command.host === "system" &&
                    command.executable &&
                    command.path.startsWith("config "),
            )
            .map((command) => command.path.slice("config ".length))
            .sort();

        expect([...commandPathType.typeEnum].sort()).toEqual(executablePaths);

        const actionType = definitions.get("RunConfigCommandAction")
            ?.type as any;
        const actionFlagNames = Object.keys(
            actionType.fields.parameters.type.fields.flags.type.fields,
        ).sort();
        const commandFlagNames = Array.from(
            new Set(
                catalog.commands
                    .filter(
                        (command) =>
                            command.host === "system" &&
                            command.executable &&
                            command.path.startsWith("config "),
                    )
                    .flatMap((command) =>
                        command.flags.map((flag) => flag.name),
                    ),
            ),
        ).sort();

        expect(actionFlagNames).toEqual(commandFlagNames);
    });
});
