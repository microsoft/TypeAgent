// TODO: Copyright

// Schema for CommandMetadata from interactiveApp.ts

export type ArgType = "string" | "number" | "integer" | "boolean" | "path";

export interface ArgDef {
    type?: ArgType | undefined;
    description?: string | undefined;
    defaultValue?: any | undefined;
}

export type CommandMetadata = {
    description?: string;
    args?: Record<string, ArgDef>;
    options?: Record<string, ArgDef>;
};
""