# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import subprocess
import sys

# Ensure required dependencies are installed
required_packages = ["pdfplumber", "pymupdf"]
for package in required_packages:
    try:
        __import__(package)
    except ImportError:
        print(f"Installing missing package: {package}...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", package])

import pdfplumber # type: ignore
import fitz # type: ignore
import json
import os
import datetime
import csv
from dataclasses import dataclass
from typing import List, Dict, Any, Optional

IdType = str

@dataclass
class Blob:
    """A sequence of text, table, or image data plus metadata."""
    type: str  # "text", "table", "image"
    content: Any  # Text (list of lines), table (list of lists), image path (str)
    start: int  # Page number (0-based)
    bbox: Optional[List[float]] = None  # Bounding box if applicable

    def to_dict(self) -> Dict[str, Any]:
        result = {
            "type": self.type,
            "content": self.content,
            "start": self.start,
        }
        if self.bbox:
            result["bbox"] = self.bbox
        return result

@dataclass
class Chunk:
    """A chunk at any level of nesting (root, inner, leaf)."""
    id: IdType
    pageid: IdType
    blobs: List[Blob]  # Blobs around the placeholders
    parentId: IdType
    children: List[IdType]  # len() is one less than len(blobs)

    def to_dict(self) -> Dict[str, object]:
        return {
            "id": self.id,
            "pageid": self.pageid,
            "blobs": [blob.to_dict() for blob in self.blobs],
            "parentId": self.parentId,
            "children": self.children,
        }

@dataclass
class ChunkedFile:
    """A file with extracted chunks."""
    file_name: str
    chunks: List[Chunk]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "file_name": self.file_name,
            "chunks": [chunk.to_dict() for chunk in self.chunks],
        }

class PDFChunker:
    def __init__(self, file_path: str, output_dir: str = "output"):
        self.file_path = file_path
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)

    def generate_id(self) -> str:
        return datetime.datetime.now().strftime("%Y%m%d-%H%M%S.%f")

    def extract_text_chunks(self, pdf, by_paragraph: bool = True) -> List[Chunk]:
        chunks = []
        for page_num, page in enumerate(pdf.pages):
            text = page.extract_text()
            if text:
                lines = text.split("\n")
                chunk_id = self.generate_id()
                if by_paragraph:
                    paragraphs = text.split("\n\n")
                    blobs = [Blob("text", para.split("\n"), page_num) for para in paragraphs]
                else:
                    blobs = [Blob("text", lines, page_num)]
                chunks.append(Chunk(chunk_id, str(page_num), blobs, "", []))
        return chunks

    def extract_tables(self, pdf) -> List[Chunk]:
        chunks = []
        for page_num, page in enumerate(pdf.pages):
            tables = page.extract_tables()
            for table in tables:
                table_path = os.path.join(self.output_dir, f"table_{page_num}_{self.generate_id()}.csv")
                with open(table_path, "w", newline="") as f:
                    writer = csv.writer(f)
                    writer.writerows(table)
                chunk_id = self.generate_id()
                blobs = [Blob("table", table_path, page_num)]
                chunks.append(Chunk(chunk_id, str(page_num), blobs, "", []))
        return chunks

    def extract_images(self) -> List[Chunk]:
        chunks = []
        doc = fitz.open(self.file_path)
        for page_num in range(len(doc)):
            for img_index, img in enumerate(doc[page_num].get_images(full=True)):
                xref = img[0]
                pix = fitz.Pixmap(doc, xref)
                img_path = os.path.join(self.output_dir, f"image_{page_num}_{img_index}.png")
                pix.save(img_path)
                bbox = list(doc[page_num].get_image_bbox(xref))
                chunk_id = self.generate_id()
                blobs = [Blob("image", img_path, page_num, bbox)]
                chunks.append(Chunk(chunk_id, str(page_num), blobs, "", []))
        return chunks

    def chunkify(self, by_paragraph: bool = True) -> ChunkedFile:
        with pdfplumber.open(self.file_path) as pdf:
            text_chunks = self.extract_text_chunks(pdf, by_paragraph)
            table_chunks = self.extract_tables(pdf)
        image_chunks = self.extract_images()
        all_chunks = text_chunks + table_chunks + image_chunks
        return ChunkedFile(self.file_path, all_chunks)

    def save_json(self, output_path: str, by_paragraph: bool = True):
        chunked_file = self.chunkify(by_paragraph)
        with open(output_path, "w") as f:
            json.dump(chunked_file.to_dict(), f, indent=2)

# Example usage
if __name__ == "__main__":
    pdf_path = "sample.pdf"
    output_json = "output.json"
    chunker = PDFChunker(pdf_path)
    chunker.save_json(output_json)
