// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function getFileExtensionForMimeType(mime: string): string {
    switch (mime) {
        case "image/png":
            return ".png";
        case "image/jpeg":
            return ".jpeg";
    }

    throw "Unsupported MIME type"!;
}
