// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unit tests for the structured-content builders in weatherActionHandler:
 * buildCurrentConditionsResult (heading + keyValue) and buildForecastResult
 * (heading + sortable table). Both are pure functions of already-fetched
 * data, so no network access is needed.
 */

import {
    buildCurrentConditionsResult,
    buildForecastResult,
} from "../src/weatherActionHandler.js";

const entities = [{ name: "Quincy", type: ["location"] }];

function blocks(result: any) {
    return (result.displayContent as any).blocks;
}

describe("buildCurrentConditionsResult", () => {
    const result = buildCurrentConditionsResult(
        "Quincy",
        "fahrenheit",
        {
            temperature: 71.4,
            apparentTemperature: 69.2,
            humidity: 40,
            windSpeed: 8.6,
            conditions: "Clear sky",
            windDir: "NW",
        },
        "history",
        entities,
    );

    test("heading names the location", () => {
        expect(blocks(result)[0]).toMatchObject({
            kind: "heading",
            text: "Current conditions in Quincy",
        });
    });

    test("keyValue has Temperature/Conditions/Humidity/Wind", () => {
        const kv = blocks(result).find((b: any) => b.kind === "keyValue");
        expect(kv.pairs.map((p: any) => p.label)).toEqual([
            "Temperature",
            "Conditions",
            "Humidity",
            "Wind",
        ]);
    });

    test("temperature is rounded with unit + feels-like", () => {
        const kv = blocks(result).find((b: any) => b.kind === "keyValue");
        expect(kv.pairs[0].value).toBe("71°F (feels like 69°F)");
    });

    test("rawData carries the numeric values", () => {
        const raw = (result.displayContent as any).rawData;
        expect(raw).toMatchObject({
            location: "Quincy",
            units: "fahrenheit",
            temperature: 71.4,
            windDirection: "NW",
        });
    });
});

describe("buildForecastResult", () => {
    const forecast = [
        {
            date: "2026-07-13",
            weatherCode: 0,
            maxTemp: 31.2,
            minTemp: 15.1,
            precipitationProbability: 0,
        },
        {
            date: "2026-07-14",
            weatherCode: 3,
            maxTemp: 35.9,
            minTemp: 19.4,
            precipitationProbability: 20,
        },
    ];
    const result = buildForecastResult(
        "Quincy",
        "celsius",
        2,
        forecast,
        "history",
        entities,
    );
    const table = () => blocks(result).find((b: any) => b.kind === "table");

    test("heading includes day count and location", () => {
        expect(blocks(result)[0].text).toBe("2-day forecast for Quincy");
    });

    test("first column is the weekday name, not 'Day N'", () => {
        const weekday = table().rows[0][0];
        expect(weekday).toMatch(
            /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/,
        );
    });

    test("high/low rounded with the celsius unit", () => {
        expect(table().rows[0][3]).toBe("31°C");
        expect(table().rows[0][4]).toBe("15°C");
    });

    test("zero precipitation renders as em dash, otherwise percent", () => {
        expect(table().rows[0][5]).toBe("—");
        expect(table().rows[1][5]).toBe("20%");
    });

    test("table is sortable", () => {
        expect(table().sortable).toBe(true);
    });

    test("rawData carries the forecast array", () => {
        const raw = (result.displayContent as any).rawData;
        expect(raw.forecast).toBe(forecast);
        expect(raw.days).toBe(2);
    });
});
