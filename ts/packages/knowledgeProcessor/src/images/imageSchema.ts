// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type Image = {
    caption: string;
    width: number;
    height: number;
    fileName: string;

    locationName?: string;
    locationAddress?: string;
    latitude?: number;
    longitude?: number;
    altitude?: number;

    metaData?: any | undefined;
}