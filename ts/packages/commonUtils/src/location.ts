// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AuthTokenProvider,
    AzureTokenScopes,
    createAzureTokenProvider,
    getEnvSetting,
    openai,
} from "aiclient";
import { StringArrayTag, TypedTag, XmpTag } from "exifreader";
import { env } from "process";
import { AddressOutput } from "@azure-rest/maps-search";

// Maps token provider
const tokenProvider: AuthTokenProvider = createAzureTokenProvider(
    AzureTokenScopes.AzureMaps,
);

/**
 * Point of interest
 */
export type PointOfInterest = {
    name?: string | undefined;
    categories?: string[] | undefined;
    freeFormAddress?: string | undefined;
    position?: LatLong | undefined;
    distance?: number | undefined;
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
    latitude: Number | string | undefined;
    longitude: Number | string | undefined;
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
 * Gets the nearby POIs for the supplied coordinate and search radius. Will do a
 * progressive search of increasing radius until maxSearchRadius is reached or
 * a singular result is found.  Whichever occurs first.
 * @param position - the position at which to do a nearby search
 * @param settings - the API settings containing the endpoint to call
 * @param maxSearchRadius - the search radius
 * @param minResultCount - the minimum # of results to find before returning
 * or the search radius is reached.  Whichever occurs first
 * @returns A list of summarized nearby POIs
 */
export async function findNearbyPointsOfInterest(
    position: LatLong | undefined,
    settings: openai.ApiSettings,
    maxSearchRadius: number = 10000,
    minResultCount: number = 1,
): Promise<PointOfInterest[]> {
    if (position === undefined) {
        return [];
    }

    try {
        const tokenResult = await tokenProvider.getAccessToken();
        if (!tokenResult.success) {
            console.warn("Unable to acquire AzureMaps token");
            return [];
        }

        // increasing radius to search
        const radii: Array<number> = [5, 10, 25, 50, 100, 1000, 10000];
        let index: number = 0;

        do {
            //let fuzzySearch = `${getEnvSetting(env, EnvVars.AZURE_MAPS_ENDPOINT)}search/fuzzy/json?api-version=1.0&query={lat,long}`
            //let poi = `${getEnvSetting(env, EnvVars.AZURE_MAPS_ENDPOINT)}search/poi/{format}?api-version=1.0&lat={LAT}&lon={LON}`
            const nearby = `${getEnvSetting(env, openai.EnvVars.AZURE_MAPS_ENDPOINT)}search/nearby/json?api-version=1.0&lat=${position.latitude}&lon=${position.longitude}&radius=${radii[index]}`;
            const options: RequestInit = {
                method: "GET",
                headers: new Headers({
                    Authorization: `Bearer ${tokenResult.data}`,
                    "x-ms-client-id": `${getEnvSetting(env, openai.EnvVars.AZURE_MAPS_CLIENTID)}`,
                }),
            };

            // get the result
            const response = await fetch(nearby, options);
            let responseBody = await response.json();

            // summarize results
            // TODO: update any once @azure-rest/maps-search incorporates V1 return types
            const results = responseBody as any;
            const retVal: PointOfInterest[] = [];
            results.results?.map((result: any) => {
                if (result.type == "POI") {
                    retVal.push({
                        name: result.poi?.name,
                        categories: result.poi?.categories,
                        freeFormAddress: result.address.freeformAddress,
                        position: {
                            latitude: result.position.lat,
                            longitude: result.position.lon,
                        },
                        distance: result.dist,
                    });
                } else {
                    // TODO: handle more result types
                    throw new Error("Unknown nearby search result!");
                }
            });

            // TODO: if there are no POI, can we just send back the address?
            if (retVal.length >= minResultCount) {
                return retVal;
            }
        } while (index < radii.length && radii[index++] <= maxSearchRadius);
    } catch (e) {
        console.warn(`Error performing nearby POI lookup: ${e}`);
    }

    return [];
}

export async function reverseGeocode(
    position: LatLong | undefined,
    settings: openai.ApiSettings,
): Promise<ReverseGeocodeAddressLookup[]> {
    if (position === undefined) {
        return [];
    }

    try {
        const tokenResult = await tokenProvider.getAccessToken();
        if (!tokenResult.success) {
            console.warn("Unable to acquire AzureMaps token");
            return [];
        }

        let reverseGeocode = `${getEnvSetting(env, openai.EnvVars.AZURE_MAPS_ENDPOINT)}reverseGeocode?api-version=2023-06-01&coordinates=${position.longitude},${position.latitude}`;

        const options: RequestInit = {
            method: "GET",
            headers: new Headers({
                Authorization: `Bearer ${tokenResult.data}`,
                "x-ms-client-id": `${getEnvSetting(env, openai.EnvVars.AZURE_MAPS_CLIENTID)}`,
            }),
        };

        // get the result
        const response = await fetch(reverseGeocode, options);
        let responseBody = await response.json();

        // summarize results
        // TODO: update any once @azure-rest/maps-search incorporates V1 return types
        const results = responseBody as any;
        const retVal: ReverseGeocodeAddressLookup[] = [];
        results.features?.map((result: any) => {
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
