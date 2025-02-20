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
from pathlib import Path

IdType = str

@dataclass
class Blob:
    """Stores text, table, or image data plus metadata."""
    blob_type: str  # e.g. "text", "table", "image"
    content: Any  # e.g. list of lines, or path to a CSV
    start: int  # Page number (0-based)
    bbox: Optional[List[float]] = None
    img_path: Optional[str] = None
    para_id: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        result = {
            "blob_type": self.blob_type,
            "content": self.content,
            "start": self.start
        }
        if self.bbox:
            result["bbox"] = self.bbox
        if self.img_path:
            result["img_path"] = self.img_path
        if self.para_id is not None:
            result["para_id"] = self.para_id
        return result


@dataclass
class Chunk:
    """A chunk at any level of nesting (e.g., a page, a paragraph, a table)."""
    id: str
    pageid: str
    blobs: List[Blob]
    parentId: str
    children: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "pageid": self.pageid,
            "blobs": [blob.to_dict() for blob in self.blobs],
            "parentId": self.parentId,
            "children": self.children
        }


@dataclass
class ChunkedFile:
    """A file with chunks."""
    fileName: str
    chunks: List[Chunk]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "fileName": self.fileName,
            "chunks": [chunk.to_dict() for chunk in self.chunks]
        }

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

def get_FNameWithoutExtension(file_path: str) -> str:
    return Path(file_path).stem

class PDFChunker:
    def __init__(self, file_path: str, output_dir: str = "output"):
        self.file_path = file_path
        self.pdf_name = get_FNameWithoutExtension(file_path)
        self.output_dir = Path(output_dir) / self.pdf_name
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def extract_text_chunks(self, do_ocr: bool = False) -> tuple[list[Chunk], dict[int, Chunk]]:

        def parse_paragraphs(raw_text: str) -> list[list[str]]:
            """Split raw_text into paragraphs (list of lines) using blank lines as separators."""
            paragraphs: list[list[str]] = []
            current_para: list[str] = []
            for line in raw_text.split("\n"):
                if line.strip() == "":
                    if current_para:
                        paragraphs.append(current_para)
                        current_para = []
                else:
                    current_para.append(line)
            if current_para:
                paragraphs.append(current_para)
            return paragraphs

        def chunk_paragraph(paragraph_lines: list[str], max_tokens: int = 200) -> list[list[str]]:
            """
            Split a paragraph (list of lines) into sub-chunks if token count exceeds max_tokens.
            For simplicity, each sub-chunk is stored as a single line in a list.
            """
            joined_text = " ".join(paragraph_lines)
            tokens = joined_text.split()
            result: list[list[str]] = []

            start_idx = 0
            while start_idx < len(tokens):
                sub_tokens = tokens[start_idx : start_idx + max_tokens]
                start_idx += max_tokens
                result.append([" ".join(sub_tokens)])
            return result

        # -------------------- Main Logic --------------------
        doc = fitz.open(self.file_path)
        chunks: list[Chunk] = []
        page_chunks: dict[int, Chunk] = {}

        for page_num in range(len(doc)):
            page = doc[page_num]
            raw_text = page.get_text("text")  # Using 'text' to preserve spacing

            # Create a parent chunk for this page
            page_chunk_id = generate_id()
            page_chunk = Chunk(
                id=page_chunk_id,
                pageid=str(page_num),
                blobs=[],
                parentId="",
                children=[]
            )
            page_chunks[page_num] = page_chunk
            chunks.append(page_chunk)

            # 1) Save page as image
            pix = page.get_pixmap()
            page_image_path = os.path.join(self.output_dir, f"page_{page_num}.png")
            pix.save(page_image_path)

            # 2) Store page_image blob in the page chunk
            page_image_blob = Blob(
                blob_type="page_image",
                content=None,         # No direct text
                start=page_num,
                bbox=None,
                img_path=page_image_path
            )
            page_chunk.blobs.append(page_image_blob)

            # 3) If do_ocr is True, run Tesseract on the page image
            if do_ocr:
                try:
                    from PIL import Image
                    import pytesseract
                    ocr_text = pytesseract.image_to_string(Image.open(page_image_path))
                    ocr_text = ocr_text.strip()

                    if ocr_text:
                        page_ocr_blob = Blob(
                            blob_type="page_ocr",
                            content=[ocr_text],
                            start=page_num
                        )
                        page_chunk.blobs.append(page_ocr_blob)
                except Exception as e:
                    print(f"OCR failed on page {page_num}: {e}")

            # 4) If there's text, parse paragraphs
            if raw_text:
                paragraphs = parse_paragraphs(raw_text)

                para_id = 0
                for paragraph_lines in paragraphs:
                    # Optionally split large paragraphs
                    splitted = chunk_paragraph(paragraph_lines, max_tokens=200)

                    for sub_para in splitted:
                        para_chunk_id = generate_id()
                        para_blob = Blob(
                            blob_type="text",
                            content=sub_para,
                            start=page_num,
                            para_id=para_id
                        )
                        para_chunk = Chunk(
                            id=para_chunk_id,
                            pageid=str(page_num),
                            blobs=[para_blob],
                            parentId=page_chunk_id,
                            children=[]
                        )
                        page_chunk.children.append(para_chunk_id)
                        chunks.append(para_chunk)

                        para_id += 1
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
            #table_chunks = self.extract_tables(pdf, page_chunks=page_chunks)
            image_chunks = self.extract_images(page_chunks)
        all_chunks = text_chunks + image_chunks
        return all_chunks

    def save_json(self, output_path: str) -> list[Chunk] | ErrorItem:
        all_chunks = self.chunkify()
        if (all_chunks is None) or isinstance(all_chunks, ErrorItem):
            return all_chunks
        chunked_file = ChunkedFile(self.file_path, all_chunks)
        with open(output_path, "w") as f:
            json.dump(chunked_file, f, default=custom_json, indent=2)
        return all_chunks
    
