// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";

export type LuceneCompilerOptions = {
    /**
     * Always use phrase matching
     *
     */
    phraseMatch: boolean;
};

export function createLuceneCompilerOptions(): LuceneCompilerOptions {
    return {
        // True for knowPro compat
        phraseMatch: true,
    };
}

export class LuceneQueryCompiler {
    /**
     *
     * @param fieldPaths Mapping of knowPro {@link kp.PropertyNames} to paths in the Azure Search schema. @see {createPropertyNameToFieldPathMap}
     * @param options
     */
    constructor(
        public fieldPaths: Map<kp.PropertyNames, string>,
        public options: LuceneCompilerOptions = createLuceneCompilerOptions(),
    ) {}

    public compileSearchTermGroup(group: kp.SearchTermGroup): string {
        if (group.terms.length === 0) {
            return "";
        }
        const searchExpressions: string[] = [];
        for (const term of group.terms) {
            if (kp.isSearchGroupTerm(term)) {
                searchExpressions.push(
                    `(${this.compileSearchTermGroup(term)})`,
                );
            } else if (kp.isPropertyTerm(term)) {
                searchExpressions.push(this.compilePropertySearchTerm(term));
            } else {
                searchExpressions.push(this.compileSearchTerm(term));
            }
        }
        return multiBoolExpr(
            group.booleanOp === "and" ? "AND" : "OR",
            searchExpressions,
        );
    }

    private compilePropertySearchTerm(term: kp.PropertySearchTerm): string {
        // TODO: handle related terms
        let searchExpr: string;
        if (typeof term.propertyName === "string") {
            searchExpr = this.compilePropertyMatch(
                term.propertyName as kp.PropertyNames,
                term.propertyValue.term,
            );
        } else {
            searchExpr = boolExpr(
                "AND",
                this.compilePropertyMatch(
                    kp.PropertyNames.FacetName,
                    term.propertyName.term,
                ),
                this.compilePropertyMatch(
                    kp.PropertyNames.FacetValue,
                    term.propertyValue.term,
                ),
            );
        }
        return searchExpr;
    }

    private compileSearchTerm(term: kp.SearchTerm): string {
        return phraseMatchExpr(term.term);
    }

    private compilePropertyMatch(
        propertyName: kp.PropertyNames,
        value: kp.Term,
    ) {
        return fieldMatchExpr(this.getFieldPath(propertyName), value.text);
    }

    private getFieldPath(propertyName: kp.PropertyNames) {
        const fieldPath = this.fieldPaths.get(propertyName);
        if (fieldPath === undefined) {
            throw new Error("Not supported");
        }
        return fieldPath;
    }
}

// Lucene syntax

type BooleanOp = "AND" | "OR";

function boolExpr(op: BooleanOp, lh: string, rh: string): string {
    return `(${lh} ${op} ${rh})`;
}

function multiBoolExpr(op: BooleanOp, expr: string[]): string {
    return expr.length > 1
        ? `(${expr.join(` ${op} `)})`
        : expr.length === 1
          ? expr[0]
          : "";
}

function fieldMatchExpr(field: string, value: string): string {
    return `${field}:"${value}"`;
}

function phraseMatchExpr(term: kp.Term): string {
    return `"${term.text}"`;
}
