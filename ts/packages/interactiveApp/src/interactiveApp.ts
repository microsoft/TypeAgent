// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import { InteractiveIo, createInteractiveIO } from "./InteractiveIo";
import { exit } from "process";

/**
 * Handler of command line inputs
 */
export type InputHandler = (
    request: string,
    io: InteractiveIo,
) => Promise<void>;

/**
 * Settings for an interactive app
 */
export type InteractiveAppSettings = {
    /**
     * Callback called when apps starts
     * @param io
     * @returns
     */
    onStart?: (io: InteractiveIo) => void;
    /**
     * Invoked when input is available
     */
    inputHandler: InputHandler;
    /**
     * Invoked when an interactive command is issued
     */
    commandHandler?: InputHandler;
    /**
     * Standard command line prompt
     */
    prompt?: string;
    /**
     * Commands are detected by looking for this prefix. Default is '@'
     */
    commandPrefix?: string;
    /**
     * Commands that cause the app to exit. Default is 'exit' and 'quit'
     */
    stopCommands?: string[];
    /**
     * Stop on exception
     */
    stopOnError?: boolean;
    /**
     * Can user do multi-line input entry? Useful for chats and other interactive scenarios
     */
    multiline?: boolean;
    /**
     * How user terminates multiline input. Default is @@
     */
    multilineTerminator?: string;
    /**
     * Handler table for this app
     */
    handlers?: Record<string, CommandHandler>;
};

/**
 * Run batch file app
 * @param settings app settings
 */
export async function runBatch(
    settings: InteractiveAppSettings,
    batchFilePath: string,
) {
    const app = new InteractiveApp(createInteractiveIO(), settings);
    await app.runBatch(batchFilePath);
}

/**
 * Run an interactive Console app
 * @param settings app settings
 */
export async function runConsole(
    settings: InteractiveAppSettings,
): Promise<void> {
    const args = process.argv;
    if (getArg(args, 2, "") === "batch") {
        const batchFilePath = getArg(args, 3, "");
        if (!batchFilePath) {
            console.log("No batch file provided for batch mode");
            return;
        }
        await runBatch(settings, batchFilePath);
        exit();
    } else {
        const app = new InteractiveApp(createInteractiveIO(), settings);
        await app.runApp();
    }
}

/**
 * An Interactive App. You can inherit from this, but typically you just call RunConsole
 */
class InteractiveApp {
    private _settings: InteractiveAppSettings;
    private _stdio: InteractiveIo;

    constructor(stdio: InteractiveIo, settings: InteractiveAppSettings) {
        this._stdio = stdio;
        this._settings = this.initSettings(settings);
    }

    public get stdio(): InteractiveIo {
        return this._stdio;
    }

    public async runApp(): Promise<void> {
        const commandLine = this.getCommandLine();
        if (commandLine && commandLine.length > 0) {
            await this.processInput(commandLine);
            exit();
            return;
        }

        this.writeWelcome();
        if (this._settings.onStart) {
            this._settings.onStart(this._stdio);
        }

        const lineReader = this._stdio.readline;
        lineReader.setPrompt(this._settings.prompt!);
        lineReader.prompt();

        const lines: string[] = [];
        lineReader
            .on("line", async (line) => {
                if (this._settings.multiline) {
                    if (!this.isEOLMulti(line)) {
                        lines.push(line);
                        return;
                    }

                    line = lines.join("\n");
                    lines.splice(0);
                }
                if (await this.processInput(line)) {
                    lineReader.prompt();
                } else {
                    lineReader.close();
                }
            })
            .on("close", () => {
                lineReader.close();
            });
    }

    public async runBatch(
        batchFilePath: string,
        echoOn: boolean = true,
        commentPrefix: string = "#",
    ): Promise<void> {
        if (this._settings.onStart) {
            this._settings.onStart(this._stdio);
        }

        const lines = (
            await fs.promises.readFile(batchFilePath, "utf-8")
        ).split(/\r?\n/);
        for (const line of lines) {
            if (line && !line.startsWith(commentPrefix)) {
                if (echoOn) {
                    this._stdio.writer.writeLine(line);
                }
                if (!(await this.processInput(line))) {
                    break;
                }
                this.stdio.writer.writeLine();
            }
        }
    }

