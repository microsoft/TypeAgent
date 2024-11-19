// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { openai, getChatModelNames } from "aiclient";
import fs from "node:fs";
import chalk from "chalk";

const modelNames = await getChatModelNames();
export default class Prompt extends Command {
    static description = "Send a prompt to GPT";
    static args = {
        request: Args.string({
            description: "Request for GPT to complete",
            required: true,
        }),
    };
    static flags = {
        model: Flags.string({
            description: "Model to use",
            options: modelNames,
        }),
        stream: Flags.boolean({
            description: "Whether to stream the result",
        }),
        json: Flags.boolean({
            description: "Output JSON response",
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Prompt);
        const model = openai.createChatModel(
            flags.model,
            flags.json
                ? {
                      response_format: { type: "json_object" },
                  }
                : undefined,
            undefined,
            ["cli"],
        );
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
        console.log();
        let responseText = "";
        let time = 0;
        try {
            if (flags.stream) {
                console.log(chalk.green("Streaming GPT response:"));
                let number_chunks = 0;
                const start = performance.now();
                let first = start;
                const result = await model.completeStream(request);
                if (!result.success) {
                    throw new Error(result.message);
                }
                for await (const chunk of result.data) {
                    if (first === start) {
                        first = performance.now();
                    }
                    process.stdout.write(chalk.gray(chunk));
                    responseText += chunk;
                    number_chunks++;
                }
                const end = performance.now();
                console.log();
                console.log(
                    `${number_chunks} chunks streamed in ${end - start}ms (first response in ${first - start}ms)`,
                );
                console.log();
                time = end - start;
            } else {
                const start = performance.now();
                const complete = await model.complete(request);
                const end = performance.now();
                if (complete.success) {
                    responseText = complete.data;
                    if (!flags.json) {
                        console.log(
                            chalk.green(
                                `Full GPT response: (${end - start}ms)`,
                            ),
                        );
                        console.log(responseText);
                    }
                    time = end - start;
                } else {
                    throw new Error(complete.message);
                }
            }
        } catch (e: any) {
            console.log("GPT error:");
            console.log(e.message);
            return;
        }

        if (flags.json) {
            try {
                const json = JSON.parse(responseText);
                console.log(chalk.green(`GPT JSON response: (${time}ms)`));
                console.log(JSON.stringify(json, undefined, 2));
            } catch {
                console.log(chalk.red("Failed to parse JSON response:"));
                if (!flags.stream) {
                    console.log(responseText);
                }
            }
        }
    }
}
