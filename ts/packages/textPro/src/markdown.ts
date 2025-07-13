// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as md from "marked";

export function loadMarkdown(text: string): md.TokensList {
    return md.lexer(text);
}
