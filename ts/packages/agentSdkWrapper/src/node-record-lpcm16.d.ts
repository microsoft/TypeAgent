// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

declare module "node-record-lpcm16" {
    import { Readable } from "stream";

    interface RecordingOptions {
        sampleRate?: number;
        channels?: number;
        audioType?: string;
        silence?: string;
        threshold?: number;
        recorder?: string;
        device?: string | null;
    }

    interface Recording {
        stream(): Readable;
        stop(): void;
        pause(): void;
        resume(): void;
    }

    function record(options?: RecordingOptions): Recording;

    export = { record };
}
