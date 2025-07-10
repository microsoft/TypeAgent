// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { HistoryContext } from "../explanation/requestAction.js";
import { getLanguageTools } from "../utils/language.js";
import {
    isSpaceOrPunctuation,
    isSpaceOrPunctuationRange,
    isWordBoundary,
    spaceAndPunctuationRegexStr,
} from "../utils/regexp.js";
import {
    MatchedValues,
    MatchedValueTranslator,
    matchedValues,
} from "./constructionValue.js";
import { ConstructionPart, WildcardMode } from "./constructions.js";

const wildcardRegex = new RegExp(
    `^${spaceAndPunctuationRegexStr}*([^\\s].*?)${spaceAndPunctuationRegexStr}*$`,
);

type MatchState = {
    capture: string[];
    matchedStart: number[]; // array of start indices for each part
    matchedEnd: number[]; // array of end indices for each part, -1 for wildcard match
    matchedCurrent: number;
    pendingWildcard: number;
};

export type MatchConfig = {
    readonly enableWildcard: boolean;
    readonly rejectReferences: boolean;
    readonly partial: boolean;
    readonly history?: HistoryContext | undefined;
    readonly matchPartsCache?: MatchPartsCache | undefined;
    readonly conflicts?: boolean | undefined;
};

export function matchParts(
    request: string,
    parts: ConstructionPart[],
    config: MatchConfig,
    matchValueTranslator: MatchedValueTranslator,
): MatchedValues | undefined {
    const state: MatchState = {
        capture: [],
        matchedStart: [],
        matchedEnd: [],
        matchedCurrent: 0,
        pendingWildcard: -1,
    };

    const wildcardQueue: MatchState[] = [];
    do {
        if (finishMatchParts(state, request, parts, config)) {
            const values = matchedValues(
                parts,
                state.capture,
                config,
                matchValueTranslator,
            );
            if (values !== undefined) {
                if (config.partial) {
                    values.partialPartCount = state.matchedStart.length;
                }
                return values;
            }
        }
    } while (backtrack(state, request, parts, config, wildcardQueue));

    return undefined;
}

function findPendingWildcard(request: string, matchedCurrent: number) {
    let current = matchedCurrent + 1; // wildcard must have at least one character
    while (current < request.length) {
        if (isWordBoundary(request, current)) {
            const wildcardRange = request.substring(matchedCurrent, current);
            const wildcardMatch = wildcardRegex.exec(wildcardRange);
            if (wildcardMatch !== null) {
                break;
            }
        }
        // not word boundary or no text for the wildcard
        current++;
    }

    // first potential end of the wildcard
    return current - matchedCurrent;
}

const langTool = getLanguageTools("en");
function captureMatch(
    state: MatchState,
    part: ConstructionPart,
    m: MatchedPart,
    rejectReference: boolean,
) {
    if (part.capture) {
        state.capture.push(m.text);

        if (rejectReference && langTool?.possibleReferentialPhrase(m.text)) {
            // The captured text can't be a referential phrase.
            // Return false after adding the text to capture so that backtrack will
            // try longer wildcard before this part or shorter match for this part.
            return false;
        }
    }
    return true;
}

function captureWildcardMatch(
    state: MatchState,
    wildcardText: string,
    rejectReferences: boolean,
) {
    if (rejectReferences && langTool?.possibleReferentialPhrase(wildcardText)) {
        // The wildcard can't be a referential phrase. Return false before adding
        // the wildcard text to capture to stop backtrack and try another state
        // from the wildcard queue (that is not at this position).
        return false;
    }

    state.pendingWildcard = -1;
    state.capture.push(wildcardText);
    state.matchedEnd.push(-1); // Use -1 to indicate a wildcard match
    return true;
}

