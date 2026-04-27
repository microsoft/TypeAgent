// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// CSS imports are handled via esbuild's `text` loader and produce the
// stylesheet contents as a string.
declare module "*.css" {
    const css: string;
    export default css;
}
