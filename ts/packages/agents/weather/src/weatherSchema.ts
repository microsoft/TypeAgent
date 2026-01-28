// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type WeatherAction =
    | GetCurrentConditionsAction
    | GetForecastAction
    | GetAlertsAction;

export type GetCurrentConditionsAction = {
    actionName: "getCurrentConditions";
    parameters: {
        location: string;
        units?: "celsius" | "fahrenheit";
    };
};

export type GetForecastAction = {
    actionName: "getForecast";
    parameters: {
        location: string;
        days?: number; // 1-7 days
        units?: "celsius" | "fahrenheit";
    };
};

export type GetAlertsAction = {
    actionName: "getAlerts";
    parameters: {
        location: string;
    };
};
