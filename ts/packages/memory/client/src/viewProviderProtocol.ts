// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assertViewProviderJson } from "@typeagent/memory-service/view-provider-validation";
import { z } from "zod";

export const viewKindSchema = z.enum([
    "troubleshootingGuide",
    "projectBrief",
    "timeline",
    "wiki",
    "schemaView",
    "extension",
]);
export const viewProviderIdentitySchema = z.strictObject({
    id: z.string().regex(/^[a-z][a-z0-9.-]{0,127}$/),
    version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+:/-]{0,127}$/),
    implementationSha256: z.string().regex(/^[a-f0-9]{64}$/),
    schemaSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const viewProviderJsonSchema = z
    .unknown()
    .superRefine((value, context) => {
        try {
            assertViewProviderJson(value);
        } catch (error) {
            context.addIssue({
                code: "custom",
                message:
                    error instanceof Error
                        ? error.message
                        : "Invalid provider JSON",
            });
        }
    })
    .pipe(z.json());
