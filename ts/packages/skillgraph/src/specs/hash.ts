// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";

/** First 8 hex chars of sha256; short content ids for specs and versions. */
export function sha8(s: string | Buffer): string {
    return createHash("sha256").update(s).digest("hex").slice(0, 8);
}
