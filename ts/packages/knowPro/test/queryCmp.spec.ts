// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";
import {
    ComparisonOp,
    filterEntities,
    hasMatchingFacets,
} from "../src/queryCmp.js";
/**
 * Designed to run offline
 */
describe("queryCmp.offline", () => {
    const numRestaurants = 15;
    const maxStars = 3;
    const maxCost = 3;
    const numPerRating = numRestaurants / maxStars;
    const numPerCost = numRestaurants / maxCost;

    test("facet.compareOp", () => {
        const restaurants = createRestaurants(numRestaurants, maxStars);
        let matches = restaurants.filter((r) =>
            hasMatchingFacets(r.facets, "rating", 2, ComparisonOp.Eq),
        );
        expect(matches).toHaveLength(numPerRating);
        matches = restaurants.filter((r) =>
            hasMatchingFacets(r.facets, "rating", 2, ComparisonOp.Lt),
        );
        expect(matches.length).toEqual(numPerRating);
        matches = restaurants.filter((r) =>
            hasMatchingFacets(r.facets, "rating", 2, ComparisonOp.Lte),
        );
        expect(matches.length).toEqual(2 * numPerRating);
        matches = restaurants.filter((r) =>
            hasMatchingFacets(r.facets, "rating", 3, ComparisonOp.Lt),
        );
        expect(matches.length).toEqual(2 * numPerRating);
        matches = restaurants.filter((r) =>
            hasMatchingFacets(r.facets, "rating", 3, ComparisonOp.Lte),
        );
        expect(matches.length).toEqual(numRestaurants);
        matches = restaurants.filter((r) =>
            hasMatchingFacets(r.facets, "rating", 2, ComparisonOp.Gt),
        );
        expect(matches.length).toEqual(numPerRating);
        matches = restaurants.filter((r) =>
            hasMatchingFacets(r.facets, "rating", 1, ComparisonOp.Gte),
        );
        expect(matches.length).toEqual(numRestaurants);
        matches = restaurants.filter((r) =>
            hasMatchingFacets(r.facets, "rating", 2, ComparisonOp.Gte),
        );
        expect(matches.length).toEqual(2 * numPerRating);
    });

    test("entities.compareOp", () => {
        const restaurants = createRestaurants(numRestaurants, maxStars);
        let matches = filterEntities(
            restaurants,
            "rating",
            2,
            ComparisonOp.Gte,
        );
        expect(matches).toHaveLength(2 * numPerRating);

        matches = filterEntities(
            restaurants,
            "cost",
            { units: "$", amount: 2 },
            ComparisonOp.Gte,
        );
        expect(matches).toHaveLength(2 * numPerCost);

        matches = filterEntities(
            restaurants,
            "cost",
            { units: "@", amount: 2 },
            ComparisonOp.Gte,
        );
        expect(matches).toHaveLength(0);
    });

    function createRestaurants(
        count: number,
        maxStars: number,
        maxCost?: number,
    ): kpLib.ConcreteEntity[] {
        maxCost ??= maxStars;
        const entities: kpLib.ConcreteEntity[] = [];
        for (let i = 0; i < count; ++i) {
            entities.push(
                createRestaurant(
                    `Restaurant_${i + 1}`,
                    1 + (i % maxStars),
                    1 + (i % maxCost),
                ),
            );
        }
        return entities;
    }

    function createRestaurant(name: string, rating: number, cost?: number) {
        let restaurant: kpLib.ConcreteEntity = {
            name,
            type: ["restaurant"],
            facets: [{ name: "rating", value: rating }],
        };
        if (cost) {
            restaurant.facets?.push({
                name: "cost",
                value: { units: "$", amount: cost },
            });
        }
        return restaurant;
    }
});