function finishMatchParts(
    state: MatchState,
    request: string,
    parts: ConstructionPart[],
    config: MatchConfig,
) {
    while (state.matchedStart.length < parts.length) {
        const part = parts[state.matchedStart.length];
        const m = matchRegExp(
            state,
            request,
            part.regExp,
            config.matchPartsCache,
        );

        if (m === undefined) {
            // No match
            if (part.optional) {
                // Skip the optional part
                state.matchedStart.push(-1);
                continue;
            }
            // For partial, report as matched if we matched all the text in the request
            // even when not all the parted are matched yet.
            return config.partial && state.matchedCurrent === request.length;
        }

        // Matched
        if (state.pendingWildcard !== -1) {
            const wildcardText = m.wildcard!;
            const wildpart = parts[state.matchedStart.length - 1];
            if (
                !captureWildcardMatch(
                    state,
                    wildcardText,
                    config.rejectReferences &&
                        wildpart.wildcardMode !== WildcardMode.Checked,
                )
            ) {
                return false;
            }
            state.matchedStart.push(m.start);
        } else {
            state.matchedStart.push(state.matchedCurrent);
        }
        const matchedEnd = m.start + m.text.length;
        state.matchedEnd.push(matchedEnd);
        state.matchedCurrent = matchedEnd;
        if (!captureMatch(state, part, m, config.rejectReferences)) {
            return false;
        }
    }

    if (state.pendingWildcard === -1) {
        // The tail should only be space or punctuation
        return (
            state.matchedCurrent === request.length ||
            isSpaceOrPunctuationRange(
                request,
                state.matchedCurrent,
                request.length,
            )
        );
    }

    // End with wildcard
    const wildcardRange = request.substring(state.matchedCurrent);
    const wildcardMatch = wildcardRegex.exec(wildcardRange);
    if (wildcardMatch !== null) {
        // Update the state in case we need to backtrack because value translation failed.
        if (
            !captureWildcardMatch(
                state,
                wildcardMatch[1],
                config.rejectReferences,
            )
        ) {
            return false;
        }
        state.matchedCurrent = request.length;
        return true;
    }

    return false;
}

function cloneMatchState(state: MatchState) {
    return {
        capture: [...state.capture],
        matchedStart: [...state.matchedStart],
        matchedEnd: [...state.matchedEnd],
        matchedCurrent: state.matchedCurrent,
        pendingWildcard: state.pendingWildcard,
    };
}

function resumeFromWildcardQueue(
    state: MatchState,
    request: string,
    wildcardQueue: MatchState[],
) {
    // backtrack to from the wildcard queue
    const wildcardState = wildcardQueue.shift();
    if (wildcardState === undefined) {
        // No more to backtrack
        return false;
    }

    // Restore the state and set up the next wildcard.
    state.matchedStart = wildcardState.matchedStart;
    state.matchedEnd = wildcardState.matchedEnd;
    state.matchedCurrent = wildcardState.matchedCurrent;
    state.capture = wildcardState.capture;

    state.pendingWildcard = findPendingWildcard(request, state.matchedCurrent);
    state.matchedStart.push(state.matchedCurrent);
    return true;
}

