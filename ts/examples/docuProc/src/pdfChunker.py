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
import re

IdType = str

@dataclass
class Blob:
    """Stores text, table, or image data plus metadata."""
    blob_type: str  # e.g. "text", "table", "image"
    start: int  # Page number (0-based)
    content: Optional[str] = None  # e.g. list of lines, or path to a CSV
    bbox: Optional[List[float]] = None
    img_path: Optional[str] = None
    para_id: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        result = {
            "blob_type": self.blob_type,
            "start": self.start
        }
        if self.content is not None:
            result["content"] = self.content
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
    def __init__(self, file_path: str, output_dir: str = "output", debug: bool = False):
        self.debug = debug
        self.file_path = file_path
        self.pdf_name = get_FNameWithoutExtension(file_path)
        self.output_dir = Path(output_dir) / self.pdf_name
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def debug_print_lines(self, chunks: List[Chunk]) -> None:
        """
        Debug helper: Print how many lines we see in each text blob, 
        and optionally print the first few characters of each line.
        """
        for c_idx, chunk in enumerate(chunks):
            for b_idx, blob in enumerate(chunk.blobs):
                if blob.blob_type == "text" and isinstance(blob.content, str):
                    lines = blob.content.split("\n")
                    print(f"Chunk #{c_idx}, Blob #{b_idx}, lines found = {len(lines)}")
                    for i, line in enumerate(lines):
                        print(f"  Line {i} (length={len(line)}): {line[:50]}...")

    def remove_blank_lines(self, chunks: List[Chunk]) -> List[Chunk]:
        """
        Remove any blank/whitespace-only lines from text blobs.
        """
        for chunk in chunks:
            for blob in chunk.blobs:
                if blob.blob_type == "text" and isinstance(blob.content, str):
                    lines = blob.content.split("\n")
                    lines = [ln for ln in lines if ln.strip()]  # keep only non-empty
                    blob.content = "\n".join(lines)
        return chunks
    
    def get_lines_from_dict(self, page: fitz.Page) -> list[str]:
        # Thresholds for merging lines
        Y_THRESHOLD = 2.0  # e.g., lines whose y-mid differs by less than ~2 points
        X_GAP_THRESHOLD = 15.0
        PARA_GAP_THRESHOLD = 10.0  # Only insert a paragraph break if gap >= 10 points
        PARA_MARKER = "<PARA_BREAK>"

        data = page.get_text("dict")  # <-- NEW: structured data
        line_entries = []

        # Extract image and table bounding boxes on the page
        image_bboxes = [img["bbox"] for img in data.get("images", [])]
        table_bboxes = [tbl["bbox"] for tbl in data.get("tables", [])] if "tables" in data else []
        
        for block in data["blocks"]:
            if block["type"] == 0:  # text block
                for ln in block["lines"]:
                    # Combine all spans into one string
                    line_text = "".join(span["text"] for span in ln["spans"]).strip()
                    if not line_text:
                        continue

                    # Get the bounding box for the line: [x0, y0, x1, y1]
                    x0, y0, x1, y1 = ln["bbox"]
                    is_image_label = any(
                    (y0 >= img_y0 - 10 and y1 <= img_y1 + 10) and  
                    (x0 >= img_x0 and x1 <= img_x1)  
                    for img_x0, img_y0, img_x1, img_y1 in image_bboxes
                    )

                    # Check if text is near a table
                    is_table_label = any(
                        (y0 >= tbl_y0 - 10 and y1 <= tbl_y1 + 10) and  
                        (x0 >= tbl_x0 and x1 <= tbl_x1)  
                        for tbl_x0, tbl_y0, tbl_x1, tbl_y1 in table_bboxes
                    )

                    # Assign label based on detected type
                    if is_image_label:
                        label = "image"
                    elif is_table_label:
                        label = "table"
                    else:
                        label = "text"

                    line_entries.append({
                        "text": line_text,
                        "x0": x0,
                        "y0": y0,
                        "x1": x1,
                        "y1": y1,
                        "label": label
                    })

        # Sort the line_entries top-to-bottom, then left-to-right.
        line_entries.sort(key=lambda e: (e["y0"], e["x0"]))

        merged_lines: list[str] = []
        i = 0
        while i < len(line_entries):
            current = line_entries[i]
            current_text = current["text"]
            current_label = current["label"]
            x0_c, y0_c, x1_c, y1_c = current["x0"], current["y0"], current["x1"], current["y1"]

            # Look ahead to see if the next line should be merged with the current one.
            if i < len(line_entries) - 1:
                next_line = line_entries[i + 1]
                x0_n, y0_n, x1_n, y1_n, text_n, label_n = next_line["x0"], next_line["y0"], next_line["x1"], next_line["y1"], next_line["text"], next_line["label"]

                # Compute mid-Y for merging decision.
                midY_c = (y0_c + y1_c) / 2.0
                midY_n = (y0_n + y1_n) / 2.0
                y_diff = abs(midY_c - midY_n)

                if y_diff < Y_THRESHOLD:
                    x_gap = x0_n - x1_c
                    if 0 <= x_gap < X_GAP_THRESHOLD:
                        # Merge these lines
                        unified_text = current_text.rstrip() + " " + text_n.lstrip()
                        new_entry = {
                            "text": unified_text,
                            "x0": x0_c,
                            "y0": min(y0_c, y0_n),
                            "x1": x1_n,
                            "y1": max(y1_c, y1_n),
                            "label": current_label if current_label != "text" else label_n
                        }
                        line_entries[i] = new_entry
                        del line_entries[i + 1]
                        continue  # check current index again in case further merging is needed

            # Append the current line.
            merged_lines.append(current_text)

            # Instead of using mid-Y difference, compute the vertical gap
            # between the bottom of the current line and the top of the next line.
            if i < len(line_entries) - 1:
                next_line = line_entries[i + 1]
                gap = next_line["y0"] - current["y1"]
                if gap >= PARA_GAP_THRESHOLD:
                    merged_lines.append(PARA_MARKER)
            i += 1

        return merged_lines
  
    def extract_text_chunks(self, do_ocr: bool = False) -> tuple[list[Chunk], dict[int, Chunk]]:
        def split_paragraphs(lines: list[str]) -> list[list[str]]:
            paragraphs = []
            current_par = []
            for line in lines:
                if line.strip() == "<PARA_BREAK>":
                    if current_par:
                        paragraphs.append(current_par)
                        current_par = []
                    # optionally keep a marker here if needed (e.g., append an empty list) 
                    # but here we simply use it to break paragraphs.
                else:
                    current_par.append(line)
            if current_par:
                paragraphs.append(current_par)
            return paragraphs

        # Updated merge function that checks if a candidate header is followed by a large paragraph chunk.
        def merge_single_line_headings(paragraphs: list[list[str]]) -> list[list[str]]:
            merged_pars: list[list[str]] = []
            i = 0
            while i < len(paragraphs):
                current_par = paragraphs[i]
                if len(current_par) == 1:
                    line = current_par[0].strip()
                    # Check if the line is a potential header candidate.
                    if line and (len(line.split()) <= 10) and (line[-1] not in ".?!"):
                        # Candidate header found.
                        if i + 1 < len(paragraphs):
                            next_par = paragraphs[i + 1]
                            # Define "large" as either having multiple lines or a single line with >10 words.
                            if (len(next_par) > 1) or (len(next_par) == 1 and len(next_par[0].split()) > 10):
                                # Merge: Prepend header (wrapped in [ ]) with a colon to the next paragraph.
                                next_par[0] = f"[{line}]: " + next_par[0]
                                merged_pars.append(next_par)
                                i += 2  # Skip the next paragraph since it has been merged.
                                continue
                            else:
                                # Not large; keep header as its own paragraph (wrapped in [ ]).
                                merged_pars.append([f"[{line}]"])
                                i += 1
                                continue
                        else:
                            # No following paragraph exists; keep header as its own.
                            merged_pars.append([f"[{line}]"])
                            i += 1
                            continue
                # Default: add the current paragraph unchanged.
                merged_pars.append(current_par)
                i += 1
            return merged_pars

        def print_lines(page_num: int, page_lines: list[str]) -> None:
            print(f"\n--- DEBUG: Page {page_num} raw lines ---")
            for idx, ln in enumerate(page_lines):
                print(f"  Raw line {idx}: '{ln}'")

        def chunk_paragraph_by_sentence(paragraph_lines: list[str], max_tokens: int = 100) -> list[str]:
            """
            A simplified approach:
            1) Join lines into one string.
            2) Regex split into sentences by punctuation + whitespace.
            3) Accumulate sentences up to 'max_tokens'.
            """
            joined_text = " ".join(paragraph_lines).strip()
            sentences = re.split(r'(?<=[.?!])\s+', joined_text)

            chunks: list[str] = []
            current_tokens: list[str] = []
            token_count = 0

            for sent in sentences:
                tokens = sent.split()
                if not tokens:
                    continue

                if token_count + len(tokens) > max_tokens:
                    if current_tokens:
                        chunks.append(" ".join(current_tokens))
                    current_tokens = []
                    token_count = 0

                current_tokens.extend(tokens)
                token_count += len(tokens)

            if current_tokens:
                chunks.append(" ".join(current_tokens))

            return chunks

        # ------------------- MAIN LOGIC --------------------
        doc = fitz.open(self.file_path)
        chunks: list[Chunk] = []
        page_chunks: dict[int, Chunk] = {}

        for page_num in range(len(doc)):
            page = doc[page_num]
            page_lines = self.get_lines_from_dict(page)

            # remove a purely numeric last line (like "2"):
            if page_lines and page_lines[-1].strip().isdigit():
                page_lines.pop()

            if self.debug:
                print_lines(page_num, page_lines)

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

            # 1) Save page as image (as you do in your code)
            pix = page.get_pixmap()
            page_image_path = os.path.join(self.output_dir, f"page_{page_num}.png")
            pix.save(page_image_path)

            # 2) Store page_image blob
            page_image_blob = Blob(
                blob_type="page_image",
                start=page_num,
                bbox=None,
                img_path=page_image_path
            )
            page_chunk.blobs.append(page_image_blob)

            # 3) OCR if do_ocr, same as before
            if do_ocr:
                try:
                    from PIL import Image
                    import pytesseract
                    ocr_text = pytesseract.image_to_string(Image.open(page_image_path)).strip()
                    if ocr_text:
                        page_ocr_blob = Blob(
                            blob_type="page_ocr",
                            content=[ocr_text],
                            start=page_num
                        )
                        page_chunk.blobs.append(page_ocr_blob)
                except Exception as e:
                    print(f"OCR failed on page {page_num}: {e}")

            # 4) Split paragraphs using the <PARA_BREAK> markers.
            #    This removes the tokens from the actual content while preserving paragraph boundaries.
            paragraphs = split_paragraphs(page_lines)

            # 5) Possibly merge single-line headings with a following large paragraph.
            paragraphs = merge_single_line_headings(paragraphs)

            # 6) For each paragraph, chunk by sentences (or any logic you want)
            para_id = 0
            for paragraph_lines in paragraphs:
                splitted_chunks = chunk_paragraph_by_sentence(paragraph_lines, max_tokens=200)
                for chunk_text in splitted_chunks:
                    para_chunk_id = generate_id()
                    para_blob = Blob(
                        blob_type="text",
                        content=chunk_text,
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
                image_blob = Blob(
                    blob_type="image",
                    start=page_num,
                    content=label,
                    bbox=bbox,
                    img_path=img_path
                )

                image_chunk = Chunk(image_chunk_id, str(page_num), [image_blob], page_chunk.id, [])
                page_chunk.children.append(image_chunk_id)
                chunks.append(image_chunk)
        return chunks

    def chunkify(self) -> ChunkedFile:
        with pdfplumber.open(self.file_path) as pdf:
            text_chunks, page_chunks = self.extract_text_chunks()
            if self.debug:
                self.debug_print_lines(text_chunks)
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
    debug = False

    if "-files" in args:
        files_index = args.index("-files") + 1
        while files_index < len(args) and not args[files_index].startswith("-"):
            input_files.append(os.path.abspath(args[files_index]))
            files_index += 1

    if "-outdir" in args:
        outdir_index = args.index("-outdir") + 1
        if outdir_index < len(args):
            output_folder = ensure_directory_exists(os.path.abspath(args[outdir_index]))

    if "-debug" in args:
        debug = True

    return input_files, output_folder, debug

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 -X utf8 pdfChunker.py -files FILE [FILE] ... -outdir OUTPUT_FOLDER")
        return 2

    input_files, output_folder, debug_mode = parse_args(sys.argv[1:])
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
            chunker = PDFChunker(filename, output_folder, debug_mode)
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