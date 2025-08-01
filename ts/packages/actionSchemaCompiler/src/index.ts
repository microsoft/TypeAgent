// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command, Flags } from "@oclif/core";
import {
    parseActionSchemaSource,
    SchemaConfig,
    toJSONParsedActionSchema,
} from "action-schema";
import path from "node:path";
import fs from "node:fs";

function getSchemaConfig(schemaFile: string): SchemaConfig | undefined {
    const parts = path.parse(schemaFile);
    const schemaConfigFile = path.join(parts.dir, parts.name + ".json");
    if (!fs.existsSync(schemaConfigFile)) {
        console.log(`Schema config not found`);
        return undefined;
    }

    console.log(`Schema config loaded: ${schemaConfigFile}`);
    return JSON.parse(fs.readFileSync(schemaConfigFile, "utf-8"));
}
export default class Compile extends Command {
    static description = "Compile action schema files";

    static flags = {
        input: Flags.file({
            description: "Input action schema definition in typescript",
            required: true,
            exists: true,
            char: "i",
        }),
        output: Flags.string({
            description: "Output file for parsed action schema group",
            required: true,
            char: "o",
        }),
        actionType: Flags.string({
            description: "Entry type name for the action schemas",
            required: true,
            char: "t",
        }),
        entityType: Flags.string({
            description: "Entity type name for the entity types",
            required: false,
            char: "e",
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(Compile);

        const name = path.basename(flags.input);

        const type = flags.entityType
            ? {
                  action: flags.actionType,
                  entity: flags.entityType,
              }
            : flags.actionType;
        const actionSchemaFile = parseActionSchemaSource(
            fs.readFileSync(flags.input, "utf-8"),
            name,
            type,
            flags.input,
            getSchemaConfig(flags.input),
            true,
        );

        console.log(
            `Parse completed: ${actionSchemaFile.actionSchemas.size} actions found`,
        );
        const outputDir = path.dirname(flags.output);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        fs.writeFileSync(
            flags.output,
            JSON.stringify(toJSONParsedActionSchema(actionSchemaFile)),
        );
        console.log(`Parsed action schema written: ${flags.output}`);
    }
}
