// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AuthTokenProvider,
    AzureTokenScopes,
    createAzureTokenProvider,
    getEnvSetting,
} from "aiclient";
import { StringArrayTag, TypedTag, XmpTag } from "exifreader";
import { ApiSettings, EnvVars } from "../../aiclient/dist/openai.js";
import { env } from "process";
import {
    GeoJsonFeature,
    GeoJsonFeatureCollection,
    SearchAddressResult,
    SearchAddressResultItem,
} from "@azure/maps-search";
import { AddressOutput } from "@azure-rest/maps-search";

/**
 * Point of interest
 */
export type PointOfInterest = {
    name?: String | undefined;
    categories?: String[] | undefined;
    freeFormAddress?: String | undefined;
    position?: LatLong | undefined;
};

/**
 * Reverse geocode lookup
 */
export type ReverseGeocodeAddressLookup = {
    address?: AddressOutput | undefined;
    confidence?: "High" | "Medium" | "Low" | undefined;
    type: any;
};

/**
 * Latitude, longitude coordinates
 */
export type LatLong = {
    latitude: Number | String | undefined;
    longitude: Number | String | undefined;
};

/**
 * Helper method to convert EXIF tags to Latlong type
 * @param exifLat - The exif latitude.
 * @param exifLatRef - The exif latitude reference.
 * @param exifLong  - The exif longitude
 * @param exifLongRef - The exif longitude reference.
 * @returns The LatLong represented by the EXIF tag or undefined when data is incomplete
 */
export function exifGPSTagToLatLong(
    exifLat:
        | XmpTag
        | TypedTag<[[number, number], [number, number], [number, number]]>
        | undefined,
    exifLatRef: XmpTag | StringArrayTag | undefined,
    exifLong:
        | XmpTag
        | TypedTag<[[number, number], [number, number], [number, number]]>
        | undefined,
    exifLongRef: XmpTag | StringArrayTag | undefined,
): LatLong | undefined {
    if (
        exifLat !== undefined &&
        exifLong !== undefined &&
        exifLatRef !== undefined &&
        exifLongRef !== undefined
    ) {
        return {
            latitude:
                exifLatRef.value == "S"
                    ? parseFloat("-" + exifLat.description)
                    : parseFloat(exifLat.description),
            longitude:
                exifLongRef.value == "W"
                    ? parseFloat("-" + exifLong.description)
                    : parseFloat(exifLong.description),
        };
    }

    return undefined;
}

/**
 * Gets the nearby POIs for the supplied coordinate and search radius
 * @param position - the position at which to do a nearby search
 * @param settings - the API settings containing the endpoint to call
 * @param radius - the search radius
 * @returns A list of summarized nearby POIs
 */
export async function findNearbyPointsOfInterest(
    position: LatLong | undefined,
    settings: ApiSettings,
    radius: Number = 10,
): Promise<PointOfInterest[]> {
    if (position === undefined) {
        return [];
    }

    const tokenProvider: AuthTokenProvider = createAzureTokenProvider(
        AzureTokenScopes.AzureMaps,
    );
    const tokenResult = await tokenProvider.getAccessToken();
    if (!tokenResult.success) {
        return [];
    }

    try {
        //let fuzzySearch = `${getEnvSetting(env, EnvVars.AZURE_MAPS_ENDPOINT)}search/fuzzy/json?api-version=1.0&query={lat,long}`
        //let poi = `${getEnvSetting(env, EnvVars.AZURE_MAPS_ENDPOINT)}search/poi/{format}?api-version=1.0&lat={LAT}&lon={LON}`
        const nearby = `${getEnvSetting(env, EnvVars.AZURE_MAPS_ENDPOINT)}search/nearby/json?api-version=1.0&lat=${position.latitude}&lon=${position.longitude}&radius=${radius}`;
        const options: RequestInit = {
            method: "GET",
            headers: new Headers({
                Authorization: `Bearer ${tokenResult.data}`,
                "x-ms-client-id": `${getEnvSetting(env, EnvVars.AZURE_MAPS_CLIENTID)}`,
            }),
        };

        // get the result
        const response = await fetch(nearby, options);
        let responseBody = await response.json();

        // summarize results
        const results: SearchAddressResult =
            responseBody as SearchAddressResult;
        const retVal: PointOfInterest[] = [];
        results.results.map((result: SearchAddressResultItem) => {
            if (result.type == "POI") {
                retVal.push({
                    name: result.pointOfInterest?.name,
                    categories: result.pointOfInterest?.categories,
                    freeFormAddress: result.address.freeformAddress,
                    position: {
                        latitude: result.position[0],
                        longitude: result.position[1],
                    },
                });
            } else {
                // TODO: handle more result types
                throw new Error("Unknown nearby search result!");
            }
        });

        // TODO: if there are no POI, can we just send back the address?
        // Do we increase POI search radius until we find something in some predefined maximum area?
        return retVal;
    } catch (e) {
        console.warn(`Error performing nearby POI lookup: ${e}`);
        return [];
    }
}

export async function reverseGeocode(
    position: LatLong | undefined,
    settings: ApiSettings,
): Promise<ReverseGeocodeAddressLookup[]> {
    if (position === undefined) {
        return [];
    }

    const tokenProvider: AuthTokenProvider = createAzureTokenProvider(
        AzureTokenScopes.AzureMaps,
    );
    const tokenResult = await tokenProvider.getAccessToken();
    if (!tokenResult.success) {
        return [];
    }

    try {
        let reverseGeocode = `${getEnvSetting(env, EnvVars.AZURE_MAPS_ENDPOINT)}reverseGeocode?api-version=2023-06-01&coordinates=${position.longitude},${position.latitude}`;

        const options: RequestInit = {
            method: "GET",
            headers: new Headers({
                Authorization: `Bearer ${tokenResult.data}`,
                "x-ms-client-id": `${getEnvSetting(env, EnvVars.AZURE_MAPS_CLIENTID)}`,
            }),
        };

        // get the result
        const response = await fetch(reverseGeocode, options);
        let responseBody = await response.json();

        // summarize results
        const results: GeoJsonFeatureCollection =
            responseBody as GeoJsonFeatureCollection;
        const retVal: ReverseGeocodeAddressLookup[] = [];
        results.features?.map((result: GeoJsonFeature) => {
            if (result.properties !== undefined) {
                retVal.push({
                    address: result.properties.address,
                    confidence: result.properties.confidence,
                    type: result.properties.type,
                });
            }
        });

        return retVal;
    } catch (e) {
        console.warn(`Unable to perform reverse geocode lookup: ${e}`);
        return [];
    }
}
