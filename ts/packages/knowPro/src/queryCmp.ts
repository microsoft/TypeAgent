// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Query comparison operations
 */

import { collections } from "typeagent";
import { conversation as kpLib } from "knowledge-processor";

export enum ComparisonOp {
    Eq,
    Lt,
    Lte,
    Gt,
    Gte,
    Neq,
}

/**
 *
 * @param facets
 * @param facetName Match facets with one of these names name (case-insensitive)
 * @param value
 * @param op
 */
export function hasMatchingFacets(
    facets: kpLib.Facet[] | undefined,
    facetName: string,
    value: kpLib.Value,
    op: ComparisonOp,
): boolean {
    if (facets !== undefined && facets.length > 0) {
        for (const facet of facets) {
            if (
                collections.stringEquals(facet.name, facetName, false) &&
                compareValue(facet.value, value, op)
            ) {
                return true;
            }
        }
    }
    return false;
}

export function compareFacetName(
    x: kpLib.Facet,
    y: string,
    op: ComparisonOp,
): boolean {
    return compareScalar(x.name, y, op);
}

export function compareValue(
    x: kpLib.Value,
    y: kpLib.Value,
    op: ComparisonOp,
): boolean {
    const xType = typeof x;
    const yType = typeof y;
    if (xType === yType) {
        switch (xType) {
            default:
                return false;
            case "number":
            case "boolean":
            case "string":
                return compareScalar(x, y, op);
            case "object":
                return compareQuantity(
                    x as kpLib.Quantity,
                    y as kpLib.Quantity,
                    op,
                );
        }
    }

    return false;
}

function compareQuantity(
    x: kpLib.Quantity,
    y: kpLib.Quantity,
    op: ComparisonOp,
): boolean {
    return x.units === y.units ? compareScalar(x.amount, y.amount, op) : false;
}

export function compareScalar(x: any, y: any, op: ComparisonOp): boolean {
    switch (op) {
        default:
            return false;
        case ComparisonOp.Eq:
            return x === y;
        case ComparisonOp.Neq:
            return x !== y;
        case ComparisonOp.Lt:
            return x < y;
        case ComparisonOp.Lte:
            return x <= y;
        case ComparisonOp.Gt:
            return x > y;
        case ComparisonOp.Gte:
            return x >= y;
    }
}
