// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mathLib, TopNCollection } from "typeagent";
import {
    ITermToSemanticRefIndex,
    ScoredSemanticRef,
    SemanticRefIndex,
} from "./dataFormat.js";

export function lookupTermsInIndex(
    terms: string[],
    semanticRefIndex: ITermToSemanticRefIndex,
): ScoredSemanticRef[] {
    const matches = new HitTable();
    for (const term of terms) {
        const scoredRefs = semanticRefIndex.lookupTerm(term);
        if (scoredRefs) {
            matches.add(scoredRefs);
        }
    }
    return matches.getTopScoring();
}

class HitTable {
    constructor(public hits = new Map<SemanticRefIndex, ScoredSemanticRef>()) {}

    public add(matches: ScoredSemanticRef | ScoredSemanticRef[]) {
        if (Array.isArray(matches)) {
            for (const match of matches) {
                this.addMatch(match);
            }
        } else {
            this.addMatch(matches);
        }
    }

    private addMatch(match: ScoredSemanticRef) {
        let scoredRef = this.hits.get(match.semanticRefIndex);
        if (scoredRef) {
            scoredRef.score += match.score;
        } else {
            scoredRef = {
                semanticRefIndex: match.semanticRefIndex,
                score: match.score,
            };
            this.hits.set(match.semanticRefIndex, scoredRef);
        }
    }

    public getSortedByScore(): ScoredSemanticRef[] {
        if (this.hits.size === 0) {
            return [];
        }
        // Descending order
        let valuesByScore = [...this.hits.values()].sort(
            (x, y) => y.score - x.score,
        );
        return valuesByScore;
    }

    public getTopScoring(): ScoredSemanticRef[] {
        if (this.hits.size === 0) {
            return [];
        }
        let maxScore = mathLib.max(this.hits.values(), (v) => v.score)!.score;
        let top: ScoredSemanticRef[] = [];
        for (const value of this.hits.values()) {
            if (value.score === maxScore) {
                top.push(value);
            }
        }
        return top;
    }

    public getTopN(maxMatches: number): ScoredSemanticRef[] {
        if (this.hits.size === 0) {
            return [];
        }
        const topList = new TopNCollection(maxMatches, -1);
        for (const value of this.hits.values()) {
            topList.push(value.semanticRefIndex, value.score);
        }
        const ranked = topList.byRank();
        return ranked.map((m) => {
            return {
                semanticRefIndex: m.item,
                score: m.score,
            };
        });
    }
}
