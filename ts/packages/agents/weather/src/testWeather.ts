// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Simple manual test script to verify weather API integration
 * Run with: node --loader ts-node/esm src/testWeather.ts
 * Or compile first and run: node dist/testWeather.js
 */

import {
    geocodeLocation,
    getCurrentWeather,
    getForecastWeather,
    getWeatherDescription,
    getWindDirection,
} from "./weatherService.js";

async function testGeocodingAndWeather() {
    console.log("=== Testing Weather Agent ===\n");

    // Test locations
    const testLocations = ["Seattle", "London", "Tokyo", "New York", "Sydney"];

    for (const location of testLocations) {
        console.log(`\n--- Testing: ${location} ---`);

        // Test geocoding
        console.log("1. Geocoding...");
        const coords = await geocodeLocation(location);
        if (!coords) {
            console.error(`   ❌ Failed to geocode ${location}`);
            continue;
        }
        console.log(
            `   ✓ Found: ${coords.name} (${coords.latitude}, ${coords.longitude})`,
        );

        // Test current weather
        console.log("2. Fetching current weather...");
        const currentWeather = await getCurrentWeather(coords, "fahrenheit");
        if (!currentWeather) {
            console.error(`   ❌ Failed to fetch current weather`);
            continue;
        }
        const conditions = getWeatherDescription(currentWeather.weatherCode);
        const windDir = getWindDirection(currentWeather.windDirection);
        console.log(
            `   ✓ Temperature: ${Math.round(currentWeather.temperature)}°F`,
        );
        console.log(
            `   ✓ Feels like: ${Math.round(currentWeather.apparentTemperature)}°F`,
        );
        console.log(`   ✓ Conditions: ${conditions}`);
        console.log(`   ✓ Humidity: ${currentWeather.humidity}%`);
        console.log(
            `   ✓ Wind: ${Math.round(currentWeather.windSpeed)} mph ${windDir}`,
        );

        // Test forecast (3 days)
        console.log("3. Fetching 3-day forecast...");
        const forecast = await getForecastWeather(coords, 3, "fahrenheit");
        if (!forecast) {
            console.error(`   ❌ Failed to fetch forecast`);
            continue;
        }
        console.log(`   ✓ Got ${forecast.length} days of forecast:`);
        forecast.forEach((day, index) => {
            const dayConditions = getWeatherDescription(day.weatherCode);
            const precip =
                day.precipitationProbability > 0
                    ? `, ${day.precipitationProbability}% precip`
                    : "";
            console.log(
                `      Day ${index + 1} (${day.date}): ${dayConditions}, ` +
                    `High: ${Math.round(day.maxTemp)}°F, Low: ${Math.round(day.minTemp)}°F${precip}`,
            );
        });
    }

    console.log("\n=== All Tests Complete ===\n");
}

async function testCelsiusUnits() {
    console.log("\n=== Testing Celsius Units ===\n");

    const location = "Paris";
    console.log(`Testing ${location} in Celsius...`);

    const coords = await geocodeLocation(location);
    if (!coords) {
        console.error("Failed to geocode");
        return;
    }

    const weather = await getCurrentWeather(coords, "celsius");
    if (!weather) {
        console.error("Failed to fetch weather");
        return;
    }

    console.log(`✓ Temperature: ${Math.round(weather.temperature)}°C`);
    console.log(`✓ Feels like: ${Math.round(weather.apparentTemperature)}°C`);

    const forecast = await getForecastWeather(coords, 5, "celsius");
    if (!forecast) {
        console.error("Failed to fetch forecast");
        return;
    }

    console.log("✓ 5-day forecast:");
    forecast.forEach((day, index) => {
        console.log(
            `   Day ${index + 1}: High ${Math.round(day.maxTemp)}°C, Low ${Math.round(day.minTemp)}°C`,
        );
    });
}

async function testInvalidLocation() {
    console.log("\n=== Testing Invalid Location ===\n");

    const invalidLocation = "ThisIsNotARealPlaceXYZ123";
    console.log(`Testing geocoding of: ${invalidLocation}`);

    const coords = await geocodeLocation(invalidLocation);
    if (!coords) {
        console.log("✓ Correctly returned null for invalid location");
    } else {
        console.log(
            `⚠ Unexpectedly found location: ${coords.name} (might be a partial match)`,
        );
    }
}

async function testEdgeCases() {
    console.log("\n=== Testing Edge Cases ===\n");

    // Test max forecast days
    console.log("Testing 7-day forecast (max)...");
    const coords = await geocodeLocation("Chicago");
    if (coords) {
        const forecast = await getForecastWeather(coords, 7, "fahrenheit");
        if (forecast && forecast.length === 7) {
            console.log("✓ Successfully fetched 7-day forecast");
        } else {
            console.log(
                `⚠ Expected 7 days, got ${forecast?.length || 0} days`,
            );
        }
    }

    // Test 1-day forecast (min)
    console.log("Testing 1-day forecast (min)...");
    if (coords) {
        const forecast = await getForecastWeather(coords, 1, "fahrenheit");
        if (forecast && forecast.length === 1) {
            console.log("✓ Successfully fetched 1-day forecast");
        } else {
            console.log(`⚠ Expected 1 day, got ${forecast?.length || 0} days`);
        }
    }
}

// Run all tests
async function runAllTests() {
    try {
        await testGeocodingAndWeather();
        await testCelsiusUnits();
        await testInvalidLocation();
        await testEdgeCases();
    } catch (error) {
        console.error("Test failed with error:", error);
    }
}

runAllTests();
