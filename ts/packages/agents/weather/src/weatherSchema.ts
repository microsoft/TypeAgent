// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type WeatherAction =
    | GetCurrentConditionsAction
    | GetForecastAction
    | GetAlertsAction;

// get the current weather conditions for a location, for example "what's the
// weather like", "what is the weather", "how's the weather in Seattle",
// "current conditions", "check the weather outside".
export type GetCurrentConditionsAction = {
    actionName: "getCurrentConditions";
    parameters: {
        location: string;
        units?: "celsius" | "fahrenheit";
    };
};

// get the weather forecast (optionally for a number of days) for a location,
// for example "what's the forecast", "weather forecast for tomorrow",
// "forecast for the next 5 days in Chicago".
export type GetForecastAction = {
    actionName: "getForecast";
    parameters: {
        location: string;
        days?: number; // 1-7 days
        units?: "celsius" | "fahrenheit";
    };
};

// get active weather alerts/warnings for a location, for example "weather
// alerts", "any storm warnings", "check alerts for Miami".
export type GetAlertsAction = {
    actionName: "getAlerts";
    parameters: {
        location: string;
    };
};
