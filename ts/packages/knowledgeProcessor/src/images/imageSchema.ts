// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PointOfInterest, ReverseGeocodeAddressLookup } from "common-utils";

export type Image = {
    title: string;
    caption: string;
    width: number;
    height: number;
    fileName: string;
    dateTaken: string;

    locationName?: string;
    locationAddress?: string;
    latitude?: number;
    longitude?: number;
    altitude?: number;

    exifData?: any | undefined;

    nearbyPOI?: PointOfInterest[] | undefined,
    reverseGeocode?: ReverseGeocodeAddressLookup[] | undefined
};
