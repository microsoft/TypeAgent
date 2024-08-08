// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type Command = {
    name: string;
    args?: string[];
};

// TODO: remove duplicate types due to package circular dependencies (shell/electronTypes.ts is other source)
export type SearchMenuItem = {
    matchText: string;
    emojiChar?: string;
    groupName?: string;
};

export type TemplateParamValue = {
    type: "string" | "number" | "boolean" | "unknown";
};

export type TemplateParamStringUnion = {
    type: "string-union";
    values: string[];
};

export type TemplateParamArray = {
    type: "array";
    elementType: TemplateParamField;
};

export type TemplateParamObject = {
    type: "object";
    fields: {
        [key: string]: TemplateParamFieldOpt;
    };
};

export type TemplateParamFieldOpt = {
    optional?: boolean;
    fieldType: TemplateParamField;
};

export type TemplateParamField =
    | TemplateParamValue
    | TemplateParamStringUnion
    | TemplateParamObject
    | TemplateParamArray;

export interface ITemplateAction {
    actionName: string;
    parameters: TemplateParamObject;
}

// end duplicate type section

export function parseCommandLine(line: string): Command | undefined {
    if (line.length == 0) {
        return undefined;
    }

    const args = line.split(/\s+/);
    if (args.length == 0) {
        return undefined;
    }

    const cmd: Command = {
        name: args[0],
    };
    args.shift();
    cmd.args = args;
    return cmd;
}
