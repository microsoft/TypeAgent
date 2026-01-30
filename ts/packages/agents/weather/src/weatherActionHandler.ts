// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ActionContext,
    AppAgent,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import { WeatherAction } from "./weatherSchema.js";
import {
    geocodeLocation,
    getCurrentWeather,
    getForecastWeather,
    getWeatherDescription,
    getWindDirection,
} from "./weatherService.js";

// Weather agent context (can be expanded for caching, preferences, etc.)
export type WeatherActionContext = {};

// Initialize agent context
async function initializeWeatherContext() {
    return {};
}

// Update agent context when enabled/disabled
async function updateWeatherContext(
    enable: boolean,
    context: SessionContext<WeatherActionContext>,
): Promise<void> {
    // No setup/teardown needed for now
}

// Main action execution handler
async function executeWeatherAction(
    action: TypeAgentAction<WeatherAction>,
    context: ActionContext<WeatherActionContext>,
) {
    const weatherAction = action as WeatherAction;

    try {
        switch (weatherAction.actionName) {
            case "getCurrentConditions":
                return await handleGetCurrentConditions(weatherAction, context);
            case "getForecast":
                return await handleGetForecast(weatherAction, context);
            case "getAlerts":
                return await handleGetAlerts(weatherAction, context);
            default:
                return createActionResultFromError(
                    `Unknown weather action: ${(weatherAction as any).actionName}`,
                );
        }
    } catch (error) {
        return createActionResultFromError(
            `Weather action failed: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

// Handler for getCurrentConditions action
async function handleGetCurrentConditions(
    action: Extract<WeatherAction, { actionName: "getCurrentConditions" }>,
    context: ActionContext<WeatherActionContext>,
) {
    const { location, units = "fahrenheit" } = action.parameters;

    // Geocode the location
    const coords = await geocodeLocation(location);
    if (!coords) {
        return createActionResultFromError(
            `Could not find location: ${location}`,
        );
    }

    // Get current weather
    const weather = await getCurrentWeather(coords, units);
    if (!weather) {
        return createActionResultFromError(
            `Failed to fetch weather data for ${location}`,
        );
    }

    const tempUnit = units === "celsius" ? "°C" : "°F";
    const conditions = getWeatherDescription(weather.weatherCode);
    const windDir = getWindDirection(weather.windDirection);

    const displayText =
        `Current conditions in ${coords.name}:\n` +
        `Temperature: ${Math.round(weather.temperature)}${tempUnit} (feels like ${Math.round(weather.apparentTemperature)}${tempUnit})\n` +
        `Conditions: ${conditions}\n` +
        `Humidity: ${weather.humidity}%\n` +
        `Wind: ${Math.round(weather.windSpeed)} mph ${windDir}`;

    const historyText = `Got current weather for ${coords.name}`;

    const entities = [
        {
            name: coords.name,
            type: ["location"],
        },
    ];

    return createActionResultFromTextDisplay(
        displayText,
        historyText,
        entities,
    );
}

// Handler for getForecast action
async function handleGetForecast(
    action: Extract<WeatherAction, { actionName: "getForecast" }>,
    context: ActionContext<WeatherActionContext>,
) {
    const { location, days = 3, units = "fahrenheit" } = action.parameters;

    // Validate days parameter
    if (days < 1 || days > 7) {
        return createActionResultFromError("Days must be between 1 and 7");
    }

    // Geocode the location
    const coords = await geocodeLocation(location);
    if (!coords) {
        return createActionResultFromError(
            `Could not find location: ${location}`,
        );
    }

    // Get forecast weather
    const forecastData = await getForecastWeather(coords, days, units);
    if (!forecastData) {
        return createActionResultFromError(
            `Failed to fetch forecast data for ${location}`,
        );
    }

    const tempUnit = units === "celsius" ? "°C" : "°F";
    const forecasts = forecastData.map((day, index) => {
        const conditions = getWeatherDescription(day.weatherCode);
        const precipitation =
            day.precipitationProbability > 0
                ? `, ${day.precipitationProbability}% chance of precipitation`
                : "";
        return (
            `Day ${index + 1} (${day.date}): ${conditions}, ` +
            `High: ${Math.round(day.maxTemp)}${tempUnit}, ` +
            `Low: ${Math.round(day.minTemp)}${tempUnit}${precipitation}`
        );
    });

    const displayText =
        `${days}-day forecast for ${coords.name}:\n` + forecasts.join("\n");

    const historyText = `Got ${days}-day forecast for ${coords.name}`;

    const entities = [
        {
            name: coords.name,
            type: ["location"],
        },
    ];

    return createActionResultFromTextDisplay(
        displayText,
        historyText,
        entities,
    );
}

// Handler for getAlerts action
async function handleGetAlerts(
    action: Extract<WeatherAction, { actionName: "getAlerts" }>,
    context: ActionContext<WeatherActionContext>,
) {
    const { location } = action.parameters;

    // Mock alerts (typically none)
    const displayText = `No active weather alerts for ${location}`;
    const historyText = `Checked weather alerts for ${location}`;

    const entities = [
        {
            name: location,
            type: ["location"],
        },
    ];

    return createActionResultFromTextDisplay(
        displayText,
        historyText,
        entities,
    );
}

// Validate wildcard matches for cache matching
// TypeAgent calls this to verify if a wildcard parameter (like location) is valid
async function validateWeatherWildcardMatch(
    action: WeatherAction,
    context: SessionContext<WeatherActionContext>,
): Promise<boolean> {
    switch (action.actionName) {
        case "getCurrentConditions":
        case "getForecast":
        case "getAlerts":
            // Validate location parameter
            return validateLocation(action.parameters.location);
        default:
            return true;
    }
}

// Validate location string
// For now, accept any non-empty string
// Future: validate against known cities, valid zip codes, etc.
function validateLocation(location: string): boolean {
    if (!location || location.trim().length === 0) {
        return false;
    }

    // TODO: Add more sophisticated validation:
    // - Check against list of known cities
    // - Validate zip code format (5 digits or 5+4 format)
    // - Check against geocoding API for valid locations
    // - Support international location formats

    return true;
}

// Export agent instantiation function
export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeWeatherContext,
        updateAgentContext: updateWeatherContext,
        executeAction: executeWeatherAction,
        validateWildcardMatch: validateWeatherWildcardMatch,
    };
}
