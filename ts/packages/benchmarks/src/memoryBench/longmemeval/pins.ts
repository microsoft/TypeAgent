// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const publicPins = Object.freeze({
    longMemEval: {
        repository: "https://github.com/xiaowu0162/LongMemEval",
        revision: "9e0b455f4ef0e2ab8f2e582289761153549043fc",
    },
});

export const datasetPins = {
    "s-cleaned": {
        filename: "longmemeval_s_cleaned.json",
        sha256: "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442",
    },
    oracle: {
        filename: "longmemeval_oracle.json",
        sha256: "821a2034d219ab45846873dd14c14f12cfe7776e73527a483f9dac095d38620c",
    },
} as const;

export const datasetRepository =
    "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned";
export const datasetRevision = "98d7416c24c778c2fee6e6f3006e7a073259d48f";

export type LongMemEvalVariant = keyof typeof datasetPins;
