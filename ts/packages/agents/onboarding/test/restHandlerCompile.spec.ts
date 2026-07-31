// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Verifies the generator's output actually type-checks with `tsc` (CHANGE 3
// acceptance criterion 2d). Writes a generated handler + a matching schema
// stub to a scratch folder nested inside the onboarding package (so
// module resolution finds the workspace's @typeagent/agent-sdk via the
// package's own node_modules symlink), then runs `tsc --noEmit` on it.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { buildRestHandler } from "../src/scaffolder/restHandlerTemplate.js";
import type { DiscoveredAction } from "../src/discovery/discoveryHandler.js";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRATCH_DIR = path.resolve(__dirname, ".tmp-rest-handler-compile");

const actions: DiscoveredAction[] = [
    {
        name: "getBook",
        description: "Get a book",
        method: "GET",
        path: "/books/{book_id}",
        parameters: [
            { name: "book_id", type: "string", required: true, in: "path" },
            {
                name: "include_reviews",
                type: "boolean",
                required: false,
                in: "query",
            },
        ],
    },
    {
        name: "createBook",
        description: "Create a book",
        method: "POST",
        path: "/books",
        parameters: [
            { name: "title", type: "string", required: true, in: "body" },
            { name: "author", type: "string", required: false, in: "body" },
        ],
    },
    {
        name: "deleteBook",
        description: "Delete a book",
        method: "DELETE",
        path: "/books/{book_id}",
        parameters: [
            { name: "book_id", type: "string", required: true, in: "path" },
        ],
    },
];

function buildSchemaStub(pascalName: string): string {
    const members = actions
        .map(
            (a) =>
                `    | {\n` +
                `          actionName: ${JSON.stringify(a.name)};\n` +
                `          parameters: Record<string, unknown>;\n` +
                `      }`,
        )
        .join("\n");
    return (
        `// Copyright (c) Microsoft Corporation.\n` +
        `// Licensed under the MIT License.\n\n` +
        `export type ${pascalName}Actions =\n${members};\n`
    );
}

after(async () => {
    await fs.rm(SCRATCH_DIR, { recursive: true, force: true });
});

test("buildRestHandler output type-checks with tsc", async () => {
    await fs.rm(SCRATCH_DIR, { recursive: true, force: true });
    await fs.mkdir(SCRATCH_DIR, { recursive: true });

    const name = "bookApi";
    const pascalName = "BookApi";
    const handlerSource = await buildRestHandler(
        name,
        pascalName,
        "https://api.example.com/v1",
        actions,
    );

    await fs.writeFile(
        path.join(SCRATCH_DIR, `${name}ActionHandler.ts`),
        handlerSource,
        "utf-8",
    );
    await fs.writeFile(
        path.join(SCRATCH_DIR, `${name}Schema.ts`),
        buildSchemaStub(pascalName),
        "utf-8",
    );
    await fs.writeFile(
        path.join(SCRATCH_DIR, "tsconfig.json"),
        JSON.stringify(
            {
                compilerOptions: {
                    target: "es2021",
                    lib: ["es2021"],
                    module: "node16",
                    moduleResolution: "node16",
                    types: ["node"],
                    esModuleInterop: true,
                    skipLibCheck: true,
                    strict: true,
                    noEmit: true,
                },
                include: ["*.ts"],
            },
            null,
            2,
        ),
        "utf-8",
    );

    const tscBin = path.resolve(
        __dirname,
        "../node_modules/typescript/bin/tsc",
    );
    try {
        await execFileAsync(process.execPath, [tscBin, "-p", SCRATCH_DIR], {
            cwd: SCRATCH_DIR,
        });
    } catch (err: any) {
        assert.fail(
            `Generated REST handler failed to type-check:\n${err.stdout ?? err.message}`,
        );
    }
});
