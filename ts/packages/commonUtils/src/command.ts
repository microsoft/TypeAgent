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

export type TemplateParamPrimitive = {
    type: "string" | "number" | "boolean";
    value?: string | number | boolean;
};

export type TemplateParamStringUnion = {
    type: "string-union";
    typeEnum: string[];
    value?: string;
};

export type TemplateParamScalar =
    | TemplateParamPrimitive
    | TemplateParamStringUnion;

export type TemplateParamArray = {
    type: "array";
    elementType: TemplateParamField;
    elements?: TemplateParamField[];
};

export type TemplateParamObject = {
    type: "object";
    fields: {
        [key: string]: TemplateParamFieldOpt;
    };
};

export type TemplateParamFieldOpt = {
    optional?: boolean;
    field: TemplateParamField;
};

export type TemplateParamField =
    | TemplateParamScalar
    | TemplateParamObject
    | TemplateParamArray;

export type ActionTemplate = {
    agent: string;
    name: string;
    parameterStructure: TemplateParamObject;
    prefaceSingle?: string;
    prefaceMultiple?: string;
};

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
