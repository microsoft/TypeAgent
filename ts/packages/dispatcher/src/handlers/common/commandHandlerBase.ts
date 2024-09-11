// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Result } from "typechat";
import { CommandHandlerContext } from "./commandHandlerContext.js";
import chalk from "chalk";
import { DispatcherCommandHandler } from "./commandHandler.js";
import { RequestIO } from "./interactiveIO.js";
import { StopWatch } from "common-utils";

/**
 * (Optional) Base class fro Command Handlers, with helper methods
 */

export abstract class CommandHandlerBase implements DispatcherCommandHandler {
    protected readonly _stopWatch: StopWatch;

    constructor(description: string, help?: string) {
        this._stopWatch = new StopWatch();
        this.description = description;
        if (help) {
            this.help = help;
        }
    }

    public readonly description: string;
    public readonly help?: string;

    run(request: string, context: CommandHandlerContext): Promise<void> {
        throw new Error("Method not implemented.");
    }

    public get stopWatch(): StopWatch {
        return this._stopWatch;
    }

    /**
     * Print a result to console
     * @param result result to string
     */
    protected printResult<T>(
        result: Result<T>,
        resultName?: string,
        includeTiming: boolean = true,
    ): void {
        if (resultName && resultName.length > 0) {
            this.printHeading(resultName);
        }
        const resultString = this.resultToString(result) + "\n";
        if (includeTiming) {
            console.log(
                chalk.greenBright(`[${this._stopWatch.elapsedString()}]`),
            );
            console.log(resultString);
        } else {
            console.log(resultString);
        }
    }

    /**
     * A result can be success or error. Returns string appropriately
     * @param result
     * @returns
     */
    protected resultToString<T>(result: Result<T>): string {
        return result.success
            ? JSON.stringify(result.data, null, 2)
            : result.message;
    }

    protected printHeading(heading: string): void {
        console.log(chalk.bgYellow(chalk.black(`\n### ${heading} ###`)));
    }

    protected async confirm(
        value: string,
        requestIO: RequestIO,
    ): Promise<boolean> {
        this.printHeading("Confirm");

        if (value && value.length) {
            console.log(chalk.cyan(value));
            console.log("\n");
        }
        if (!(await requestIO.askYesNo("Accept? "))) {
            console.log(chalk.red("Rejected"));
            return false;
        }
        return true;
    }

    protected logStatus(text: string): void {
        console.log(chalk.gray(text));
    }

    protected stringify(value: any): string {
        return JSON.stringify(value, null, 2);
    }
}
