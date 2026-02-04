// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

declare module "marked-terminal" {
    import { MarkedExtension } from "marked";

    interface MarkedTerminalOptions {
        // Colors and styles for different markdown elements
        code?: (text: string) => string;
        blockquote?: (text: string) => string;
        heading?: (text: string) => string;
        firstHeading?: (text: string) => string;
        strong?: (text: string) => string;
        em?: (text: string) => string;
        codespan?: (text: string) => string;
        del?: (text: string) => string;
        link?: (text: string) => string;
        href?: (text: string) => string;
        listitem?: (text: string) => string;
        table?: (text: string) => string;
        tableHeader?: (text: string) => string;

        // Other options
        width?: number;
        reflowText?: boolean;
        showSectionPrefix?: boolean;
        unescape?: boolean;
        emoji?: boolean;
        tab?: number;
    }

    export function markedTerminal(
        options?: MarkedTerminalOptions,
    ): MarkedExtension;
}
