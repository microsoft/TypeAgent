// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Simple test script for weather API (runs without compilation)
// Run with: node testWeatherSimple.mjs

async function geocodeLocation(location) {
    try {
        const encodedLocation = encodeURIComponent(location);
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodedLocation}&count=1&language=en&format=json`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Geocoding failed: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.results || data.results.length === 0) {
            return null;
        }

        const result = data.results[0];
        return {
            latitude: result.latitude,
            longitude: result.longitude,
            name: result.name + (result.country ? `, ${result.country}` : ""),
        };
    } catch (error) {
        console.error("Geocoding error:", error);
        return null;
    }
}

async function getCurrentWeather(coords, temperatureUnit = "fahrenheit") {
    try {
        const tempUnit =
            temperatureUnit === "celsius" ? "celsius" : "fahrenheit";
        const url =
            `https://api.open-meteo.com/v1/forecast?` +
            `latitude=${coords.latitude}&longitude=${coords.longitude}` +
            `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m` +
            `&temperature_unit=${tempUnit}` +
            `&wind_speed_unit=mph`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Weather API failed: ${response.statusText}`);
        }

        const data = await response.json();
        const current = data.current;

        return {
            temperature: current.temperature_2m,
            apparentTemperature: current.apparent_temperature,
            weatherCode: current.weather_code,
            humidity: current.relative_humidity_2m,
            windSpeed: current.wind_speed_10m,
            windDirection: current.wind_direction_10m,
        };
    } catch (error) {
        console.error("Current weather error:", error);
        return null;
    }
}

async function getForecastWeather(
    coords,
    days = 7,
    temperatureUnit = "fahrenheit",
) {
    try {
        const tempUnit =
            temperatureUnit === "celsius" ? "celsius" : "fahrenheit";
        const url =
            `https://api.open-meteo.com/v1/forecast?` +
            `latitude=${coords.latitude}&longitude=${coords.longitude}` +
            `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
            `&temperature_unit=${tempUnit}` +
            `&forecast_days=${days}`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Forecast API failed: ${response.statusText}`);
        }

        const data = await response.json();
        const daily = data.daily;

        const forecasts = [];
        for (let i = 0; i < daily.time.length; i++) {
            forecasts.push({
                date: daily.time[i],
                maxTemp: daily.temperature_2m_max[i],
                minTemp: daily.temperature_2m_min[i],
                weatherCode: daily.weather_code[i],
                precipitationProbability:
                    daily.precipitation_probability_max[i] || 0,
            });
        }

        return forecasts;
    } catch (error) {
        console.error("Forecast weather error:", error);
        return null;
    }
}

function getWeatherDescription(code) {
    const weatherCodes = {
        0: "Clear sky",
        1: "Mainly clear",
        2: "Partly cloudy",
        3: "Overcast",
        45: "Foggy",
        48: "Depositing rime fog",
        51: "Light drizzle",
        53: "Moderate drizzle",
        55: "Dense drizzle",
        61: "Slight rain",
        63: "Moderate rain",
        65: "Heavy rain",
        71: "Slight snow fall",
        73: "Moderate snow fall",
        75: "Heavy snow fall",
        80: "Slight rain showers",
        81: "Moderate rain showers",
        82: "Violent rain showers",
        85: "Slight snow showers",
        86: "Heavy snow showers",
        95: "Thunderstorm",
        96: "Thunderstorm with slight hail",
        99: "Thunderstorm with heavy hail",
    };

    return weatherCodes[code] || "Unknown";
}

function getWindDirection(degrees) {
    const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const index = Math.round(degrees / 45) % 8;
    return directions[index];
}

// Run tests
async function runTests() {
    console.log("=== Testing Weather API Integration ===\n");

    const testLocations = ["Seattle", "London", "Tokyo"];

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

    console.log("\n\n=== Testing Invalid Location ===");
    const invalidCoords = await geocodeLocation("XYZ123NotAPlace");
    if (!invalidCoords) {
        console.log("✓ Correctly returned null for invalid location");
    }

    console.log("\n=== All Tests Complete ===\n");
}

runTests().catch(console.error);