function backtrack(
    state: MatchState,
    request: string,
    parts: ConstructionPart[],
    config: MatchConfig,
    wildcardQueue: MatchState[],
) {
    if (config.enableWildcard) {
        // if the part we failed to match could be wildcard, queue up the wildcard match for later
        const failedPart = parts[state.matchedStart.length];
        if (failedPart && failedPart.wildcardMode) {
            // Do not queue up consecutive wildcard.
            if (state.pendingWildcard === -1) {
                wildcardQueue.push(cloneMatchState(state));
            }
        }
    }

    // Go thru the previous match to backtrack to to resume the search.
    // - wildcard that can be longer
    // - shorter match
    // - skip space and punctuation
    // - skipping optional part
    while (true) {
        const backtrackStart = state.matchedStart.pop();
        if (backtrackStart === undefined) {
            // No more to backtrack, resume from wildcard queue if available
            return resumeFromWildcardQueue(state, request, wildcardQueue);
        }
        if (backtrackStart === -1) {
            // the part was skipped (optional), continue to find the part that was not skipped
            continue;
        }

        const lastMatchedCurrent = state.matchedCurrent;
        state.matchedCurrent = backtrackStart;
        if (state.pendingWildcard !== -1) {
            // This mean we can't find the next part after the wildcard
            // since wildcard are matched from cloned state, no more backtracking is necessary.
            // resume from wildcard queue if available
            return resumeFromWildcardQueue(state, request, wildcardQueue);
        }

        const backtrackPart = parts[state.matchedStart.length];
        if (backtrackPart.capture) {
            state.capture.pop();
        }

        const backtrackEnd = state.matchedEnd.pop()!;

        if (backtrackEnd === -1) {
            // -1 indicates a wildcard match
            if (lastMatchedCurrent >= request.length - 1) {
                // wildcard can't be longer
                // since wildcard are matched from cloned state, no more backtracking is necessary.
                // resume from wildcard queue if available
                return resumeFromWildcardQueue(state, request, wildcardQueue);
            }
            // Try for a longer wildcard
            state.pendingWildcard = lastMatchedCurrent - backtrackStart + 1;
            state.matchedStart.push(backtrackStart);
            return true;
        }

        // Try to find a shorter match or skip space and punctuation
        const backtrackMatch = backtrackPartNextMatch(
            request,
            backtrackStart,
            backtrackEnd,
            backtrackPart,
            config.matchPartsCache,
        );

        if (backtrackMatch !== undefined) {
            // record the backtrack next match and continue the search
            state.matchedStart.push(backtrackMatch.start);
            const matchedEnd =
                backtrackMatch.start + backtrackMatch.text.length;
            state.matchedEnd.push(matchedEnd);
            state.matchedCurrent = matchedEnd;
            if (
                !captureMatch(
                    state,
                    backtrackPart,
                    backtrackMatch,
                    config.rejectReferences,
                )
            ) {
                // continue to backtrack.
                continue;
            }
            return true;
        }

        // Give up on the current backtrackPart, queue up wildcard match for later if enabled.
        if (config.enableWildcard && backtrackPart.wildcardMode) {
            // queue up wildcard match
            wildcardQueue.push(cloneMatchState(state));
        }

        // Check if it is optional, backtrack to before the optional and resume the search
        if (backtrackPart.optional) {
            // REVIEW: the constructor enforced that parts before and after a wildcard can't be optional.
            // Otherwise, we need to restor pendingWildcard state here.
            state.matchedStart.push(-1);
            return true;
        }

        // continue to backtrack if it is not optional and no shorter match
    }
}

function backtrackPartNextMatch(
    request: string,
    lastStart: number,
    lastEnd: number,
    part: ConstructionPart,
    matchPartsCache: MatchPartsCache | undefined,
) {
    // Check if the part has a shorter match
    const backtrackString = request.substring(0, lastEnd - 1);
    const backtrackMatch = matchRegExpAt(
        backtrackString,
        lastStart,
        part.regExp,
        matchPartsCache,
    );

    // If no shorter match and matched position is space or punctuation, try to match skipping it.
    return (
        backtrackMatch ??
        (isSpaceOrPunctuation(request, lastStart)
            ? matchRegExpWithoutWildcard(
                  request,
                  lastStart + 1,
                  part.regExp,
                  matchPartsCache,
              )
            : undefined)
    );
}

type MatchedPart = {
    start: number;
    text: string;
    wildcard?: string;
};
function matchRegExpWithWildcard(
    request: string,
    matchedCurrent: number,
    regExp: RegExp,
    pendingWildcard: number,
    matchPartsCache: MatchPartsCache | undefined,
) {
    let searchStart = matchedCurrent + pendingWildcard;
    while (searchStart < request.length) {
        // Skip to the next word boundary
        if (!isWordBoundary(request, searchStart)) {
            searchStart++;
            continue;
        }

        // Check if we can find a match with regExp (include shorter match and space skipping)
        const result = matchRegExpWithoutWildcard(
            request,
            searchStart,
            regExp,
            matchPartsCache,
        );

        if (result === undefined) {
            searchStart++;
            continue;
        }

        // Found a match, fill in the wildcard
        const wildcardRange = request.substring(matchedCurrent, result.start);
        const wildcardMatch = wildcardRegex.exec(wildcardRange);
        if (wildcardMatch === null) {
            throw new Error("internal error: wildcard should have text");
        }
        result.wildcard = wildcardMatch[1];
        return result;
    }
    return undefined;
}

function matchRegExpAt(
    request: string,
    start: number,
    regExp: RegExp,
    matchPartsCache: MatchPartsCache | undefined,
): MatchedPart | undefined {
    let currentRange = request;
    while (true) {
        const text = stickyRegExpExecWithCache(
            regExp,
            currentRange,
            start,
            matchPartsCache,
        );

        if (text === null) {
            // No smaller match found at the index
            return undefined;
        }

        const matchedEnd = start + text.length;
        if (isWordBoundary(request, matchedEnd)) {
            return { start, text };
        }

        if (matchedEnd - start === 1) {
            // Can't go smaller
            return undefined;
        }
        currentRange = request.substring(0, matchedEnd - 1);
    }
}

