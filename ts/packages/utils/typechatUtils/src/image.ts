// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Storage } from "@typeagent/agent-sdk";
import { getBlob } from "@typeagent/aiclient";
import ExifReader from "exifreader";
import {
    MultimodalPromptContent,
    PromptSection,
    TextPromptContent,
} from "typechat";
import {
    exifGPSTagToLatLong,
    findNearbyPointsOfInterest,
    PointOfInterest,
    reverseGeocode,
    ReverseGeocodeAddressLookup,
} from "./location.js";
import { openai } from "@typeagent/aiclient";
import { getMimeTypeFromFileExtension } from "./mimeTypes.js";
import fs from "node:fs";
import path from "node:path";
import { parse } from "date-fns";
import registerDebug from "debug";

const debug = registerDebug("typeagent:typechat-utils:image");

export class CachedImageWithDetails {
    constructor(
        public exifTags: ExifReader.Tags | undefined,
        public storageLocation: string,
        public image: string,
    ) {}
}

export type ImagePromptDetails = {
    promptSection?: PromptSection | undefined;
    nearbyPOI?: PointOfInterest[] | undefined;
    reverseGeocode?: ReverseGeocodeAddressLookup[] | undefined;
};

export function getImageElement(imgData: string): string {
    return `<img class="chat-input-image" src="${imgData}" />`;
}

// Strip an attachment path down to its bare file name. The path can arrive with
// Windows (\) or POSIX (/) separators depending on its origin (an uploaded
// attachment vs. a highlighted editor file), so cut at whichever comes last.
export function getAttachmentFileName(file: string): string {
    const sep = Math.max(file.lastIndexOf("\\"), file.lastIndexOf("/"));
    return sep > -1 ? file.substring(sep + 1) : file;
}

// The image MIME type for a file name, or undefined when the extension is not a
// supported image type (or has no extension). Used to tell an embeddable image
// attachment apart from a non-image reference without touching storage.
function imageMimeType(fileName: string): string | undefined {
    const ext = fileName.substring(fileName.lastIndexOf("."));
    try {
        const mime = getMimeTypeFromFileExtension(ext);
        return mime.startsWith("image/") ? mime : undefined;
    } catch {
        return undefined;
    }
}

export function isImageAttachment(fileName: string): boolean {
    return imageMimeType(fileName) !== undefined;
}

// Build an HTML block of inline <img> data URLs for uploaded image attachments.
// Each name in `files` is read from the session's user_files staging directory
// (one level up from the calling agent's storage). Non-image references (e.g. a
// highlighted .yml from editor context) are skipped with no read, and an image
// name missing from user_files is skipped when the read fails.
export async function rehydrateImageAttachments(
    storage: Storage | undefined,
    files: (string | undefined)[],
): Promise<string> {
    let html = "<div>";

    for (const file of files) {
        if (!file) {
            continue;
        }
        const name = getAttachmentFileName(file);
        const mimeType = imageMimeType(name);
        if (mimeType === undefined) {
            continue;
        }

        try {
            // Build the path with path.join so the separators match the host;
            // a literal "\\..\\" only resolves correctly on Windows.
            const data = await storage?.read(
                path.join("..", "user_files", name),
                "base64",
            );
            if (data) {
                html += getImageElement(`data:${mimeType};base64,${data}`);
            }
        } catch (e) {
            debug(`skipping image attachment ${name}: ${e}`);
        }
    }

    html += "</div>";

    return html;
}

export function extractRelevantExifTags(exifTags: ExifReader.Tags | undefined) {
    let tags: string = "";

    if (exifTags) {
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
    }
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
 * Downloads the supplied uri and saves it to local session storage
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

            storage.write(fileName, ab);

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
export async function addImagePromptContent(
    role: "system" | "user" | "assistant",
    image: CachedImageWithDetails,
    includeFileName?: boolean,
    includePartialExifTags?: boolean,
    includeAllExifTags?: boolean,
    includePOI?: boolean,
    includeGeocodedAddress?: boolean,
): Promise<ImagePromptDetails> {
    const content: MultimodalPromptContent[] = [];
    const retValue: ImagePromptDetails = {};

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
            text: `File Name: ${image.storageLocation}`,
        } as TextPromptContent);
    }

    // include exif tags?
    if (includeAllExifTags === true && image.exifTags) {
        content.push({
            type: "text",
            text: `Image EXIF tags: \n${extractAllExifTags(image.exifTags)}`,
        });
    } else if (includePartialExifTags === true && image.exifTags) {
        content.push({
            type: "text",
            text: `Image EXIF tags: \n${extractRelevantExifTags(image.exifTags)}`,
        });
    }

    // Resolve the image's GPS position once. If the image has no GPS EXIF
    // (e.g. a webcam capture from the photo agent) skip POI / reverse-geocode
    // lookups entirely — both helpers early-return for `position === undefined`,
    // and `openai.apiSettingsFromEnv()` (which they accept but ignore) throws
    // `Missing ApiSetting: AZURE_OPENAI_ENDPOINT` when only suffixed Azure
    // deployments are configured.
    const gpsPosition = image.exifTags
        ? exifGPSTagToLatLong(
              image.exifTags.GPSLatitude,
              image.exifTags.GPSLatitudeRef,
              image.exifTags.GPSLongitude,
              image.exifTags.GPSLongitudeRef,
          )
        : undefined;

    // include POI
    if (gpsPosition !== undefined) {
        retValue.nearbyPOI = await findNearbyPointsOfInterest(
            gpsPosition,
            openai.apiSettingsFromEnv(),
        );
    }
    if (includePOI !== false) {
        content.push({
            type: "text",
            text: `Nearby Points of Interest: \n${JSON.stringify(retValue.nearbyPOI)}`,
        });
    }

    // include address
    if (gpsPosition !== undefined) {
        retValue.reverseGeocode = await reverseGeocode(
            gpsPosition,
            openai.apiSettingsFromEnv(),
        );
    }

    if (includeGeocodedAddress !== false) {
        content.push({
            type: "text",
            text: `Reverse Geocode Results: \n${JSON.stringify(retValue.reverseGeocode)}`,
        });
    }

    // set content
    retValue.promptSection = { role: role, content: content };

    return retValue;
}

/**
 * Tries to get the date the image was taken.
 * It attempts to use the filename and falls back to Exif tags.
 *
 * @param path The path to the image file whose taken date is to be ascertained
 * @returns either the date.  If the date is undeterimined returns 1/1/1900 00:00:00
 */
export function getDateTakenFuzzy(filePath: string): Date {
    const fileName: string = path.basename(filePath).toLowerCase();
    let datePart: string = fileName.substring(0, fileName.indexOf("."));
    if (fileName.startsWith("img_")) {
        datePart = fileName.substring(5);
    }

    let retValue: Date = new Date("1/1/1900 00:00:00");
    if (datePart.length != 15) {
        const buffer: Buffer = fs.readFileSync(filePath);
        const tags: ExifReader.Tags = ExifReader.load(buffer);

        // Try to get the date time from the exif tags
        if (tags.DateTime?.description) {
            retValue = parse(
                tags.DateTime.description,
                "yyyy:MM:dd hh:mm:ss",
                new Date(),
            );
        }
    } else {
        retValue.setFullYear(
            parseInt(datePart.substring(0, 4)),
            parseInt(datePart.substring(4, 6)) - 1,
            parseInt(datePart.substring(6, 8)),
        );

        retValue.setHours(
            parseInt(datePart.substring(9, 11)),
            parseInt(datePart.substring(11, 13)),
            parseInt(datePart.substring(13, 15)),
        );
    }

    return retValue;
}
