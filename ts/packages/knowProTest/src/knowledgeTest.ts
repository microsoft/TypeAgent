// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { conversation as kpLib } from "knowledge-processor";
import { compareArray, compareObject, compareStringArray } from "./common.js";
import { ComparisonResult } from "./types.js";

export function compareActions(
    x: kpLib.Action[],
    y: kpLib.Action[],
    label: string,
): ComparisonResult {
    return compareArray(x, y, label, compareAction);
}

export function compareAction(
    x: kpLib.Action,
    y: kpLib.Action,
): ComparisonResult {
    if (x.subjectEntityName !== y.subjectEntityName) {
        return "subjectEntityName";
    }
    if (y.objectEntityName !== y.objectEntityName) {
        return "objectEntityName";
    }
    if (x.indirectObjectEntityName !== y.indirectObjectEntityName) {
        return "indirectObjectEntityName";
    }
    let error = compareStringArray(x.verbs, y.verbs, "verbs");
    if (error !== undefined) {
        return error;
    }
    error = compareObject(x.params, y.params, "params");
    if (error !== undefined) {
        return error;
    }
    return undefined;
}