function matchRegExpWithoutWildcard(
    request: string,
    matchedCurrent: number,
    regExp: RegExp,
    matchPartsCache: MatchPartsCache | undefined,
): MatchedPart | undefined {
    let i = matchedCurrent;
    do {
        const matched = matchRegExpAt(request, i, regExp, matchPartsCache);
        if (matched) {
            return matched;
        }
        if (!isSpaceOrPunctuation(request, i)) {
            return undefined;
        }
        i++;
    } while (i < request.length);
}

function matchRegExp(
    state: MatchState,
    request: string,
    regExp: RegExp,
    matchPartsCache: MatchPartsCache | undefined,
) {
    if (!regExp.sticky) {
        throw new Error("RegExp should be sticky");
    }
    return state.pendingWildcard !== -1
        ? matchRegExpWithWildcard(
              request,
              state.matchedCurrent,
              regExp,
              state.pendingWildcard,
              matchPartsCache,
          )
        : matchRegExpWithoutWildcard(
              request,
              state.matchedCurrent,
              regExp,
              matchPartsCache,
          );
}

function stickyRegExpExec(regExp: RegExp, s: string, start: number) {
    regExp.lastIndex = start;
    const matched = regExp.exec(s);
    if (matched === null) {
        return null;
    }
    if (matched.index !== start) {
        throw new Error("internal error: sticky regex should match at index");
    }
    return matched[0];
}

export function createMatchPartsCache(cachedString: string) {
    return {
        cachedString,
        cache: new Map<RegExp, (string | null)[]>(),
        cacheWithEnd: new Map<number, Map<RegExp, (string | null)[]>>(),
        totalTime: 0,
        hit: 0,
        miss: 0,
    };
}

export type MatchPartsCache = ReturnType<typeof createMatchPartsCache>;

export function getMatchPartsCacheStats(matchPartsCache: MatchPartsCache) {
    const total = matchPartsCache.hit + matchPartsCache.miss;
    const messages: string[] = [];
    messages.push(`  Time: ${matchPartsCache.totalTime}`);
    messages.push(
        `   Hit: ${matchPartsCache.hit} (${((matchPartsCache.hit / total) * 100).toFixed(2)}%)`,
    );
    messages.push(
        `  Miss: ${matchPartsCache.miss} (${((matchPartsCache.miss / total) * 100).toFixed(2)}%)`,
    );
    messages.push(`Regexp: ${matchPartsCache.cache.size}`);
    return messages.join("\n");
}

function getResultCache(
    matchPartsCache: MatchPartsCache,
    regExp: RegExp,
    s: string,
    start: number,
) {
    let cache: Map<RegExp, (string | null)[]>;
    if (matchPartsCache.cachedString === s) {
        cache = matchPartsCache.cache;
    } else {
        if (!matchPartsCache.cachedString.startsWith(s)) {
            throw new Error(
                `internal error: cache should be prefix\n${matchPartsCache.cachedString}\n${s}`,
            );
        }
        const length = s.length - start;
        const existingCache = matchPartsCache.cacheWithEnd.get(length);
        if (existingCache !== undefined) {
            cache = existingCache;
        } else {
            cache = new Map();
            matchPartsCache.cacheWithEnd.set(length, cache);
        }
    }
    const resultCache = cache.get(regExp);
    if (resultCache !== undefined) {
        return resultCache;
    }
    const newResultCache: (string | null)[] = [];
    cache.set(regExp, newResultCache);
    return newResultCache;
}

function stickyRegExpExecWithCache(
    regExp: RegExp,
    s: string,
    start: number,
    matchPartsCache: MatchPartsCache | undefined,
) {
    if (matchPartsCache === undefined) {
        return stickyRegExpExec(regExp, s, start);
    }
    const resultCache = getResultCache(matchPartsCache, regExp, s, start);
    if (resultCache[start] !== undefined) {
        matchPartsCache.hit++;
        return resultCache[start];
    }
    matchPartsCache.miss++;
    const startTime = performance.now();
    const result = stickyRegExpExec(regExp, s, start);
    matchPartsCache.totalTime += performance.now() - startTime;
    resultCache[start] = result;
    return result;
}