    private async processInput(line: string): Promise<boolean> {
        line = line.trim();
        if (line.length == 0) {
            return true;
        }

        try {
            const cmdLine = this.getCommand(line);
            if (cmdLine) {
                if (this._settings.stopCommands!.includes(cmdLine)) {
                    // Done.
                    return false;
                }
                if (this._settings.commandHandler) {
                    await this._settings.commandHandler(cmdLine, this._stdio);
                } else if (this._settings.handlers) {
                    await dispatchCommand(
                        cmdLine,
                        this._settings.handlers,
                        this._stdio,
                        true,
                        ["--?"],
                    );
                }
            } else {
                await this._settings.inputHandler(line, this._stdio);
            }
        } catch (error) {
            this._stdio.writer.writeLine(
                `${error instanceof Error ? error.message : error}`,
            );
            if (this._settings.stopOnError) {
                return false;
            }
        }
        return true;
    }

    private getCommand(line: string): string | undefined {
        if (line.startsWith(this._settings.commandPrefix!)) {
            const cmd = line
                .substring(this._settings.commandPrefix!.length)
                .trim();
            return cmd.length > 0 ? cmd : undefined;
        }
        return undefined;
    }

    private isEOLMulti(line: string): boolean {
        return line.startsWith(this._settings.multilineTerminator!);
    }

    private initSettings(
        settings: InteractiveAppSettings,
    ): InteractiveAppSettings {
        settings.prompt ??= "🤖> ";
        settings.commandPrefix ??= "@";
        settings.stopCommands ??= ["quit", "exit"];
        settings.multiline ??= false;
        settings.multilineTerminator ??= "@@";

        return settings;
    }

    private getCommandLine(): string | undefined {
        const args = process.argv;
        if (args.length > 2) {
            let line = "";
            for (let i = 2; i < args.length; ++i) {
                line += i > 2 ? ` "${args[i]}"` : args[i];
            }
            return line;
        }
        return undefined;
    }

    protected writeLine(line: string): void {
        this._stdio.stdout.write(line);
        this._stdio.stdout.write("\n");
    }

    private writeWelcome() {
        if (this._settings.stopCommands) {
            this._stdio.stdout.write(
                `Type ${this._settings.stopCommands.join(" OR ")} to exit\n`,
            );
        }
        if (this._settings.commandPrefix) {
            this._stdio.stdout.write(
                `To run a command, prefix its name with: ${this._settings.commandPrefix}\n`,
            );
        }
        if (this._settings.handlers) {
            if (this._settings.handlers.help !== undefined) {
                this.stdio.stdout.write(
                    "Type @help to get help on available commands.\n",
                );
            }
        }
    }
}

/**
 * Parse a command line string into an argument array. Supports quoted arguments
 * @param cmdLine command line to parse
 * @returns parsed arguments
 */
export function parseCommandLine(cmdLine: string): string[] | null {
    const regex = /("[^"]+"|[^"\s]+)/g;
    let args: string[] | null = cmdLine.match(regex);
    if (args) {
        args = args.map((a) => a.replaceAll('"', ""));
    }
    return args;
}

export type ArgType = "string" | "number" | "integer" | "boolean" | "path";

export interface ArgDef {
    type?: ArgType | undefined;
    description?: string | undefined;
    defaultValue?: any | undefined;
}

/**
 * Named command line arguments
 */
export interface NamedArgs extends Record<string, any> {
    /**
     * Returns a value, converting it to type if necessary
     * @param key
     * @param type
     */
    value(key: string, type: ArgType, required?: boolean): any | undefined;
    number(key: string, required?: boolean): number | undefined;
    integer(key: string, required?: boolean): number | undefined;
    boolean(key: string, required?: boolean): number | undefined;
    path(key: string, required?: boolean): string | undefined;
    bind(defs: Record<string, ArgDef>, required: boolean): void;
    shift(key: string): any | undefined;
}

