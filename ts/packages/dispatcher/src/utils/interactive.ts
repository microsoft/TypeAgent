// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import readline from "readline/promises";
import chalk from "chalk";

export const enum unicodeChar {
    robotFace = "🤖",
    constructionSign = "🚧",
    floppyDisk = "💾",
}

const promptColor = chalk.cyanBright;

async function question(
    prompt: string,
    inputs: string[] | readline.Interface,
): Promise<string> {
    if (Array.isArray(inputs)) {
        while (true) {
            let input = inputs.shift();
            if (input === undefined) {
                return "exit";
            }
            input = input.trim();
            if (input.length === 0) {
                continue;
            }
            if (!input.startsWith("#")) {
                console.log(`${promptColor(prompt)}${input}`);
                return input;
            }
            // Handle comments in files
            console.log(chalk.green(input));
        }
    }
    inputs.resume();
    const input = await inputs.question(promptColor(prompt));
    inputs.pause();
    return input.trim();
}

/**
 * A request processor for interactive input or input from a text file. If an input file name is specified,
 * the callback function is invoked for each line in file. Otherwise, the callback function is invoked for
 * each line of interactive input until the user types "quit" or "exit".
 * @param interactivePrompt Prompt to present to user.
 * @param inputFileName Input text file name, if any.
 * @param processRequest Async callback function that is invoked for each interactive input or each line in text file.
 */
export async function processRequests<T>(
    interactivePrompt: string | ((context: T) => string),
    inputs: string[] | readline.Interface,
    processRequest: (request: string, context: T) => Promise<any>,
    context: T,
) {
    while (true) {
        const prompt =
            typeof interactivePrompt === "function"
                ? interactivePrompt(context)
                : interactivePrompt;
        const request = await question(prompt, inputs);
        if (request.length) {
            if (
                request.toLowerCase() === "quit" ||
                request.toLowerCase() === "exit"
            ) {
                (context as any)?.session.save(); // save session state
                break;
            } else {
                try {
                    await processRequest(request, context);
                    (context as any)?.session.save(); // save session state
                } catch (error) {
                    console.log("### ERROR:");
                    console.log(error);
                }
            }
        }
        console.log("");
    }
}

/**
 * Ask the user a y/n question.
 * @param questionText
 * @param stdio
 * @returns true if user says y
 */
export async function askYesNo(
    questionText: string,
    stdio?: readline.Interface,
    defaultValue: boolean = false,
): Promise<boolean> {
    if (stdio) {
        const input = await question(`${questionText} (y/n)`, stdio);
        return input.toLowerCase() === "y";
    }
    return defaultValue;
}
