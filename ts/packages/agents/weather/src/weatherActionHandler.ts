// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ActionContext,
    ActionResultSuccess,
    AppAgent,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromError,
    createStructuredResult,
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

    const conditions = getWeatherDescription(weather.weatherCode);
    const windDir = getWindDirection(weather.windDirection);

    const historyText = `Got current weather for ${coords.name}`;

    const entities = [
        {
            name: coords.name,
            type: ["location"],
        },
    ];

    return buildCurrentConditionsResult(
        coords.name,
        units,
        { ...weather, conditions, windDir },
        historyText,
        entities,
    );
}

// Build a structured current-conditions result (heading + keyValue block +
// rawData). Pure — exported for unit tests.
export function buildCurrentConditionsResult(
    locationName: string,
    units: "celsius" | "fahrenheit",
    weather: {
        temperature: number;
        apparentTemperature: number;
        humidity: number;
        windSpeed: number;
        conditions: string;
        windDir: string;
    },
    historyText: string,
    entities: { name: string; type: string[] }[],
): ActionResultSuccess {
    const tempUnit = units === "celsius" ? "°C" : "°F";
    return createStructuredResult(
        [
            {
                kind: "heading",
                level: 3,
                text: `Current conditions in ${locationName}`,
            },
            {
                kind: "keyValue",
                pairs: [
                    {
                        label: "Temperature",
                        value: `${Math.round(weather.temperature)}${tempUnit} (feels like ${Math.round(weather.apparentTemperature)}${tempUnit})`,
                    },
                    { label: "Conditions", value: weather.conditions },
                    { label: "Humidity", value: `${weather.humidity}%` },
                    {
                        label: "Wind",
                        value: `${Math.round(weather.windSpeed)} mph ${weather.windDir}`,
                    },
                ],
            },
        ],
        {
            historyText,
            entities,
            rawData: {
                location: locationName,
                units,
                temperature: weather.temperature,
                apparentTemperature: weather.apparentTemperature,
                conditions: weather.conditions,
                humidity: weather.humidity,
                windSpeed: weather.windSpeed,
                windDirection: weather.windDir,
            },
        },
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

    const historyText = `Got ${days}-day forecast for ${coords.name}`;

    const entities = [
        {
            name: coords.name,
            type: ["location"],
        },
    ];

    return buildForecastResult(
        coords.name,
        units,
        days,
        forecastData,
        historyText,
        entities,
    );
}

// Build a structured forecast result (heading + sortable table + rawData).
// Pure — exported for unit tests.
export function buildForecastResult(
    locationName: string,
    units: "celsius" | "fahrenheit",
    days: number,
    forecastData: {
        date: string;
        weatherCode: number;
        maxTemp: number;
        minTemp: number;
        precipitationProbability: number;
    }[],
    historyText: string,
    entities: { name: string; type: string[] }[],
): ActionResultSuccess {
    const tempUnit = units === "celsius" ? "°C" : "°F";
    const rows = forecastData.map((day) => {
        const conditions = getWeatherDescription(day.weatherCode);
        const precip =
            day.precipitationProbability > 0
                ? `${day.precipitationProbability}%`
                : "—";
        // Derive the weekday name from the ISO date. Append T00:00 so the
        // date is parsed in local time rather than UTC (which can shift the
        // day backward for negative-offset timezones).
        const weekday = day.date
            ? new Date(`${day.date}T00:00`).toLocaleDateString(undefined, {
                  weekday: "long",
              })
            : "";
        return [
            weekday,
            day.date,
            conditions,
            `${Math.round(day.maxTemp)}${tempUnit}`,
            `${Math.round(day.minTemp)}${tempUnit}`,
            precip,
        ];
    });

    return createStructuredResult(
        [
            {
                kind: "heading",
                level: 3,
                text: `${days}-day forecast for ${locationName}`,
            },
            {
                kind: "table",
                columns: [
                    { id: "day", header: "Weekday" },
                    { id: "date", header: "Date", type: "date" },
                    { id: "conditions", header: "Conditions" },
                    { id: "high", header: "High", align: "right" },
                    { id: "low", header: "Low", align: "right" },
                    { id: "precip", header: "Precip", align: "right" },
                ],
                rows,
                sortable: true,
            },
        ],
        {
            historyText,
            entities,
            rawData: {
                location: locationName,
                units,
                days,
                forecast: forecastData,
            },
        },
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
            return validateLocation(action.parameters.location);
        default:
            return true;
    }
}

async function validateLocation(location: string): Promise<boolean> {
    if (!location || location.trim().length === 0) {
        return false;
    }
    const coords = await geocodeLocation(location);
    return coords !== null;
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
