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

export function getMimeTypeFromFileExtension(fileExtension: string): string {
    switch (fileExtension) {
        case ".css":
            return "text/css";
        case ".htm":
        case ".html":
            return "text/html";
        case ".js":
            return "text/javascript";
        case ".json":
        case ".map":
            return "application/json";
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

export function isImageMimeTypeSupported(mime: string): boolean {
    switch (mime) {
        case "image/png":
        case "image/jpg":
        case "image/jpeg":
            return true;
        default:
            return false;
    }
}

export function isImageFileType(fileExtension: string): boolean {
    if (fileExtension.startsWith(".")) {
        fileExtension = fileExtension.substring(1);
    }

    const imageFileTypes: Set<string> = new Set<string>(["png", "jpg", "jpeg"]);

    return imageFileTypes.has(fileExtension);
}
