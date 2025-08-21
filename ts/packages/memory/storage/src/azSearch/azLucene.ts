// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";

export class LuceneQueryCompiler {
    constructor(public fieldPaths: Map<kp.PropertyNames, string>) {}

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
                searchExpressions.push(term.term.text);
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
            searchExpr = this.propertyMatch(
                term.propertyName as kp.PropertyNames,
                term.propertyValue.term,
            );
        } else {
            searchExpr = boolExpr(
                "AND",
                this.propertyMatch(
                    kp.PropertyNames.FacetName,
                    term.propertyName.term,
                ),
                this.propertyMatch(
                    kp.PropertyNames.FacetValue,
                    term.propertyValue.term,
                ),
            );
        }
        return searchExpr;
    }

    private getFieldPath(propertyName: kp.PropertyNames) {
        const fieldPath = this.fieldPaths.get(propertyName);
        if (fieldPath === undefined) {
            throw new Error("Not supported");
        }
        return fieldPath;
    }

    private propertyMatch(propertyName: kp.PropertyNames, value: kp.Term) {
        return fieldMatchExpr(this.getFieldPath(propertyName), value.text);
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
