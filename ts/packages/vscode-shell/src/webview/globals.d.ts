// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// CSS imports are handled via esbuild's `text` loader and produce the
// stylesheet contents as a string.
declare module "*.css" {
    const css: string;
    export default css;
}

// chat-ui exports its stylesheet via a non-`.css` subpath; declare it
// explicitly so TypeScript accepts the bare-specifier import.
declare module "chat-ui/styles" {
    const css: string;
    export default css;
}

// completion-ui exports its dropdown menu styles via a `.css` subpath
// of the package; declare so esbuild's text loader resolves it.
declare module "@typeagent/completion-ui/styles.css" {
    const css: string;
    export default css;
}
