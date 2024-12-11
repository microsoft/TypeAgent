// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ParamSpec } from "action-schema";

export type PropertyParser = {
    readonly name: ParamSpec;
    readonly valueType: string;
    readonly regExp: RegExp;
    readonly convertToValue: (str: string) => any;
};
const propertyParsers: PropertyParser[] = [
    {
        name: "number",
        valueType: "number",
        regExp: /-?\d+/y,
        convertToValue: (str: string) => parseInt(str),
    },
    {
        name: "percentage",
        valueType: "number",
        regExp: /-?\d+%/y,
        convertToValue: (str: string) => parseInt(str),
    },
];

const propertyParserMap = new Map(propertyParsers.map((p) => [p.name, p]));

export function getPropertyParser(name: ParamSpec) {
    return propertyParserMap.get(name);
}