def ensure_directory_exists(directory: str) -> str:
    """Ensure the specified directory exists, creating it if necessary."""
    if not os.path.exists(directory):
        os.makedirs(directory)
    return directory
    
def parse_args(args):
    """Parse command-line arguments for -files and -outdir."""
    input_files = []
    output_folder = None

    if "-files" in args:
        files_index = args.index("-files") + 1
        while files_index < len(args) and not args[files_index].startswith("-"):
            input_files.append(os.path.abspath(args[files_index]))
            files_index += 1

    if "-outdir" in args:
        outdir_index = args.index("-outdir") + 1
        if outdir_index < len(args):
            output_folder = ensure_directory_exists(os.path.abspath(args[outdir_index]))

    return input_files, output_folder

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 -X utf8 pdfChunker.py -files FILE [FILE] ... -outdir OUTPUT_FOLDER")
        return 2

    input_files, output_folder = parse_args(sys.argv[1:])
    if not input_files or not output_folder:
        print("Error: Missing input files or output folder.")
        return 2

    items: list[ErrorItem | ChunkedFile] = []
    for filename in input_files:
        if not os.path.exists(filename):
            items.append(ErrorItem(f"File not found: {filename}", filename))
            continue

        try:
            # Ensure it's a PDF before processing
            if not filename.lower().endswith(".pdf"):
                items.append(ErrorItem(f"Invalid file type: {filename}", filename))
                continue

            # Process PDF and save JSON output in output_folder
            chunker = PDFChunker(filename, output_folder)
            output_json = os.path.join(chunker.output_dir, os.path.basename(filename) + "-chunked.json")
            result = chunker.save_json(output_json)

            if isinstance(result, ErrorItem):
                items.append(result)
            else:
                chunks = [chunk for chunk in result if chunk.blobs]
                items.append(ChunkedFile(filename, chunks))

        except IOError as err:
            items.append(ErrorItem(str(err), filename))

    # Save a summary JSON file in the output folder
    summary_json_path = os.path.join(output_folder, "summary.json")
    with open(summary_json_path, "w", encoding="utf-8") as f:
        json.dump(items, f, default=custom_json, indent=2)

    print(json.dumps(items, default=custom_json, indent=2))
    return 0

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)