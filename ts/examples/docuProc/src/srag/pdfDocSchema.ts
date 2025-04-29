// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ChunkId = string;

export interface Blob {
    /** Stores text, table, or image data plus metadata. */
    blob_type:
        | "text"
        | "table"
        | "page_image"
        | "image"
        | "image_label"
        | "table_label"; // e.g. "text", "table", "image"
    start: number; // Page number (0-based)
    content?: string | string[]; // e.g. chunk of text
    bbox?: number[]; // Optional bounding box
    img_name?: string; // Optional image name
    img_path?: string; // Optional image path
    image_chunk_ref?: string[]; // Optional reference to image chunk(s)
    para_id?: number; // Optional Paragraph ID if needed
    paraHeader?: string | string[]; // Optional paragraph header
}

export interface Chunk {
    // A chunk at any level of nesting (e.g., a page, a paragraph, an image, a table).
    // Names here must match names in pdfChunker.py.
    id: string;
    pageid: string;
    blobs: Blob[];
    parentId?: ChunkId;
    children?: ChunkId[];
    fileName?: string;
}
export interface ChunkedFile {
    fileName: string;
    chunks: Chunk[];
}
export interface ErrorItem {
    error: string;
    filename?: string;
    output?: string;
}
