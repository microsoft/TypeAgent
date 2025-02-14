# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import os
import subprocess
import sys
import json

import pdfplumber # type: ignore
import fitz # type: ignore
import pytesseract # type: ignore
from PIL import Image # type: ignore

import datetime
import csv
from dataclasses import dataclass
from typing import List, Dict, Any, Optional

IdType = str

@dataclass
class Blob:
    type: str
    content: Any
    start: int
    bbox: Optional[List[float]] = None
    img_path: Optional[str] = None
    para_id: Optional[int] = None
    
    def to_dict(self) -> Dict[str, Any]:
        result = {"type": self.type, "content": self.content, "start": self.start}
        if self.bbox:
            result["bbox"] = self.bbox
        if self.img_path:
            result["img_path"] = self.img_path
        if self.para_id is not None:
            result["para_id"] = self.para_id
        return result

@dataclass
class Chunk:
    id: str
    pageid: str
    blobs: List[Blob]
    parentId: str
    children: List[str]
    
    def to_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "pageid": self.pageid, "blobs": self.blobs, "parentId": self.parentId, "children": self.children}

@dataclass
class ChunkedFile:
    fileName: str
    chunks: List[Chunk]
    
    def to_dict(self) -> Dict[str, Any]:
        return {"fileName": self.fileName, "chunks": self.chunks}

@dataclass
class ErrorItem:
    error: str
    fileName: str
    output: Optional[str] = None
    
    def to_dict(self) -> Dict[str, str]:
        result = {"error": self.error, "filename": self.fileName}
        if self.output:
            result["output"] = self.output
        return result
    
def custom_json(obj: object) -> dict[str, object]:
    if hasattr(obj, "to_dict"):
        return obj.to_dict()  # type: ignore
    else:
        raise TypeError(f"Cannot JSON serialize object of type {type(obj)}")
    
last_ts: datetime.datetime = datetime.datetime.now()

def generate_id() -> IdType:
    """Generate a new unique ID.

    IDs are really timestamps formatted as YYYY_MM_DD-HH_MM_SS.UUUUUU,
    where UUUUUU is microseconds.

    To ensure IDs are unique, if the next timestamp isn't greater than the last one,
    we add 1 usec to the last one. This has the advantage of "gracefully" handling
    time going backwards.
    """
    global last_ts
    next_ts = datetime.datetime.now()  # Local time, for now
    if next_ts <= last_ts:
        next_ts = last_ts + datetime.timedelta(microseconds=1)
    last_ts = next_ts
    return next_ts.strftime("%Y%m%d-%H%M%S.%f")

