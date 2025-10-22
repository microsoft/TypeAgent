// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MatchResult } from "./types.js";

export function sortMatches<T extends MatchResult>(matches: T[]) {
    return matches.sort((a, b) => {
        // REVIEW: temporary heuristics to get better result with wildcards

        // Prefer non-wildcard matches
        if (a.wildcardCharCount === 0) {
            if (b.wildcardCharCount !== 0) {
                return -1;
            }
        } else {
            if (b.wildcardCharCount === 0) {
                return 1;
            }
        }

        // Prefer less implicit parameters
        if (a.implicitParameterCount !== b.implicitParameterCount) {
            return a.implicitParameterCount - b.implicitParameterCount;
        }

        // Prefer more non-optional parts
        if (b.nonOptionalCount !== a.nonOptionalCount) {
            return b.nonOptionalCount - a.nonOptionalCount;
        }

        // Prefer more matched parts
        if (b.matchedCount !== a.matchedCount) {
            return b.matchedCount - a.matchedCount;
        }

        // Prefer less wildcard characters
        return a.wildcardCharCount - b.wildcardCharCount;
    });
}
