// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command } from "@oclif/core";
import { createLanguageModel } from "typechat";
import fs from "node:fs";
import chalk from "chalk";

export default class Prompt extends Command {
    static description = "Send a prompt to GPT";
    static args = {
        request: Args.string({
            description: "Request for GPT to complete",
            required: true,
        }),
    };

    async run(): Promise<void> {
        const { args } = await this.parse(Prompt);
        const model = createLanguageModel(process.env);
        const isFile = fs.existsSync(args.request);
        if (isFile) {
            console.log(`Loading prompt from file: ${args.request}`);
        }
        const request = (
            fs.existsSync(args.request)
                ? await fs.promises.readFile(args.request, "utf8")
                : args.request
        ).trim();

        console.log(`Sending prompt to GPT:`);

        console.log(chalk.grey(request));
        const complete = await model.complete(request);
        if (complete.success) {
            console.log(chalk.green("GPT response:"));
            try {
                const json = JSON.parse(complete.data);
                console.log(JSON.stringify(json, undefined, 2));
            } catch {
                console.log(complete.data);
            }
        } else {
            console.log("GPT error:");
            console.log(complete.message);
        }
    }
}
