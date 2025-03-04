# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import os
import subprocess
import sys
import json

import pdfplumber # type: ignore
import fitz # type: ignore
from PIL import Image # type: ignore

import datetime
import csv
from dataclasses import dataclass
from typing import List, Dict, Any, Optional
from pathlib import Path
import re

IdType = str

from dataclasses import dataclass
from typing import Optional, List, Union, Dict, Any

@dataclass
class Blob:
    """Stores text, table, or image data plus metadata."""
    blob_type: str                                 # e.g. "text", "table", "image"
    start: int                                     # Page number (0-based)
    content: Optional[Union[str, List[str]]] = None
    bbox: Optional[List[float]] = None
    img_name: Optional[str] = None                     # Name of the image blob, if this is an image blob
    img_path: Optional[str] = None                 # Path to the saved image file, if this is an image blob
    para_id: Optional[int] = None                  # Paragraph ID if needed
    image_chunk_ref: Optional[str] = None          # Pointer to the chunk that has the associated image (if this is a caption)

    def to_dict(self) -> Dict[str, Any]:
        result = {
            "blob_type": self.blob_type,
            "start": self.start,
        }
        if self.content is not None:
            result["content"] = self.content
        if self.img_path:
            result["img_path"] = self.img_path
        if self.para_id is not None:
            result["para_id"] = self.para_id
        if self.image_chunk_ref is not None:
            result["image_chunk_ref"] = self.image_chunk_ref
        if self.bbox:
            result["bbox"] = self.bbox
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
        self.doc_table_data = {}
        self.doc_image_chunksmap = {}

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
    
    def get_lines_from_dict_orig(self, page: fitz.Page) -> list[str]:
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
  
    def extract_tables_from_page(self, page: fitz.Page) -> list[tuple[list[float], list[list[str]]]]:
        """
        Extracts detected tables from a PDF page.
        - Uses column alignment and row spacing to find tables.
        - Returns a list of tuples where:
        - The first element is the bounding box of the table [x0, y0, x1, y1].
        - The second element is a list of lists, where each inner list represents a row in the table.
        """
        detected_tables = []
        blocks = page.get_text("blocks")

        for block in blocks:
            x0, y0, x1, y1, text, block_type = block[:6]
            words = text.split()

            # Skip empty or too short blocks
            if len(words) < 3:
                continue

            # **Exclude long text paragraphs**
            if len(text) > 200:  # Paragraphs tend to have long continuous text
                continue

            # Get individual lines in the block
            lines = text.split("\n")
            line_y_positions = [y0]  # Store Y-coordinates of each line

            # Track previous line's Y-position for spacing check
            prev_y = y0
            structured_data = []  # Store table content

            for line in lines:
                if not line.strip():
                    continue
                prev_y += 12  # Approximate line height spacing
                line_y_positions.append(prev_y)
                structured_data.append(line.split())  # Store words as table row

            # **Check for uniform row spacing**
            row_spacings = [line_y_positions[i] - line_y_positions[i - 1] for i in range(1, len(line_y_positions))]
            avg_spacing = sum(row_spacings) / len(row_spacings) if row_spacings else 0
            spacing_variation = max(row_spacings) - min(row_spacings) if row_spacings else 0

            # If row spacing is consistent, it's likely a table
            is_table_like = avg_spacing > 5 and spacing_variation < 4

            # **Check for column alignment (multiple words with same X)**
            word_positions = [word.split() for word in lines]
            column_counts = [len(set(pos)) for pos in word_positions if len(pos) > 1]

            has_columns = max(column_counts, default=0) > 1  # More than 1 distinct column

            if is_table_like and has_columns:
                detected_tables.append(([x0, y0, x1, y1], structured_data))  # Store bbox and table content

        return detected_tables
    
    def print_tables(self, tables: list[tuple[list[float], list[list[str]]]]) -> None:
        # Debug: Print detected tables with bounding boxes and content
        print(f"\n--- DEBUG: Found {len(tables)} tables on the page ---")
        for idx, (bbox, table_data) in enumerate(tables):
            x0, y0, x1, y1 = bbox
            print(f"  🟦 Table {idx}: BBox ({x0}, {y0}, {x1}, {y1})")
            
            # Print table content
            print("  Table Content:")
            for row in table_data:
                print(f"    {' | '.join(row)}")  # Format table rows nicely

    def _find_nearest_image_bbox(self, line_bbox: List[float], image_bboxes: List[List[float]]) -> Optional[List[float]]:
        """
        Return the bounding box of the closest image to the given line_bbox,
        or None if none are close.
        """
        x0_line, y0_line, x1_line, y1_line = line_bbox
        min_dist = float("inf")
        best_bbox: Optional[List[float]] = None

        for (x0_img, y0_img, x1_img, y1_img) in image_bboxes:
            # We'll measure vertical distance if the line is below or above the image
            if y1_line < y0_img:
                dist = abs(y0_img - y1_line)
            elif y0_line > y1_img:
                dist = abs(y0_line - y1_img)
            else:
                dist = 0

            if dist < min_dist:
                min_dist = dist
                best_bbox = [x0_img, y0_img, x1_img, y1_img]

        if min_dist > 150:
            return None

        return best_bbox

    def _find_nearest_image_chunk(
        self,
        page_num: int,
        line_bbox: List[float],
        image_title_buffer: float = 30.0,
        image_label_buffer: float = 50.0
    ) -> Optional[tuple[int, List[Chunk]]]:
        """
        Determines if the line_bbox qualifies as an 'image title' or 'image caption'
        for one or more images on the given page. 
        Returns (page_num, [list_of_chunks]) if it is; otherwise None.

        The chunk is considered 'title' if it lies within or above the image 
        by image_title_buffer. 
        The chunk is considered 'caption' if it lies below the image 
        within image_label_buffer.
        """

        x0_line, y0_line, x1_line, y1_line = line_bbox
        close_chunks: List[Chunk] = []

        # Retrieve the images for this page (already in chunk form)
        page_images = self.doc_image_chunksmap.get(page_num, {})
        for _, img_chunk in page_images.items():
            if not img_chunk.blobs:
                continue

            img_blob = img_chunk.blobs[0]
            if img_blob.blob_type != "image":
                continue

            x0_img, y0_img, x1_img, y1_img = img_blob.bbox

            # Title logic: Slightly above or inside
            is_image_title = (
                (y0_line >= y0_img - image_title_buffer) and 
                (y1_line <= y1_img) and 
                (x0_line >= x0_img - 250) and 
                (x1_line <= x1_img + 250)
            )

            # Caption logic: Below image within buffer
            is_image_caption = (
                (y0_line >= y1_img) and
                (y1_line <= y1_img + image_label_buffer) and
                (x0_line >= x0_img - 250) and
                (x1_line <= x1_img + 250)
            )

            if is_image_title or is_image_caption:
                close_chunks.append(img_chunk)

        if close_chunks:
            return (page_num, close_chunks)
        return None

   
    def get_lines_from_dict(self, page: fitz.Page) -> list[tuple[str, str]]:
        # Thresholds for merging lines
        Y_THRESHOLD = 2.0  
        X_GAP_THRESHOLD = 15.0
        PARA_GAP_THRESHOLD = 10.0  
        PARA_MARKER = "<PARA_BREAK>"
        IMAGE_LABEL_BUFFER = 50  # Extended buffer below images
        IMAGE_TITLE_BUFFER = 30  # Allow small margin above image for titles

        data = page.get_text("dict")  
        line_entries = []

        # Extract image bounding boxes using fitz (PyMuPDF)
        image_bboxes = []
        for img in page.get_images(full=True):
            xref = img[0]
            img_rects = page.get_image_rects(xref)
            if img_rects:
                image_bboxes.append(list(img_rects[0]))  # Store first rectangle found

        if self.debug:
            print(f"\n--- DEBUG: Found {len(image_bboxes)} images on the page ---")
            for idx, (x0, y0, x1, y1) in enumerate(image_bboxes):
                print(f"  Image {idx}: BBox ({x0}, {y0}, {x1}, {y1})")

        page_num = page.number
        for block in data["blocks"]:
            if block["type"] == 0:  # Text block
                for ln in block["lines"]:
                    line_text = "".join(span["text"] for span in ln["spans"]).strip()
                    if not line_text:
                        continue

                    x0, y0, x1, y1 = ln["bbox"]
                    # Debug: Print line bounding boxes
                    if self.debug:
                        print(f"\n--- DEBUG: Checking line '{line_text}' ---")
                        print(f"  Line BBox: ({x0}, {y0}, {x1}, {y1})")

                    nearby_images = self._find_nearest_image_chunk(page_num, [x0, y0, x1, y1])
                    # We'll assume it's "image" if we got any images back
                    if nearby_images is not None:
                        _, chunk_list = nearby_images
                        label = "image"
                        if self.debug:
                            print("  🖼️ Marked as IMAGE label (title or caption logic)")
                        related_chunks = chunk_list
                    else:
                        # we can do table detection or skip
                        label = "text"
                        related_chunks = []

                    line_entries.append({
                        "text": line_text,
                        "label": label,
                        "x0": x0,
                        "y0": y0,
                        "x1": x1,
                        "y1": y1,
                        "related_chunks": related_chunks  # store the image/table chunk(s) if any
                    })

        # Sort the line_entries top-to-bottom, then left-to-right.
        line_entries.sort(key=lambda e: (e["y0"], e["x0"]))

        merged_lines: list[tuple[str, str, List[Chunk]]] = []
        i = 0
        while i < len(line_entries):
            current = line_entries[i]
            current_text = current["text"]
            current_label = current["label"]
            current_chunks = current["related_chunks"]
            x0_c, y0_c, x1_c, y1_c = current["x0"], current["y0"], current["x1"], current["y1"]

            if current_label in ["image", "table"]:
                j = i + 1
                while j < len(line_entries):
                    next_line = line_entries[j]
                    next_y0, next_y1 = next_line["y0"], next_line["y1"]
                    if next_y0 - y1_c < PARA_GAP_THRESHOLD:  # Close enough to be part of the caption
                        next_line["label"] = current_label  # Inherit label
                        next_line["related_chunks"] = current_chunks
                        j += 1
                    else:
                        break

            if i < len(line_entries) - 1:
                next_line = line_entries[i + 1]
                #x0_n, y0_n, x1_n, y1_n, text_n, label_n = next_line["x0"], next_line["y0"], next_line["x1"], next_line["y1"], next_line["text"], next_line["label"]
                x0_n, y0_n, x1_n, y1_n = next_line["x0"], next_line["y0"], next_line["x1"], next_line["y1"]
                text_n, label_n, chunks_n = next_line["text"], next_line["label"], next_line["related_chunks"]

                midY_c = (y0_c + y1_c) / 2.0
                midY_n = (y0_n + y1_n) / 2.0
                y_diff = abs(midY_c - midY_n)

                if y_diff < Y_THRESHOLD:
                    x_gap = x0_n - x1_c
                    if 0 <= x_gap < X_GAP_THRESHOLD:
                        unified_text = current_text.rstrip() + " " + text_n.lstrip()

                        if current_label == "image" or label_n == "image":
                            final_label = "image"
                            final_chunks = current_chunks or chunks_n
                        elif current_label == "table" or label_n == "table":
                            final_label = "table"
                            final_chunks = current_chunks or chunks_n
                        else:
                            final_label = "text"
                            final_chunks = []

                        new_entry = {
                            "text": unified_text,
                            "label": final_label,
                            "x0": x0_c,
                            "y0": min(y0_c, y0_n),
                            "x1": x1_n,
                            "y1": max(y1_c, y1_n),
                            "related_chunks": final_chunks
                        }
                        line_entries[i] = new_entry
                        del line_entries[i + 1]
                        continue  

            merged_lines.append((current_text, current_label, current_chunks))

            if i < len(line_entries) - 1:
                next_line = line_entries[i + 1]
                gap = next_line["y0"] - current["y1"]
                if gap >= PARA_GAP_THRESHOLD:
                    merged_lines.append((PARA_MARKER, "text", []))
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
            print(f"\n--- 🚀 DEBUG: Page {page_num} raw lines ---")
            for idx, ln in enumerate(page_lines):
                print(f"  Raw line {idx}: '{ln}'")

        def print_lines_with_label(page_num: int, page_lines: list[tuple[str, str]]) -> None:
            print(f"\n--- 🚀 DEBUG: Page {page_num} raw lines ---")
            for idx, (text, label, _) in enumerate(page_lines):
                print(f"  Raw line {idx}: '{text}' (Label: {label})")

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
            page_lines_with_labels = self.get_lines_from_dict(page)
            if page_lines_with_labels and page_lines_with_labels[-1][0].strip().isdigit():
                page_lines_with_labels.pop()

            # Extract only text after filtering
            page_lines = [text for text, _, _ in page_lines_with_labels]

            if self.debug:
                print(f"\n--- 🚀 DEBUG: Page {page_num} ---")
                print_lines_with_label(page_num, page_lines_with_labels)

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
                img_path=page_image_path
            )
            page_chunk.blobs.append(page_image_blob)

            # 3) Split paragraphs using the <PARA_BREAK> markers.
            #    This removes the tokens from the actual content while preserving paragraph boundaries.
            paragraphs = split_paragraphs(page_lines)

            # 4) Possibly merge single-line headings with a following large paragraph.
            paragraphs = merge_single_line_headings(paragraphs)

            # 5) For each paragraph, chunk by sentences (or any logic you want)
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
    
    def extract_tables_from_page_plumber(self, pdf_path: str, page_num: int) -> list[tuple[list[float], list[list[str]]]]:
        """
        Extracts tables from a PDF page using pdfplumber.
        - Returns a list of tuples where:
        - The first element is the bounding box [x0, y0, x1, y1].
        - The second element is the table content as a list of lists (rows).
        """
        detected_tables = []
        
        with pdfplumber.open(pdf_path) as pdf:
            if page_num >= len(pdf.pages):
                return detected_tables  # Return empty if page doesn't exist
            
            page = pdf.pages[page_num]
            tables = page.extract_tables()  # Extract tables
            
            for table in tables:
                # Get the bounding box from table metadata
                bbox = page.bbox  # Entire page's bbox
                structured_data = [row for row in table if any(row)]  # Remove empty rows
                
                if structured_data:
                    detected_tables.append((bbox, structured_data))  # Store bbox and table content

        return detected_tables
    
    def extract_tables_from_pdf(self, pdf_path: str) -> dict[int, list[tuple[list[float], list[list[str]]]]]:
        """
        Extracts tables from all pages of a PDF using pdfplumber.
        - Returns a dictionary where:
        - Key: Page index (int)
        - Value: List of tuples, each containing:
            - Bounding box [x0, y0, x1, y1]
            - Table content as a list of lists (rows)
        """
        tables_per_page = {}

        with pdfplumber.open(pdf_path) as pdf:
            for page_num, page in enumerate(pdf.pages):
                tables = page.extract_tables()  # Extract tables
                
                page_tables = []
                for table in tables:
                    bbox = page.bbox  # Get page bounding box
                    structured_data = [row for row in table if any(row)]  # Remove empty rows
                    
                    if structured_data:
                        page_tables.append((bbox, structured_data))  # Store bbox and table content

                if page_tables:
                    tables_per_page[page_num] = page_tables  # Store tables for this page

        return tables_per_page

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

    def get_imagechunks_for_doc(self) -> dict[int, dict[str, Chunk]]:
        doc = fitz.open(self.file_path)
        page_imagechunk_map: dict[int, dict[str, Chunk]] = {}  # NEW: page-index-based dictionary

        for page_num in range(len(doc)):
            img_chunks = self.extract_imageblobs_from_page(page_num)

            # Initialize the nested dict for this page
            page_dict: dict[str, Chunk] = {}

            for img_index, chunk in enumerate(img_chunks):
                # Build a unique key for the image
                unique_name = f"image_{page_num}_{img_index}"
                blob = chunk.blobs[0]
                blob.img_name = unique_name

                page_dict[unique_name] = chunk

            page_imagechunk_map[page_num] = page_dict
        return page_imagechunk_map

    def extract_imageblobs_from_page(self, page_num: int) -> list[Chunk]:
        chunks = []
        doc = fitz.open(self.file_path)
        page = doc[page_num]
        for img_index, img in enumerate(page.get_images(full=True)):
            xref = img[0]
            img_rect = doc[page_num].get_image_rects(xref)
            bbox = list(img_rect[0]) if img_rect else None
            img_path = os.path.join(self.output_dir, f"image_{page_num}_{img_index}.png")
            fitz.Pixmap(doc, xref).save(img_path)
            
            image_chunk_id = generate_id()
            image_blob = Blob(
                blob_type="image",
                start=page_num,
                bbox=bbox,
                content=json.dumps(bbox),
                img_path=img_path
            )

            # chunk id will assigned later
            image_chunk = Chunk(image_chunk_id, str(page_num), [image_blob], "", [])
            chunks.append(image_chunk)
        return chunks
    
    def extract_image_chunks(self, page_chunks) -> List[Chunk]:
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
                
                image_chunk_id = generate_id()
                image_blob = Blob(
                    blob_type="image",
                    start=page_num,
                    content="",
                    img_path=img_path
                )

                image_chunk = Chunk(image_chunk_id, str(page_num), [image_blob], page_chunk.id, [])
                page_chunk.children.append(image_chunk_id)
                chunks.append(image_chunk)
        return chunks

    def chunkify(self) -> ChunkedFile:
        with pdfplumber.open(self.file_path) as pdf:
            self.doc_image_chunksmap = self.get_imagechunks_for_doc()
            text_chunks, page_chunks = self.extract_text_chunks()
            if self.debug:
                self.debug_print_lines(text_chunks)
            #table_chunks = self.extract_tables(pdf, page_chunks=page_chunks)
            #image_chunks = self.extract_image_chunks(page_chunks)
        #all_chunks = text_chunks + image_chunks
        all_chunks = text_chunks
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