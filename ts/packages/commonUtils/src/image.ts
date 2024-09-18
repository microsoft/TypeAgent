// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import ExifReader from"exifreader"

export class CachedImageWithDetails {
    constructor(
        public exifTags: ExifReader.Tags, 
        public storageLocation: string, 
        public image: string) {
    }
}

export function getImageElement(imgData: string): string {
    return`<img src="${imgData}" />`;
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
console.log(tags);
    return tags;
}
