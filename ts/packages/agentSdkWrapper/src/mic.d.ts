// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

declare module "mic" {
    import { Readable } from "stream";
    import { EventEmitter } from "events";

    interface MicOptions {
        rate?: string;
        channels?: string;
        debug?: boolean;
        exitOnSilence?: number;
        fileType?: string;
        device?: string;
    }

    interface MicInstance extends EventEmitter {
        start(): void;
        stop(): void;
        pause(): void;
        resume(): void;
        getAudioStream(): Readable;
    }

    function Mic(options?: MicOptions): MicInstance;

    export = Mic;
}
