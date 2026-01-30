// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Weather service using Open-Meteo API (https://open-meteo.com/)
 * - Completely free, no API key required
 * - Provides current weather and forecast data
 */

export interface Coordinates {
    latitude: number;
    longitude: number;
    name: string;
}

export interface CurrentWeather {
    temperature: number;
    apparentTemperature: number;
    weatherCode: number;
    humidity: number;
    windSpeed: number;
    windDirection: number;
}

export interface DailyForecast {
    date: string;
    maxTemp: number;
    minTemp: number;
    weatherCode: number;
    precipitationProbability: number;
}

/**
 * Geocode a location string to coordinates using Open-Meteo Geocoding API
 */
export async function geocodeLocation(
    location: string,
): Promise<Coordinates | null> {
    try {
        const encodedLocation = encodeURIComponent(location);
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodedLocation}&count=1&language=en&format=json`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Geocoding failed: ${response.statusText}`);
        }

        const data = (await response.json()) as any;

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

/**
 * Get current weather conditions for coordinates
 */
export async function getCurrentWeather(
    coords: Coordinates,
    temperatureUnit: "celsius" | "fahrenheit" = "fahrenheit",
): Promise<CurrentWeather | null> {
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

        const data = (await response.json()) as any;
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

/**
 * Get weather forecast for coordinates
 */
export async function getForecastWeather(
    coords: Coordinates,
    days: number = 7,
    temperatureUnit: "celsius" | "fahrenheit" = "fahrenheit",
): Promise<DailyForecast[] | null> {
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

        const data = (await response.json()) as any;
        const daily = data.daily;

        const forecasts: DailyForecast[] = [];
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

/**
 * Convert WMO weather code to human-readable description
 * Based on WMO code table: https://open-meteo.com/en/docs
 */
export function getWeatherDescription(code: number): string {
    const weatherCodes: { [key: number]: string } = {
        0: "Clear sky",
        1: "Mainly clear",
        2: "Partly cloudy",
        3: "Overcast",
        45: "Foggy",
        48: "Depositing rime fog",
        51: "Light drizzle",
        53: "Moderate drizzle",
        55: "Dense drizzle",
        56: "Light freezing drizzle",
        57: "Dense freezing drizzle",
        61: "Slight rain",
        63: "Moderate rain",
        65: "Heavy rain",
        66: "Light freezing rain",
        67: "Heavy freezing rain",
        71: "Slight snow fall",
        73: "Moderate snow fall",
        75: "Heavy snow fall",
        77: "Snow grains",
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

/**
 * Convert wind direction in degrees to cardinal direction
 */
export function getWindDirection(degrees: number): string {
    const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const index = Math.round(degrees / 45) % 8;
    return directions[index];
}
