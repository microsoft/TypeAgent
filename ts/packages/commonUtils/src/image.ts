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
