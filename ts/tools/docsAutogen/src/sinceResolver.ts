// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Git } from "./git.js";
import { readWatermark } from "./watermark.js";

/**
 * How the `--since` ref was determined.
 */
export type SinceResolution =
    | {
          /** User passed `--since <ref>`. */
          readonly source: "explicit";
          readonly sinceRef: string;
          readonly sinceSha: string;
      }
    | {
          /** Resolved via merge-base with `<remote>/<defaultBranch>`. */
          readonly source: "merge-base";
          readonly sinceRef: string;
          readonly sinceSha: string;
          readonly branch: string;
      }
    | {
          /** Resolved via the watermark tag. */
          readonly source: "watermark";
          readonly sinceRef: string;
          readonly sinceSha: string;
      }
    | {
          /** No since-ref could be determined (e.g. first run). */
          readonly source: "none";
          readonly reason: string;
      };

export interface ResolveSinceOptions {
    /** Explicit `--since` value, if any. */
    readonly explicit?: string | undefined;
    /** Remote name to use for merge-base lookups. Defaults to "origin". */
    readonly remote?: string;
    /** Default branch name. Defaults to "main". */
    readonly defaultBranch?: string;
}

/**
 * Resolve the "since" ref for a docs-autogen run, applying the
 * smart-default logic described in
 * `ts/docs/architecture/doc-pipeline/doc-autogen.md`:
 *
 *  1. If `--since <ref>` was passed, use it verbatim.
 *  2. Else, if the current branch differs from the default branch
 *     and `<remote>/<defaultBranch>` exists, use the merge-base
 *     between HEAD and that ref. (PR-scoped manual run.)
 *  3. Else, fall back to the `docs-bot/last-run` watermark tag.
 *  4. Else, return `source: "none"` so callers can decide whether
 *     to no-op or regenerate everything.
 */
export async function resolveSinceRef(
    git: Git,
    options: ResolveSinceOptions = {},
): Promise<SinceResolution> {
    const remote = options.remote ?? "origin";
    const defaultBranch = options.defaultBranch ?? "main";

    if (options.explicit !== undefined && options.explicit !== "") {
        const sha = await git.revParse(options.explicit);
        if (sha === null) {
            throw new Error(`--since ${options.explicit}: ref does not exist`);
        }
        return {
            source: "explicit",
            sinceRef: options.explicit,
            sinceSha: sha,
        };
    }

    const branch = await git.currentBranch();
    if (branch !== null && branch !== defaultBranch) {
        const remoteRef = `${remote}/${defaultBranch}`;
        const remoteSha = await git.revParse(remoteRef);
        if (remoteSha !== null) {
            const base = await git.mergeBase("HEAD", remoteRef);
            if (base !== null) {
                return {
                    source: "merge-base",
                    sinceRef: remoteRef,
                    sinceSha: base,
                    branch,
                };
            }
        }
    }

    const watermark = await readWatermark(git);
    if (watermark !== null) {
        return {
            source: "watermark",
            sinceRef: "docs-bot/last-run",
            sinceSha: watermark,
        };
    }

    return {
        source: "none",
        reason:
            branch === defaultBranch
                ? "On default branch and no watermark tag is present (first run?)"
                : "No merge-base with default branch and no watermark tag is present",
    };
}
