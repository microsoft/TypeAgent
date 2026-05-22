// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import AjvModule from "ajv";

const AjvConstructor = (AjvModule as any).default ?? AjvModule;

export function createAjv() {
    return new AjvConstructor({ strict: false });
}
