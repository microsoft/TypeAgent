// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function escapeMarkdownText(text: string): string {
    text = text.replace(/([`*_{}\[\]()#+-.!|])/g, "\\$1");
    return text;
}
