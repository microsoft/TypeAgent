// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Storage } from "@typeagent/agent-sdk";
import { AuthTokenProvider, AzureTokenScopes, createAzureTokenProvider, getBlob } from "aiclient";
import ExifReader from "exifreader";
import { ApiSettings } from "../../aiclient/dist/openai.js";

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
    let testUri = "https://agentmaps.microsoft.com/reverseGeocode?api-version=2023-06-01&coordinates=47.64210088640227,-122.14197703742589";
    console.log(testUri);

    const tokenProvider: AuthTokenProvider = createAzureTokenProvider(AzureTokenScopes.AzureMaps);
    const tokenResult = await tokenProvider.getAccessToken();
    if (!tokenResult.success) {
        return;
    }
    // apiHeaders = {
    //     Authorization: `Bearer ${tokenResult.data}`,
    // };

    try {
        const response = await fetch(
            testUri,
                // {
                //       headers: tokenResult.data
                //   }
        );
        return response;
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
