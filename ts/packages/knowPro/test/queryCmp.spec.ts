// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";
import { ComparisonOp, hasMatchingFacets } from "../src/queryCmp.js";
/**
 * Designed to run offline
 */
describe("queryCmp.offline", () => {
    test("facet.compareOp", () => {
        const numRestaurants = 15;
        const maxStars = 3;
        const numPerRating = numRestaurants / maxStars;
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

    function createRestaurants(
        count: number,
        maxStars: number,
    ): kpLib.ConcreteEntity[] {
        const entities: kpLib.ConcreteEntity[] = [];
        for (let i = 0; i < count; ++i) {
            entities.push(
                createRestaurant(`Restaurant_${i + 1}`, 1 + (i % maxStars)),
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
