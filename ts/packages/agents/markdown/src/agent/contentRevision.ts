// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Compute a stable revision hash for a Markdown document. Both the agent and
// the view service compare revisions to detect that the browser edited the
// document between the agent's read (getDocumentContent) and its apply
// (applyLLMOperations). Hex-encoded SHA-256 is opaque, collision-resistant
// for this use, and produces short strings suitable for logging.

import { createHash } from "node:crypto";

export function computeContentRevision(content: string): string {
    return createHash("sha256").update(content, "utf8").digest("hex");
}