export function createNamedArgs(): NamedArgs {
    const namedArgs: NamedArgs = {
        value,
        number: (key, required) => value(key, "number", required),
        integer: (key, required) => value(key, "integer", required),
        boolean: (key, required) => value(key, "boolean", required),
        path: (key, required) => value(key, "path", required),
        bind,
        shift,
    };
    return namedArgs;

    function value(
        key: string,
        type: ArgType,
        required?: boolean,
    ): any | undefined {
        let value = namedArgs[key];
        if (value === undefined) {
            if (required) {
                throw Error(
                    `A value for required arg '${key}' was not supplied`,
                );
            }
            return value;
        }
        return convert(key, value, type ?? "string");
    }

    function bind(argDefs: Record<string, ArgDef>, required: boolean): void {
        for (const key in argDefs) {
            let def = argDefs[key];
            let type = def.type ?? "string";
            let arg = value(key, type, required); // This will do type conversions
            if (arg === undefined) {
                if (def.defaultValue) {
                    arg = def.defaultValue;
                } else if (required) {
                    throw Error(`${key} requires a ${type} value`);
                }
            }
            namedArgs[key] = arg;
        }
    }

    function convert(key: string, value: any, type: ArgType): any {
        try {
            switch (type) {
                default:
                    return typeof value === "string" ? value : String(value);
                case "number":
                    return typeof value === "number" ? value : Number(value);
                case "integer":
                    value = typeof value === "number" ? value : Number(value);
                    if (!Number.isInteger(value)) {
                        throw Error(`integer expected`);
                    }
                    return value;
                case "boolean":
                    return typeof value === "boolean"
                        ? value
                        : value.toLowerCase() === "true";
                case "path":
                    value = typeof value === "string" ? value : String(value);
                    checkPath(value);
                    return value;
            }
        } catch (e) {
            throw Error(
                `Argument ${key}: ${e instanceof Error ? e.message : e}`,
            );
        }
    }

    function shift(key: string): any | undefined {
        const value = namedArgs[key];
        if (value) {
            delete namedArgs[key];
        }
        return value;
    }

    function checkPath(value: any): string {
        if (typeof value !== "string" || !fs.existsSync(value)) {
            throw Error(`Path ${value} does not exist`);
        }
        return value;
    }
}

/**
 * Parse named args, like commandX --option1 A --option2 B
 * @param args
 * @param namePrefix prefix for argNames. Default is --
 * @param shortNamePrefix prefix for short version of argNames. Default is -
 * @returns An JSON object, where property name is the key, and value is the argument value
 */
export function parseNamedArguments(
    args: string | string[],
    argDefs?: CommandMetadata,
    namePrefix: string = "--",
    shortNamePrefix: string = "-",
): NamedArgs {
    const rawArgs = typeof args === "string" ? parseCommandLine(args) : args;
    let namedArgs = createNamedArgs();
    if (!rawArgs) {
        return namedArgs;
    }
    // First, collect all name, value pairs on the command line
    let name: string | undefined;
    for (const rawArg of rawArgs) {
        var value = rawArg.trim();
        //
        // Names of arguments have a prefix
        //
        if (value.length > namePrefix.length && value.startsWith(namePrefix)) {
            // We have a new name
            name = value.substring(namePrefix.length); // Save the name, awaiting its value
            namedArgs[name] = "";
        } else if (
            value.length === shortNamePrefix.length + 1 &&
            value.startsWith(shortNamePrefix)
        ) {
            name = value.substring(shortNamePrefix.length);
            namedArgs[name] = "";
        } else if (name) {
            // A previous name on the stack...assign value to it
            namedArgs[name] = value;
            name = undefined;
        } else {
            // We will treat the value as a raw named arg
            namedArgs[value] = "";
        }
    }
    // If argument metadata was provided, bind the arguments...
    if (argDefs) {
        if (argDefs.args) {
            namedArgs.bind(argDefs.args, true);
        }
        if (argDefs.options) {
            namedArgs.bind(argDefs.options, false);
        }
    }
    return namedArgs;
}

export type CommandMetadata = {
    description?: string;
    args?: Record<string, ArgDef>;
    options?: Record<string, ArgDef>;
};

export type CommandResult = string | undefined | void;

/**
 * Command handler
 */
export interface CommandHandler {
    (args: string[], io: InteractiveIo): Promise<CommandResult>;
    metadata?: string | CommandMetadata;
    usage?: string | { (io: InteractiveIo): void };
}

