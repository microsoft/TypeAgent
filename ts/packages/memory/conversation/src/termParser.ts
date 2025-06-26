// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import { split } from "knowledge-processor";
import { addNoiseWordsFromFile } from "./memory.js";
import { getAbsolutePathFromUrl } from "memory-storage";

export class SearchTermParser {
    public noiseTerms: Set<string>;

    constructor(
        noiseFilePath?: string,
        public minTermLength: number = 3,
    ) {
        this.noiseTerms = new Set();
        noiseFilePath ??= getAbsolutePathFromUrl(
            import.meta.url,
            "searchNoiseTerms.txt",
        );
        addNoiseWordsFromFile(this.noiseTerms!, noiseFilePath);
    }

    public getTerms(text: string, caseSensitive: boolean = false): string[] {
        // Should we also handle quotes etc?
        let terms = split(
            text,
            /"([^"]+)"|([a-zA-Z0-9]+(?:[-][a-zA-Z0-9]+)*)/g,
            {
                trim: true,
                removeEmpty: true,
            },
        );
        if (!caseSensitive) {
            terms = terms.map((t) => t.toLowerCase());
        }
        terms = this.removeNoise(terms);
        const uniqueTerms = new Set(terms);
        return [...uniqueTerms.values()];
    }

    public getSearchTerms(text: string): kp.SearchTermGroup | undefined {
        const rawTerms = this.getTerms(text);
        if (!rawTerms) {
            return undefined;
        }
        const terms: kp.SearchTerm[] = rawTerms.map((rt) => {
            return { term: { text: rt } };
        });
        return {
            booleanOp: "or_max",
            terms,
        };
    }

    public removeNoise(terms: string[]): string[] {
        let cleanTerms = terms.filter(
            (t) => t.length >= this.minTermLength && !this.noiseTerms.has(t),
        );
        return cleanTerms;
    }
}
