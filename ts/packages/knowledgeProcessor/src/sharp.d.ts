// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

declare module "sharp" {
    export interface Metadata {
        width?: number;
        height?: number;
        [key: string]: unknown;
    }

    export interface Sharp {
        metadata(): Promise<Metadata>;
        resize(width?: number, height?: number): Sharp;
        toBuffer(): Promise<Buffer>;
    }

    export interface SharpOptions {
        failOn?: "none" | "truncated" | "error" | "warning";
    }

    function sharp(input?: string | Buffer, options?: SharpOptions): Sharp;

    namespace sharp {
        export { Metadata };
    }

    export default sharp;
}
