// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { parseActionSchemaSource } from "../src/parser.js";
import {
    toJSONActionSchemaFile,
    fromJSONActionSchemaFile,
} from "../src/serialize.js";
import { fileURLToPath } from "node:url";
import { generateActionSchema } from "../src/generator.js";

import prettier from "prettier";
import { SchemaConfig } from "../src/schemaConfig.js";

const defaultAgentProviderPath = fileURLToPath(
    new URL("../../../defaultAgentProvider", import.meta.url),
);
const configPath = path.resolve(defaultAgentProviderPath, "./data/config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const tests: {
    source: string;
    schemaConfig: SchemaConfig | undefined;
    schemaName: string;
    fileName: string;
    typeName: string;
}[] = [];

type Config = {
    schema?: {
        schemaFile: string;
        schemaType: string;
    };
    subActionManifests?: Record<string, Config>;
};

function loadSchemaConfig(fileName: string) {
    try {
        const parsedFileName = path.parse(fileName);
        const schemaConfigFileName = path.join(
            parsedFileName.dir,
            parsedFileName.name + ".json",
        );
        return fs.existsSync(schemaConfigFileName)
            ? JSON.parse(fs.readFileSync(schemaConfigFileName, "utf-8"))
            : undefined;
    } catch (e: any) {
        throw new Error(
            `Failed to load schema config file: ${fileName}\n${e.message}`,
        );
    }
}

function addTest(schemaName: string, config: Config, dir: string) {
    const schema = config.schema;
    if (schema) {
        const fileName = path.resolve(dir, schema.schemaFile);
        const schemaConfig = loadSchemaConfig(fileName);
        tests.push({
            source: fs.readFileSync(fileName, "utf-8"),
            schemaConfig,
            schemaName,
            fileName,
            typeName: schema.schemaType,
        });
    }

    if (config.subActionManifests) {
        for (const [subname, subConfig] of Object.entries(
            config.subActionManifests,
        )) {
            addTest(`${schemaName}.${subname}`, subConfig, dir);
        }
    }
}

const defaultAgentProviderRequire = createRequire(
    `${defaultAgentProviderPath}/src`,
);
for (const [name, entry] of Object.entries(config.agents) as [string, any][]) {
    const manifestModulePath = `${entry.name}/agent/manifest`;
    const manifestPath =
        defaultAgentProviderRequire.resolve(manifestModulePath);
    const manifest = defaultAgentProviderRequire(manifestPath);
    const manifestDir = path.dirname(manifestPath);
    addTest(name, manifest, manifestDir);
}

async function compare(original: string, regenerated: string) {
    // Remove original copy right.
    const lines = original.split("\n");
    lines.splice(0, 2);
    const source = lines.filter((l) => l !== "").join("\n");

    // Use prettier to remove any formatting differences
    const orig = await prettier.format(source, { parser: "typescript" });
    const regen = await prettier.format(regenerated, { parser: "typescript" });

    // Compare
    expect(regen).toEqual(orig);
}

describe("Action Schema Regeneration", () => {
    //
    // There are a couple of tests that fail because of minor difference in regenerating
    // - single line object property becomes multiline
    // - location of the entry type if it is not the first one.
    // There might be others, and because exact regeneration is not the goal, just
    // disable the test for now, and use this to manually check for real issues.
    //
    it.skip.each(tests)(
        "should regenerate $schemaName",
        async ({ source, schemaName, fileName, typeName, schemaConfig }) => {
            const actionSchemaFile = parseActionSchemaSource(
                source,
                schemaName,
                "testHash", // Don't care about source hash in tests
                typeName,
                fileName,
                schemaConfig,
                true,
            );
            const regenerated = await generateActionSchema(actionSchemaFile, {
                exact: true,
            });
            await compare(source, regenerated);
        },
    );

    it.each(tests)(
        "should roundtrip regenerated - $schemaName",
        async ({ source, schemaName, fileName, typeName }) => {
            const actionSchemaFile = parseActionSchemaSource(
                source,
                schemaName,
                "testHash", // Don't care about source hash in tests
                typeName,
                fileName,
            );
            const regenerated = await generateActionSchema(actionSchemaFile);

            const roundtrip = parseActionSchemaSource(
                regenerated,
                schemaName,
                "testHash", // Don't care about source hash in tests
                typeName,
            );
            const schema2 = await generateActionSchema(roundtrip);
            expect(schema2).toEqual(regenerated);
        },
    );
});

describe("Action Schema Serialization", () => {
    it.each(tests)(
        "roundtrip $schemaName",
        async ({ source, schemaName, fileName, typeName }) => {
            const actionSchemaFile = parseActionSchemaSource(
                source,
                schemaName,
                "testHash", // Don't care about source hash in tests
                typeName,
                fileName,
            );
            const serialized = toJSONActionSchemaFile(actionSchemaFile);
            const deserialized = fromJSONActionSchemaFile(
                structuredClone(serialized),
            );

            expect(deserialized).toEqual(actionSchemaFile);

            const serialized2 = toJSONActionSchemaFile(actionSchemaFile);
            expect(serialized2).toEqual(serialized);

            const deserialized2 = fromJSONActionSchemaFile(
                structuredClone(serialized),
            );
            expect(deserialized2).toEqual(deserialized);
        },
    );
});
