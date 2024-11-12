// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type Profiler = {
    start: (data?: unknown) => void;
    measure: (name: string, start?: boolean, data?: unknown) => Profiler;
    mark: (name: string, data?: unknown) => void;
    stop: (data?: unknown) => void;
};
