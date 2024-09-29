// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function getFileExtensionForMimeType(mime: string): string {
    switch (mime) {
        case "image/png":
            return ".png";
        case "image/jpeg":
            return ".jpeg";
        case "image/gif":
            return ".gif";
    }

    throw "Unsupported MIME type"!;
}

export function getMimeType(fileExtension: string): string {
    switch (fileExtension) {
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".png":
            return "image/png";
        case ".gif":
            return "image/gif";
    }

    throw "Unsupported file extension.";
}
