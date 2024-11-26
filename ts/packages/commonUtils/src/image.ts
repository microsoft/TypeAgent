// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Storage } from "@typeagent/agent-sdk";
import { AuthTokenProvider, AzureTokenScopes, createAzureTokenProvider, getBlob, getEnvSetting } from "aiclient";
import ExifReader, { StringArrayTag, TypedTag, XmpTag } from "exifreader";
import { ApiSettings, EnvVars } from "../../aiclient/dist/openai.js";
//import { SearchGetReverseGeocoding200Response } from "@azure-rest/maps-search";
import { env } from "process";
import { SearchAddressResult, SearchAddressResultItem } from "@azure/maps-search";

export type PointOfInterest = {
    name?: String | undefined,
    categories?: String[] | undefined,
    freeFormAddress?: String | undefined,
    position?: LatLong | undefined
}

export type LatLong = {
    latitude: Number | String | undefined,
    longitude: Number | String | undefined
}

export class CachedImageWithDetails {
    constructor(
        public exifTags: ExifReader.Tags,
        public storageLocation: string,
        public image: string,
    ) {}
}

export function getImageElement(imgData: string): string {
    return `<img class="chat-input-image" src="${imgData}" />`;
}

export function extractRelevantExifTags(exifTags: ExifReader.Tags) {
    let tags: string = ""; 

    tags = `${exifTags.Make ? "Make: " + exifTags.Make.value : ""}
    ${exifTags.Model ? "Model: " + exifTags.Model.value : ""}
    ${exifTags.DateTime ? "Date Taken: " + exifTags.DateTime.value : ""}
    ${exifTags.OffsetTime ? "Offset Time: " + exifTags.OffsetTime.value : ""}
    ${exifTags.GPSLatitude ? "GPS Latitude: " + exifTags.GPSLatitude.description : ""}
    ${exifTags.GPSLatitudeRef ? "GPS Latitude Reference: " + exifTags.GPSLatitudeRef.value: ""}
    ${exifTags.GPSLongitude ? "GPS Longitude Reference: " + exifTags.GPSLongitude.description : ""}
    ${exifTags.GPSLongitudeRef ? "GPS Longitude Reference: " + exifTags.GPSLongitudeRef?.value : ""}
    ${exifTags.GPSAltitudeRef ? "GPS Altitude Reference: " + exifTags.GPSAltitudeRef.value : ""}
    ${exifTags.GPSAltitude ? "GPS Altitude: " + exifTags.GPSAltitude.description : ""}
    `;
    console.log(tags.replace("\n\n", "\n"));
    return tags;
}

/**
 * Dowloads the supplied uri and saves it to local session storage
 * @param uri The uri of the image to download
 * @param fileName The name of the file to save the image locally as (including relative path)
 */
export async function downloadImage(
    uri: string,
    fileName: string,
    storage: Storage,
): Promise<boolean> {
    return new Promise<boolean>(async (resolve) => {
        // save the generated image in the session store
        const blobResponse = await getBlob(uri);
        if (blobResponse.success) {
            const ab = Buffer.from(await blobResponse.data.arrayBuffer());

            storage.write(fileName, ab.toString("base64"));

            resolve(true);
        }

        resolve(false);
    });
}

export function exifGPSTagToLatLong(
    exifLat: XmpTag | TypedTag<[[number, number], [number, number], [number, number]]> | undefined, 
    exifLatRef: XmpTag | StringArrayTag | undefined, 
    exifLong: XmpTag | TypedTag<[[number, number], [number, number], [number, number]]> | undefined, 
    exifLongRef: XmpTag | StringArrayTag | undefined): LatLong | undefined {
        if (exifLat !== undefined && exifLong !== undefined && exifLatRef !== undefined && exifLongRef !== undefined) {
            return {
                latitude: exifLatRef.value == "S" ? parseFloat("-" + exifLat.description) : parseFloat(exifLat.description),
                longitude: exifLongRef.value == "W" ? parseFloat("-" + exifLong.description) : parseFloat(exifLong.description),
            }
        }

        return undefined;
}

/**
 * 
 * @param position - the position at which to do a nearby search
 * @param settings - the API settings containing the endpoint to call
 * @param radius - the search radius
 * @returns A list of summarized nearby POIs
 */
export async function findNearbyPointsOfInterest(position: LatLong | undefined, settings: ApiSettings, radius: Number = 10): Promise<PointOfInterest[]> {

    if (position === undefined) {
        return [];
    }

    const tokenProvider: AuthTokenProvider = createAzureTokenProvider(AzureTokenScopes.AzureMaps);
    const tokenResult = await tokenProvider.getAccessToken();
    if (!tokenResult.success) {
        return [];
    }

    //let fuzzySearch = `${getEnvSetting(env, EnvVars.AZURE_MAPS_ENDPOINT)}search/fuzzy/json?api-version=1.0&query=-122.14197703742589,47.64210088640227`  
    //let poi = `${getEnvSetting(env, EnvVars.AZURE_MAPS_ENDPOINT)}search/poi/{format}?api-version=1.0&lat=47.64210088640227&lon=-122.14197703742589` 
    let nearby = `${getEnvSetting(env, EnvVars.AZURE_MAPS_ENDPOINT)}search/nearby/json?api-version=1.0&lat=${position.latitude}&lon=${position.longitude}&radius=${radius}`;
    try {
        const options: RequestInit = {
            method: "GET",
            headers: new Headers({
                "Authorization": `Bearer ${tokenResult.data}`,
                "x-ms-client-id": `${getEnvSetting(env, EnvVars.AZURE_MAPS_CLIENTID)}`,
            },),
        };     
        
        // get the result        
        const response = await fetch(nearby, options);
        let responseBody = await response.json();

        // summarize results
        const results: SearchAddressResult = responseBody as SearchAddressResult;
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
                    }
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
        const ex = e as Error;
        if (ex.name && ex.name === "AbortError") {
            throw new Error(`fetch timeout -1ms`);
        } else {
            throw e;
        }
    } finally {
    }
}
