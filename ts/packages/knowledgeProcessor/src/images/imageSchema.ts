// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    PointOfInterest,
    ReverseGeocodeAddressLookup,
} from "common-utils";
import { KnowledgeResponse } from "../conversation/knowledgeSchema.js";

export type Image = {
    title: string;
    altText: string;
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

    nearbyPOI?: PointOfInterest[] | undefined;
    reverseGeocode?: ReverseGeocodeAddressLookup[] | undefined;

    knowledge?: KnowledgeResponse | undefined;
};
