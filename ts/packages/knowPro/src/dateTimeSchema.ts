// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DateVal = {
    day: number;
    month: number;
    year: number;
};

export type TimeVal = {
    // In 24 hour form
    hour: number;
    minute: number;
    seconds: number;
};

export type DateTime = {
    date: DateVal;
    time?: TimeVal | undefined;
};

export type DateTimeRange = {
    startDate: DateTime;
    stopDate?: DateTime | undefined;
};
