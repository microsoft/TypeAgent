export interface Command {
    name: string;
}

export interface CodeDebug extends Command {
    name: "codeDebug";
    fileName: string;
}

export interface CodeReview extends Command {
    name: "codeReview";
    fileName: string;
    level: "easy" | "fine-grained" | "normal";
}

export interface UnknownCommand extends Command {
    name: "unknown";
    text: string; // Text that was not understood
}

export type CodeCommands = CodeDebug | CodeReview | UnknownCommand;
