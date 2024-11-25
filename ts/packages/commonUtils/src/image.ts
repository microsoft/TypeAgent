// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Storage } from "@typeagent/agent-sdk";
import { AuthTokenProvider, AzureTokenScopes, createAzureTokenProvider, getBlob, getEnvSetting } from "aiclient";
import ExifReader from "exifreader";
import { ApiSettings, apiSettingsFromEnv, EnvVars } from "../../aiclient/dist/openai.js";
import { SearchGetReverseGeocoding200Response } from "@azure-rest/maps-search";
import { env } from "process";

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

    // TEST API call
    const settings: ApiSettings = apiSettingsFromEnv();
    reverseGeocodeLookup(settings).then((response) => { console.log(response); })    

    tags = `${exifTags.Make ? "Make: " + exifTags.Make.value : ""}
    ${exifTags.Model ? "Model: " + exifTags.Model.value : ""}
    ${exifTags.DateTime ? "Date Taken: " + exifTags.DateTime.value : ""}
    ${exifTags.OffsetTime ? "Offset Time: " + exifTags.OffsetTime.value : ""}
    ${exifTags.GPSLatitude ? "GPS Latitude: " + exifTags.GPSLatitude.description : ""}
    ${exifTags.GPSLongitude ? "GPS Longitude: " + exifTags.GPSLongitude.description : ""}
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

export async function reverseGeocodeLookup(settings: ApiSettings) {
    let endpoint = `${getEnvSetting(env, EnvVars.AZURE_MAPS_ENDPOINT)}reverseGeocode?api-version=2023-06-01&coordinates=47.64210088640227,-122.14197703742589"`;
    console.log(endpoint);

    const tokenProvider: AuthTokenProvider = createAzureTokenProvider(AzureTokenScopes.AzureMaps);
    const tokenResult = await tokenProvider.getAccessToken();
    if (!tokenResult.success) {
        return;
    }

    // TODO: implement using mapsearch typescript lib - https://learn.microsoft.com/en-us/javascript/api/%40azure-rest/maps-search/?view=azure-node-preview    
    try {
        const options: RequestInit = {
            method: "GET",
            headers: new Headers({
                "Authorization": `Bearer ${tokenResult.data}`,
                "x-ms-client-id": `${getEnvSetting(env, EnvVars.AZURE_MAPS_CLIENTID)}`,
            },),
        };     
        
        const response = await fetch(endpoint, options);
        let responseBody = await response.json();

        const g : SearchGetReverseGeocoding200Response = responseBody as SearchGetReverseGeocoding200Response;
        console.log(g);

        return responseBody;
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
