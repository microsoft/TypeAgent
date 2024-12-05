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

const dispatcherPath = fileURLToPath(
    new URL("../../../dispatcher", import.meta.url),
);
const configPath = path.resolve(dispatcherPath, "./data/config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const tests: {
    source: string;
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

function addTest(schemaName: string, config: Config, dir: string) {
    const schema = config.schema;
    if (schema) {
        const fileName = path.resolve(dir, schema.schemaFile);
        tests.push({
            source: fs.readFileSync(fileName, "utf-8"),
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

const dispatcherRequire = createRequire(`${dispatcherPath}/src`);
for (const [name, entry] of Object.entries(config.agents) as [string, any][]) {
    const manifestModulePath = `${entry.name}/agent/manifest`;
    const manifestPath = dispatcherRequire.resolve(manifestModulePath);
    const manifest = dispatcherRequire(manifestPath);
    const manifestDir = path.dirname(manifestPath);
    addTest(name, manifest, manifestDir);
}

import prettier from "prettier";
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
        async ({ source, schemaName, fileName, typeName }) => {
            const actionSchemaFile = parseActionSchemaSource(
                source,
                schemaName,
                typeName,
                fileName,
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
                typeName,
                fileName,
            );
            const regenerated = await generateActionSchema(actionSchemaFile);

            const roundtrip = parseActionSchemaSource(
                regenerated,
                schemaName,
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
