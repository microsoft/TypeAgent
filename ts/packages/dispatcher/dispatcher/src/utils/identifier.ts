// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared identifier-splitting primitive. Splits camelCase / PascalCase runs and
// acronym boundaries into space-separated words, without altering case,
// punctuation, or surrounding whitespace — callers layer their own
// normalization (lowercasing, separator handling, trimming) on top. Keeping the
// two subtle boundary regexes in one place stops them drifting between callers
// (e.g. the contextSelector tokenizer and the action-similarity humanizer).
//
//   "addItems"     -> "add Items"
//   "HTMLParser"   -> "HTML Parser"   (acronym run before a Capitalized word)
//   "s3Upload"     -> "s3 Upload"     (digit -> uppercase boundary)
export function splitCamelCase(identifier: string): string {
    return identifier
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}
