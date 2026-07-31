// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect, it } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const actionDirectory = new URL("../context/system/action/", import.meta.url);
const modules = readdirSync(actionDirectory)
    .filter((name) => name.endsWith("ActionHandler.js"))
    .map((name) => name.slice(0, -3));

it.each(modules)("imports %s in a fresh native ESM process", (moduleName) => {
    const moduleUrl = new URL(
        `../context/system/action/${moduleName}.js`,
        import.meta.url,
    ).href;
    const result = spawnSync(
        process.execPath,
        [
            "--input-type=module",
            "--eval",
            "await import(process.argv[1])",
            moduleUrl,
        ],
        { encoding: "utf8" },
    );

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
});
