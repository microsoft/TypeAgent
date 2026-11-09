// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    defaultInstanceDir,
    loadDotEnvFiles,
    parseCsvList,
} from "../src/translationBench/scripts/cliShared.js";

describe("translation bench shared CLI utilities", () => {
    it("normalizes comma-separated values", () => {
        expect(parseCsvList(" one, two ,,three ")).toEqual([
            "one",
            "two",
            "three",
        ]);
        expect(parseCsvList(" ")).toBeUndefined();
    });

    it("creates process-specific instance directories", () => {
        expect(defaultInstanceDir("eval")).toContain(`eval-${process.pid}`);
    });

    it("loads existing dotenv files with Node", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dotenv-"));
        const file = path.join(directory, ".env");
        fs.writeFileSync(file, "CLI_SHARED_NEW=loaded\n");
        const loadEnvFile = jest
            .spyOn(process, "loadEnvFile")
            .mockImplementation(() => undefined);

        loadDotEnvFiles([path.join(directory, "missing.env"), file]);

        expect(loadEnvFile).toHaveBeenCalledWith(file);
        expect(loadEnvFile).toHaveBeenCalledTimes(1);
        loadEnvFile.mockRestore();
        fs.rmSync(directory, { recursive: true });
    });
});