export function createCommand(
    fn: (args: string[], io: InteractiveIo) => Promise<CommandResult>,
    metadata?: string | CommandMetadata,
    usage?: string,
): CommandHandler {
    const handler: CommandHandler = fn;
    if (metadata) {
        handler.metadata = metadata;
    }
    if (usage) {
        handler.usage = usage;
    }
    return handler;
}

/**
 * Dispatches a commandLine.
 * Splits the command line into command and arguments
 * @param cmdLine command line string
 * @param handlers a table of handlers
 * @param io how handler can perform IO
 * @param caseSensitive If command names are case sensitive
 * @param helpFlags if command args terminate in one of these flags, trigger help. By default, "--?"
 */
export async function dispatchCommand(
    cmdLine: string,
    handlers: Record<string, CommandHandler>,
    io: InteractiveIo,
    caseSensitive: boolean = false,
    helpFlags?: string[],
): Promise<void> {
    let args = parseCommandLine(cmdLine);
    if (args) {
        let commandName = getArg(args, 0);
        if (commandName === undefined) {
            return;
        }
        commandName = caseSensitive ? commandName : commandName.toLowerCase();
        const handler = handlers[commandName];
        if (handler) {
            // Check if the user asked for help
            const inlineHelpCommand = getInlineHelpCommand(
                args,
                caseSensitive,
                helpFlags,
            );
            if (inlineHelpCommand) {
                const helpHandler = handlers[inlineHelpCommand];
                if (helpHandler) {
                    await helpHandler(args, io);
                    return;
                }
            }
            // Call command
            args.shift();
            const result = await handler(args, io);
            if (result) {
                io.stdout.write(result + "\n");
            }
        } else {
            io.stdout.write(`${commandName} not found.\n`);
        }
    }

    function getInlineHelpCommand(
        args: string[],
        caseSensitive: boolean,
        helpCommandNames?: string[],
    ): string | undefined {
        // Check if the user asked for help
        if (helpCommandNames && args.length > 1) {
            let inlineHelpArg = getArg(args, args.length - 1, "");
            if (inlineHelpArg && inlineHelpArg.length > 0) {
                inlineHelpArg = caseSensitive
                    ? inlineHelpArg
                    : inlineHelpArg.toLowerCase();
                return helpCommandNames.find((h) => h === inlineHelpArg);
            }
        }
        return undefined;
    }
}

export function displayHelp(
    args: string[],
    handlers: Record<string, CommandHandler>,
    io: InteractiveIo,
) {
    if (args.length === 0) {
        displayCommands(handlers, io);
        return;
    }
    const commandName = args[0];
    const handler = handlers[commandName];
    if (!handler) {
        if (!searchCommands(args, handlers, io)) {
            io.writer.writeLine(`${args[0]} not found.\n`);
            displayCommands(handlers, io);
        }
        return;
    }

    const description = getDescription(handler);
    if (description) {
        io.writer.writeLine(description);
        io.writer.writeLine();
    }

    if (handler.usage) {
        if (typeof handler.usage === "string") {
            io.writer.writeLine(handler.usage);
        } else {
            handler.usage(io);
        }
    } else {
        displayMetadata(commandName, handler, io);
    }
}

export function searchCommands(
    args: string[],
    handlers: Record<string, CommandHandler>,
    io: InteractiveIo,
): boolean {
    let name = getArg(args, 0);
    if (!name) {
        return false;
    }
    name = name.toLowerCase();
    const prefixMatch = name.endsWith("*");
    if (prefixMatch) {
        name = name.slice(0, name.length - 1);
    }
    const suffixMatch = name.startsWith("*");
    if (suffixMatch) {
        name = name.slice(1);
    }
    let matches: Record<string, CommandHandler> = {};
    let matchCount = 0;
    for (const key in handlers) {
        const handlerName = key.toLowerCase();
        if (
            name === handlerName ||
            (prefixMatch && handlerName.startsWith(name)) ||
            (suffixMatch && handlerName.endsWith(name))
        ) {
            matches[key] = handlers[key];
            ++matchCount;
        }
    }
    if (matchCount > 0) {
        displayCommands(matches, io);
    }
    return matchCount > 0;
}

export async function commandHandler(
    handlers: Record<string, CommandHandler>,
    line: string,
    io: InteractiveIo,
): Promise<void> {
    return dispatchCommand(line, handlers, io, true, ["--?"]);
}

