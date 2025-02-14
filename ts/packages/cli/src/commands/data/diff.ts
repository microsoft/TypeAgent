// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import child_process from "node:child_process";
import { Args, Command } from "@oclif/core";
import { readExplanationTestData } from "agent-dispatcher/internal";

export default class ExplanationDataDiffCommand extends Command {
    static args = {
        file: Args.string({
            description: "Input test data file",
            required: true,
        }),
        diff: Args.string({
            description: "Output file",
        }),
    };

    static description = "Regenerate the data in the test data file";
    static example = [
        `$ <%= config.bin %> <%= command.id %> data.json [...<files>]`,
    ];

    async run(): Promise<void> {
        const { args } = await this.parse(ExplanationDataDiffCommand);

        const properties = ["synonyms", "alternatives", "corrections"];
        const stripProperties = (obj: any, properties: string[]) => {
            for (const name of Object.keys(obj)) {
                if (properties.includes(name)) {
                    delete obj[name];
                }
                if (typeof obj[name] === "object") {
                    stripProperties(obj[name], properties);
                }
            }
        };

        const currData = await readExplanationTestData(args.file);
        stripProperties(currData, properties);

        let prevData;
        if (args.diff === undefined) {
            const filePath = path.relative(process.cwd(), args.file);
            const prevVersion = child_process
                .execFileSync("git", ["show", `HEAD:./${filePath}`])
                .toString();
            prevData = JSON.parse(prevVersion);
        } else {
            prevData = await readExplanationTestData(args.diff);
        }
        stripProperties(prevData, properties);

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-cli-"));
        const parsedPath = path.parse(args.file);
        const currFile = path.join(tempDir, `${parsedPath.name}.curr.json`);
        const prevFile = path.join(tempDir, `${parsedPath.name}.prev.json`);
        const p = [
            fs.promises.writeFile(
                prevFile,
                JSON.stringify(prevData, undefined, 2),
            ),
            fs.promises.writeFile(
                currFile,
                JSON.stringify(currData, undefined, 2),
            ),
        ];
        await Promise.all(p);

        child_process.execSync(`code --wait --diff ${prevFile} ${currFile}`);

        fs.rmSync(tempDir, { recursive: true });
    }
}
