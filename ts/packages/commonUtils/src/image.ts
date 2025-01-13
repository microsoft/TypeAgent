// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Storage } from "@typeagent/agent-sdk";
import { getBlob } from "aiclient";
import ExifReader from "exifreader";
import { MultimodalPromptContent, PromptSection, TextPromptContent } from "typechat";
import { exifGPSTagToLatLong, findNearbyPointsOfInterest, reverseGeocode } from "./location.js";
import { openai } from "aiclient";

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
    ${exifTags.GPSLatitudeRef ? "GPS Latitude Reference: " + exifTags.GPSLatitudeRef.value : ""}
    ${exifTags.GPSLongitude ? "GPS Longitude Reference: " + exifTags.GPSLongitude.description : ""}
    ${exifTags.GPSLongitudeRef ? "GPS Longitude Reference: " + exifTags.GPSLongitudeRef?.value : ""}
    ${exifTags.GPSAltitudeRef ? "GPS Altitude Reference: " + exifTags.GPSAltitudeRef.value : ""}
    ${exifTags.GPSAltitude ? "GPS Altitude: " + exifTags.GPSAltitude.description : ""}
    ${exifTags.Orientation ? "Orientation: " + exifTags.Orientation.description : ""}
    `;
    console.log(tags.replace("\n\n", "\n"));
    return tags;
}

export function extractAllExifTags(exifTags: ExifReader.Tags) {
    let tags: string = "";

    for (const key of Object.keys(exifTags)) {
        if (exifTags[key].description) {
            tags += `${key}: ${exifTags[key].description}\n`;
        }
    }

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

/**
 * Adds the supplied image to the suppled prompt section.
 * @param role - The role of this prompt section.
 * @param image - The image to adding to the prompt section.
 * @param includeFileName - Flag indicating if the file name should be included in the prompt.
 * @param includePartialExifTags - Flag indicating if EXIF tags should be included.
 * @param includeAllExifTags - Flag to indicate of all EXIF tags should be included.  Supercedes previous parameter.
 * @param includePOI  - Flag indicating if POI should be located and appended to the prompt.
 * @param includeGeocodedAddress - Flag indicating if the image location should be geocoded if it's available.
 * @returns - A prompt section representing the supplied image and related details as requested.
 */
export async function addImagePromptContent(role: "system" | "user" | "assistant", 
    image: CachedImageWithDetails, 
    includeFileName?: boolean, 
    includePartialExifTags?: boolean,
    includeAllExifTags?: boolean, 
    includePOI?: boolean, 
    includeGeocodedAddress?: boolean,
    ): Promise<PromptSection> {

    const content: MultimodalPromptContent[] = [];

    // add the image to the prompt
    content.push({
        type: "image_url",
        image_url: {
            url: image.image,
            detail: "high",
        },
    });

    // include the file name in the prompt?
    if (includeFileName !== false) {
        content.push({
            type: "text",
            text: `File Name: ${image.storageLocation}`
        } as TextPromptContent);
    }

    // include exif tags?
    if (includeAllExifTags === true) {
        content.push({
            type: "text",
            text: `Image EXIF tags: \n${extractAllExifTags(image.exifTags)}`,
            }
        );
    } else if (includePartialExifTags === true)  {
        content.push({
            type: "text",
            text: `Image EXIF tags: \n${extractRelevantExifTags(image.exifTags)}`,
            }
        );
    }

    // include POI
    if (includePOI !== false) {
        content.push(                    {
            type: "text",
            text: `Nearby Points of Interest: \n${JSON.stringify(
                await findNearbyPointsOfInterest(
                    exifGPSTagToLatLong(
                        image.exifTags.GPSLatitude,
                        image.exifTags.GPSLatitudeRef,
                        image.exifTags.GPSLongitude,
                        image.exifTags.GPSLongitudeRef,
                    ),
                    openai.apiSettingsFromEnv(),
                ),
            )}`,
        });
    }

    // include address
    if (includeGeocodedAddress !== false) {
        content.push({
                type: "text",
                text: `Reverse Geocode Results: \n${JSON.stringify(
                    await reverseGeocode(
                        exifGPSTagToLatLong(
                            image.exifTags.GPSLatitude,
                            image.exifTags.GPSLatitudeRef,
                            image.exifTags.GPSLongitude,
                            image.exifTags.GPSLongitudeRef,
                        ),
                        openai.apiSettingsFromEnv(),
                    ),
                )}`,
            },
        );
    }

    return {
        role: role,
        content: content
    };
}
