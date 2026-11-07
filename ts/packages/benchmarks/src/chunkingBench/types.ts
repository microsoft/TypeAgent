// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";

const offset = z.number().int().nonnegative();
export const spanSchema = z
    .object({
        documentId: z.string().min(1),
        start: offset,
        end: offset,
    })
    .strict();
export type Span = z.infer<typeof spanSchema>;

export const documentSchema = z
    .object({
        id: z.string().min(1),
        title: z.string().min(1),
        text: z.string().min(1),
        sections: z.array(
            z
                .object({
                    start: offset,
                    end: offset,
                    heading: z.string(),
                })
                .strict(),
        ),
    })
    .strict();
export type Document = z.infer<typeof documentSchema>;

export const datasetSchema = z
    .object({
        version: z.literal("chunking-span-v1"),
        protocol: z.literal("independent-not-article-parity"),
        coordinateSpace: z.literal("utf16-code-point-boundaries"),
        dataset: z.enum(["qasper", "legalbenchrag", "qmsum"]),
        split: z.string().min(1),
        provenance: z
            .array(
                z
                    .object({
                        source: z.string().min(1),
                        sha256: z.string().regex(/^[a-f0-9]{64}$/),
                    })
                    .strict(),
            )
            .min(1),
        annotationPolicy: z.string().min(1),
        documents: z.array(documentSchema).min(1),
        questions: z
            .array(
                z
                    .object({
                        id: z.string().min(1),
                        text: z.string().min(1),
                        groupId: z.string().min(1),
                        gold: z.array(spanSchema).min(1),
                    })
                    .strict(),
            )
            .min(1),
        exclusions: z.array(
            z.object({ id: z.string(), reason: z.string() }).strict(),
        ),
    })
    .strict();
export type Dataset = z.infer<typeof datasetSchema>;
export type Question = Dataset["questions"][number];
export type DatasetName = Dataset["dataset"];
export type Strategy =
    | "fixed"
    | "sentence"
    | "paragraph"
    | "structure"
    | "whole";
export const armSchema = z.enum([
    "bm25",
    "vector",
    "hybrid",
    "ordinary",
    "indexed",
]);
export type Arm = z.infer<typeof armSchema>;

export interface Candidate extends Span {
    id: string;
    score: number;
    header: string;
    locator?: string;
    revisionId?: string;
}

export class MappingError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "MappingError";
    }
}
