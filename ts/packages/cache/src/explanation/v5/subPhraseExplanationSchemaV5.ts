// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface SubPhrase {
    // The text of the sub-phrase. The text must be exact copy of a part of the original request. Include whole words from the request in the sub-phrase. Do NOT change the text by correct misspelling or grammar.
    text: string;
}

// The sub-phrase is not an input to any property values.
export interface NonPropertySubPhrase extends SubPhrase {
    // kind of text that can be substituted in original request in this context. Some common categories: politeness (please), greeting (hi), acknowledgement (ok, thanks), filler (um), confirmation (yes), negation (no), preposition.
    category: string;
    // Return 3 or more phrases that can be substituted in original request without changing the translation.
    synonyms: string[];
    // true if property values are still the same without this sub-phrase in the request. Some but not all sub-phrase can be optional.
    isOptional?: boolean;
}

// The sub-phrase is an input to property values.
export interface PropertySubPhase extends SubPhrase {
    // kind of text that can be substituted in original request in this context.
    category: string;
    // One or more property names that the sub-phrase is an input to the value of
    propertyNames: string[];
}

export type SubPhraseType = PropertySubPhase | NonPropertySubPhrase;

export interface SubPhraseExplanation {
    // Break the entire request in order into non-overlapping sub-phrases. Sub-phrases must not reuse words.
    subPhrases: SubPhraseType[];
}