export function addStandardHandlers(
    handlers: Record<string, CommandHandler>,
): void {
    handlers.help = help;
    handlers.help.metadata = "Display help";
    handlers["--?"] = help;
    handlers.commands = commands;
    handlers.commands.metadata = "List all commands";
    handlers.cls = cls;
    handlers.cls.metadata = "Clear the screen";

    async function help(args: string[], io: InteractiveIo): Promise<void> {
        displayHelp(args, handlers, io);
    }

    async function commands(args: string[], io: InteractiveIo): Promise<void> {
        displayCommands(handlers, io);
    }

    async function cls(args: string[], io: InteractiveIo): Promise<void> {
        console.clear();
    }
}

function getDescription(handler: CommandHandler): string | undefined {
    return handler.metadata
        ? typeof handler.metadata === "string"
            ? handler.metadata
            : handler.metadata.description
        : undefined;
}

export function displayCommands(
    handlers: Record<string, CommandHandler>,
    io: InteractiveIo,
): void {
    const indent = "  ";
    io.writer.writeLine("COMMANDS");
    io.writer.writeRecord(
        handlers,
        true,
        (v) => getDescription(v) ?? "",
        indent,
    );
}

function displayMetadata(
    commandName: string,
    handler: CommandHandler,
    io: InteractiveIo,
): void {
    if (
        handler.metadata === undefined ||
        typeof handler.metadata === "string"
    ) {
        return;
    }

    displayUsage(commandName, handler.metadata, io);
    const indent = "  ";
    if (handler.metadata.args) {
        io.writer.writeLine();
        io.writer.writeLine("ARGUMENTS");
        displayArgs(handler.metadata.args, io, indent);
    }
    if (handler.metadata.options) {
        io.writer.writeLine();
        io.writer.writeLine("OPTIONS");
        displayArgs(handler.metadata.options, io, indent);
    }
}

function displayUsage(
    commandName: string,
    metadata: CommandMetadata,
    io: InteractiveIo,
): void {
    // commandName --arg1 <value> --arg2 <value> [OPTIONS]
    const args: string[] = [];
    args.push(commandName);
    if (metadata.args) {
        for (const k in metadata.args) {
            const argDef = metadata.args[k];
            args.push(`--${k} <${argDef.type ?? "string"}>`);
        }
    }
    if (metadata.options) {
        args.push("[OPTIONS]");
    }
    io.writer.writeLine("USAGE");
    io.writer.writeList(args, { type: "plain" });
}

function displayArgs(
    args: Record<string, ArgDef>,
    io: InteractiveIo,
    indent?: string,
): void {
    io.writer.writeRecord(
        args,
        true,
        (v) => {
            let text = v.description ?? "";
            if (v.defaultValue !== undefined) {
                return [text, `(default): ${v.defaultValue}`];
            }
            return text;
        },
        indent,
    );
}

/**
 * Return the argument at the given position.
 * If no argument available, return the default.
 * If no default available, throw
 * @param args
 * @param position
 * @param defaultValue
 * @returns
 */
export function getArg(
    args: string[] | undefined | null,
    position: number,
    defaultValue?: string,
): string {
    let value;
    if (args && position < args.length) {
        value = args[position];
    }
    value ??= defaultValue;
    if (value === undefined) {
        throw new Error(`No argument at position ${position}`);
    }
    return value;
}

/**
 * Return the number argument at the given position
 * @param args
 * @param position
 * @param defaultValue
 */
export function getNumberArg(
    args: string[] | undefined | null,
    position: number,
    defaultValue?: number,
): number {
    let value;
    if (args && position < args.length) {
        value = args[position] ?? defaultValue;
    }
    if (!value) {
        throw new Error(`No argument at position ${position}`);
    }
    return Number(value);
}

export function getBooleanArg(
    args: string[] | undefined | null,
    position: number,
    defaultValue?: boolean,
): boolean {
    let value;
    if (args && position < args.length) {
        value = args[position] ?? defaultValue;
    }
    if (!value) {
        throw new Error(`No argument at position ${position}`);
    }
    return typeof value === "boolean" ? value : value.toLowerCase() === "true";
}
