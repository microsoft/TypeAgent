// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ITermToSemanticRefIndex, ScoredSemanticRef } from "./dataFormat.js";
import * as q from "./query.js";
import * as knowLib from "knowledge-processor";

export class SearchResult {
    constructor(
        public termMatches: Set<string> = new Set(),
        public semanticRefMatches: ScoredSemanticRef[] = [],
    ) {}

    public get hasMatches(): boolean {
        return this.semanticRefMatches.length > 0;
    }
}

export function searchTermsInIndex(
    semanticRefIndex: ITermToSemanticRefIndex,
    terms: q.QueryTerm[],
    maxMatches?: number,
    minHitCount?: number,
): SearchResult {
    const context = new q.QueryEvalContext();
    const query = new q.SelectTopNExpr(
        new q.TermsMatchExpr(semanticRefIndex, terms),
        maxMatches,
        minHitCount,
    );
    const evalResults = query.eval(context);
    return new SearchResult(
        evalResults.termMatches,
        evalResults.toScoredSemanticRefs(),
    );
}

export function parseQueryTerms(args: string[]): q.QueryTerm[] {
    const queryTerms: q.QueryTerm[] = [];
    for (const arg of args) {
        let allTermStrings = knowLib.split(arg, ";", {
            trim: true,
            removeEmpty: true,
        });
        if (allTermStrings.length > 0) {
            allTermStrings = allTermStrings.map((t) => t.toLowerCase());
            const queryTerm: q.QueryTerm = {
                term: { text: allTermStrings[0] },
            };
            if (allTermStrings.length > 0) {
                queryTerm.relatedTerms = [];
                for (let i = 1; i < allTermStrings.length; ++i) {
                    queryTerm.relatedTerms.push({ text: allTermStrings[i] });
                }
            }
            queryTerms.push(queryTerm);
        }
    }
    return queryTerms;
}
