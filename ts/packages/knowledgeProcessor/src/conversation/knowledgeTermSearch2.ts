// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { setFrom } from "../setOperations.js";
import { NoEntityName } from "./knowledge.js";
import { ActionTerm, TermFilterV2 } from "./knowledgeTermSearchSchema2.js";

export function getAllTermsInFilter(
    filter: TermFilterV2,
    includeVerbs: boolean = true,
): string[] {
    const action = filter.action;
    if (action) {
        let terms: string[] = [];
        const subject = getSubjectFromActionTerm(action);
        if (subject && subject !== NoEntityName) {
            terms.push(subject);
        }
        if (includeVerbs && action.verbs) {
            terms.push(...action.verbs.words);
        }
        if (action.object) {
            terms.push(action.object);
        }
        if (filter.searchTerms && filter.searchTerms.length > 0) {
            terms.push(...filter.searchTerms);
        }
        terms = [...setFrom(terms).values()];
        return terms;
    }
    return filter.searchTerms ?? [];
}

export function getSubjectFromActionTerm(
    term?: ActionTerm | undefined,
): string | undefined {
    if (term) {
        if (typeof term.subject !== "string" && !term.subject.isPronoun) {
            return term.subject.subject;
        }
    }
    return undefined;
}
