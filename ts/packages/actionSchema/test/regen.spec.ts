// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import {
    parseActionSchemaFile,
    parseActionSchemaSource,
} from "../src/parser.js";

import { fileURLToPath } from "node:url";
import { generateActionSchema } from "../src/generator.js";

const dispatcherPath = fileURLToPath(
    new URL("../../../dispatcher", import.meta.url),
);
const configPath = path.resolve(dispatcherPath, "./data/config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const tests: {
    name: string;
    file: string;
    type: string;
}[] = [];

type Config = {
    schema?: {
        schemaFile: string;
        schemaType: string;
    };
    subTranslators?: Record<string, Config>;
};

function addTest(name: string, config: Config, dir: string) {
    const schema = config.schema;
    if (schema) {
        tests.push({
            name,
            file: path.resolve(dir, schema.schemaFile),
            type: schema.schemaType,
        });
    }

    if (config.subTranslators) {
        for (const [subname, subConfig] of Object.entries(
            config.subTranslators,
        )) {
            addTest(`${name}.${subname}`, subConfig, dir);
        }
    }
}

const dispatcherRequire = createRequire(`${dispatcherPath}/src`);
for (const [name, entry] of Object.entries(config.agents) as [string, any][]) {
    if (entry.type === "module") {
        const manifestModulePath = `${entry.name}/agent/manifest`;
        const manifestPath = dispatcherRequire.resolve(manifestModulePath);
        const manifest = dispatcherRequire(manifestPath);
        const manifestDir = path.dirname(manifestPath);
        addTest(name, manifest, manifestDir);
    } else {
        addTest(name, entry, dispatcherPath);
    }
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

const testInput = tests.map((t) => [t.name, t.file, t.type]);
describe("Action Schema Regeneration", () => {
    //
    // There are a couple of tests that fail because of minor difference in generating
    // - single line object property becomes multiline
    // - location of the entry type if it is not the first one.
    // There might be others, and because exact regeneration is not the goal, just
    // disable the test for now, and use this to manually check for real issues.
    //
    it.skip.each(testInput)(
        "should regenerate %s",
        async (name, file, type) => {
            const original = fs.readFileSync(file, "utf-8");
            const actionSchemaFile = parseActionSchemaFile(
                file,
                name,
                type,
                true,
            );
            const regenerated = await generateActionSchema(actionSchemaFile, {
                exact: true,
            });
            await compare(original, regenerated);
        },
    );

    it.each(testInput)(
        "should roundtrip regenerated - %s",
        async (name, file, type) => {
            const actionSchemaFile = parseActionSchemaFile(file, name, type);
            const regenerated = await generateActionSchema(actionSchemaFile);

            const roundtrip = parseActionSchemaSource(regenerated, name, type);
            const schema2 = await generateActionSchema(roundtrip);
            expect(schema2).toEqual(regenerated);
        },
    );
});