class PDFChunker:
    def __init__(self, file_path: str, output_dir: str = "output"):
        self.file_path = file_path
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)

    def extract_text_chunks(self) -> tuple[list[Chunk], dict[int, Chunk]]:
        """Use PyMuPDF (fitz) to extract text from each page and chunk by blank lines."""
        doc = fitz.open(self.file_path)
        chunks: list[Chunk] = []
        page_chunks: dict[int, Chunk] = {}

        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text("text")  # Using 'text' to preserve spacing

            print(f"Processing page {page_num + 1}...")
            print(f"	Text: {text[:200]}...")  # Print just a preview

            # Create a parent chunk for this page
            page_chunk_id = generate_id()
            page_chunk = Chunk(page_chunk_id, str(page_num), [], "", [])
            page_chunks[page_num] = page_chunk
            chunks.append(page_chunk)

            # If there's text, split into paragraphs at blank lines
            if text:
                paragraphs: list[tuple[int, list[str]]] = []
                current_para: list[str] = []
                para_id = 0

                # Split text by newline, detect blank lines for paragraph breaks
                for line in text.split("\n"):
                    if line.strip() == "":
                        # Blank line -> finish current paragraph
                        if current_para:
                            paragraphs.append((para_id, current_para))
                            para_id += 1
                            current_para = []
                    else:
                        # Keep the line exactly as-is
                        current_para.append(line)

                # If any leftover lines, form a final paragraph
                if current_para:
                    paragraphs.append((para_id, current_para))

                # Create child chunks for each paragraph
                for pid, para_lines in paragraphs:
                    para_chunk_id = generate_id()
                    # Store the paragraph as a list of lines
                    para_blob = Blob("text", para_lines, page_num, para_id=pid)
                    para_chunk = Chunk(
                        para_chunk_id,
                        str(page_num),
                        [para_blob],
                        page_chunk_id,
                        []
                    )
                    page_chunk.children.append(para_chunk_id)
                    chunks.append(para_chunk)

        return chunks, page_chunks


    def extract_tables(self, pdf, page_chunks) -> List[Chunk]:
        chunks = []
        for page_num, page in enumerate(pdf.pages):
            if page_num not in page_chunks:
                continue
            page_chunk = page_chunks[page_num]
            for table in page.extract_tables():
                table_path = os.path.join(self.output_dir, f"table_{page_num}_{generate_id()}.csv")
                with open(table_path, "w", newline="") as f:
                    csv.writer(f).writerows(table)
                table_chunk_id = generate_id()
                table_blob = Blob("table", table_path, page_num)
                table_chunk = Chunk(table_chunk_id, str(page_num), [table_blob], page_chunk.id, [])
                page_chunk.children.append(table_chunk_id)
                chunks.append(table_chunk)
        return chunks

    def extract_images(self, page_chunks) -> List[Chunk]:
        chunks = []
        doc = fitz.open(self.file_path)
        for page_num in range(len(doc)):
            if page_num not in page_chunks:
                continue
            page_chunk = page_chunks[page_num]
            for img_index, img in enumerate(doc[page_num].get_images(full=True)):
                xref = img[0]
                img_rect = doc[page_num].get_image_rects(xref)
                bbox = list(img_rect[0]) if img_rect else None
                img_path = os.path.join(self.output_dir, f"image_{page_num}_{img_index}.png")
                fitz.Pixmap(doc, xref).save(img_path)
                
                # Perform OCR to extract text label
                try:
                    label = pytesseract.image_to_string(Image.open(img_path)).strip()
                except Exception as e:
                    label = ""
                
                image_chunk_id = generate_id()
                image_blob = Blob("image", label, page_num, bbox=bbox, img_path=img_path)
                image_chunk = Chunk(image_chunk_id, str(page_num), [image_blob], page_chunk.id, [])
                page_chunk.children.append(image_chunk_id)
                chunks.append(image_chunk)
        return chunks

    def chunkify(self) -> ChunkedFile:
        with pdfplumber.open(self.file_path) as pdf:
            text_chunks, page_chunks = self.extract_text_chunks()
            table_chunks = self.extract_tables(pdf, page_chunks=page_chunks)
            image_chunks = self.extract_images(page_chunks)
        all_chunks = text_chunks + table_chunks + image_chunks
        return ChunkedFile(self.file_path, all_chunks)

    def save_json(self, output_path: str):
        chunked_file = self.chunkify()
        with open(output_path, "w") as f:
            print(json.dumps(chunked_file, default=custom_json, indent=2))
            json.dump(chunked_file, f, default=custom_json, indent=2)

def main():
    if len(sys.argv) < 2:
        print("Usage: python chunker.py FILE [FILE] ...")
        return 2

    output_json = "pdf-chunked-output.json"
    items: list[ErrorItem | ChunkedFile] = []
    for filename in sys.argv[1:]:
        if not os.path.exists(filename):
            items.append(ErrorItem(f"File not found: {filename}", filename))
            continue

        try:
            # Ensure it's a PDF before processing
            if not filename.lower().endswith(".pdf"):
                items.append(ErrorItem(f"Invalid file type: {filename}", filename))
                continue
            
            chunker = PDFChunker(filename)
            chunker.save_json(output_json)
        except IOError as err:
            items.append(ErrorItem(str(err), filename))

    #print(json.dumps(items, default=custom_json, indent=2))
    return 0

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)