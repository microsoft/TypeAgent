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
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from pathlib import Path
import re

IdType = str

from dataclasses import dataclass
from typing import Optional, List, Union, Dict, Any

@dataclass
class Blob:
    """Stores text, table, or image data plus metadata."""
    blob_type: str                  # "text", "table", "image", "image_label"
    start: int                      # Page number (0-based)
    content: Optional[Union[str, List[str]]] = None
    bbox: Optional[List[float]] = None
    img_name: Optional[str] = None  # Name of the image blob, if this is an image blob
    img_path: Optional[str] = None  # Path to the saved image file, if this is an image blob
    image_chunk_ref: Optional[List[str]] = None     # Pointer to the chunk that has the associated image (if this is a caption)
    para_id: Optional[int] = None  # Paragraph ID if needed
    paraHeader: Optional[Union[str, List[str]]] = None

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
        if self.paraHeader is not None:
            result["paraHeader"] = self.paraHeader
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
    parentId: Optional[str] = None
    children: Optional[List[str]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        result =  {
            "id": self.id,
            "pageid": self.pageid,
            "blobs": [blob.to_dict() for blob in self.blobs],
        }

        if self.parentId is not None:
            result["parentId"] = self.parentId
        if self.children:
            result["children"] = self.children
        return result

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
            if len(text) > 200:
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
                detected_tables.append(([x0, y0, x1, y1], structured_data))

        return detected_tables
    
    def print_tables(self, tables: list[tuple[list[float], list[list[str]]]]) -> None:
        if self.debug:
            for idx, (bbox, table_data) in enumerate(tables):
                x0, y0, x1, y1 = bbox
                print(f"  🟦 Table {idx}: BBox ({x0}, {y0}, {x1}, {y1})")
                
                print("  Table Content:")
                for row in table_data:
                    print(f"    {' | '.join(row)}")

    def _find_nearest_image_bbox(self, line_bbox: List[float], image_bboxes: List[List[float]]) -> Optional[List[float]]:
        """
        Return the bounding box of the closest image to the given line_bbox,
        or None if none are close.
        """
        x0_line, y0_line, x1_line, y1_line = line_bbox
        min_dist = float("inf")
        best_bbox: Optional[List[float]] = None

        for (x0_img, y0_img, x1_img, y1_img) in image_bboxes:
            # Measure vertical distance if the line is below or above the image
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

        x0_line, y0_line, x1_line, y1_line = line_bbox
        close_chunks: List[Chunk] = []

        page_images = self.doc_image_chunksmap.get(page_num, {})        
        for _, img_chunk in page_images.items():
            if not img_chunk.blobs:
                continue

            img_blob = img_chunk.blobs[0]
            if img_blob.blob_type != "image":
                continue
            
            x0_img, y0_img, x1_img, y1_img = img_blob.bbox

            # Allow **partial** X-overlap
            x_overlap = not (x1_line < x0_img or x0_line > x1_img)

            # Title logic: Slightly above or inside
            is_image_title = (
                x_overlap and
                (y0_line >= y0_img - image_title_buffer) and 
                (y1_line <= y1_img)  
            )

            # Caption logic: Below image within buffer
            is_image_caption = (
                x_overlap and
                (y0_line >= y1_img) and
                (y1_line <= y1_img + image_label_buffer)
            )

            if is_image_title or is_image_caption:
                close_chunks.append(img_chunk)

        if close_chunks:
            return (page_num, close_chunks)
        return None

    def sort_line_entries_with_threshold(self, line_entries: list[dict], y_threshold: float = 1.0):
        """
        Sorts line_entries by y0, but if two lines are within 'y_threshold' on y0,
        treat them as the same 'rounded' y so that line_index decides.
        """
        def sort_key(e: dict) -> tuple[float, int]:
            raw_y = e["y0"]
            # Round or bucket the y0 to the nearest threshold
            bucketed_y = int(raw_y / y_threshold)
            return (bucketed_y, e["line_index"])

        # stable sort
        line_entries.sort(key=sort_key)

    def get_lines_from_dict(self, page: fitz.Page) -> list[tuple[str, str, list[Chunk]]]:
        Y_THRESHOLD = 2.0  
        X_GAP_THRESHOLD = 15.0
        PARA_GAP_THRESHOLD = 8.0  
        PARA_MARKER = "<PARA_BREAK>"

        data = page.get_text("dict")  
        line_entries = []

        image_bboxes = []
        for img in page.get_images(full=True):
            xref = img[0]
            img_rects = page.get_image_rects(xref)
            if img_rects:
                image_bboxes.append(list(img_rects[0]))

        if self.debug:
            print(f"\n--- DEBUG: Found {len(image_bboxes)} images on the page ---")
            for idx, (x0, y0, x1, y1) in enumerate(image_bboxes):
                print(f"  Image {idx}: BBox ({x0}, {y0}, {x1}, {y1})")

        page_num = page.number
        for block in data["blocks"]:
            if block["type"] == 0:  # Text block
                for ln_idx, ln in enumerate(block["lines"]):
                    line_text = ""
                    line_bold = False
                    line_font_sizes = []

                    for span in ln["spans"]:
                        line_text += span["text"]
                        line_font_sizes.append(span["size"])
                        # Check for bold style in font name
                        if "Bold" in span["font"]:
                            line_bold = True

                    line_text = line_text.strip()
                    if not line_text:
                        continue

                    x0, y0, x1, y1 = ln["bbox"]
                    avg_font_size = sum(line_font_sizes) / len(line_font_sizes)
                    # if self.debug:
                        #     print(f"\n--- DEBUG: Checking line '{line_text}' ---")
                        #     print(f"  Line BBox: ({x0}, {y0}, {x1}, {y1})")

                    nearby_images = self._find_nearest_image_chunk(page_num, [x0, y0, x1, y1])
                    if nearby_images is not None:
                        _, chunk_list = nearby_images
                        label = "image"
                        if self.debug:
                            print("  🖼️ Marked as IMAGE label (title or caption logic)")
                            print(f"  Related Image Chunks: {[chunk.id for chunk in chunk_list]}")
                            related_chunks = chunk_list
                        related_chunks = chunk_list
                    else:
                        label = "text"
                        related_chunks = []

                    line_entries.append({
                        "text": line_text,
                        "label": label,
                        "line_index": ln_idx,
                        "x0": x0,
                        "y0": y0,
                        "x1": x1,
                        "y1": y1,
                        "related_chunks": related_chunks,
                        "font_size": avg_font_size,
                        "is_bold": line_bold
                    })

        self.sort_line_entries_with_threshold(line_entries, y_threshold=1.0)
        if(self.debug):
            print(f"\n--- DEBUG Line entries: Found {len(line_entries)} lines ---")
            for entry in line_entries:
                print(f"  Line: {entry['text']}, Label: {entry['label']}, BBox: ({entry['x0']}, {entry['y0']}, {entry['x1']}, {entry['y1']})")


        # Improved merging with bold/size-based paragraph breaks
        merged_lines: list[tuple[str, str, List[Chunk]]] = []
        i = 0
        while i < len(line_entries):
            current = line_entries[i]
            current_text = current["text"]
            current_label = current["label"]
            current_chunks = current["related_chunks"]
            current_bold = current["is_bold"]
            current_font_size = current["font_size"]

            x0_c, y0_c, x1_c, y1_c = current["x0"], current["y0"], current["x1"], current["y1"]

            # Insert explicit paragraph break before bold or significantly large-font lines
            if i > 0:
                prev_entry = line_entries[i - 1]
                if (current_bold and not prev_entry["is_bold"]) or \
                (current_font_size > prev_entry["font_size"] + 1.0):
                    merged_lines.append((PARA_MARKER, "text", []))

            # original merging logic (unchanged)
            if current_label in ["image", "table"]:
                j = i + 1
                while j < len(line_entries):
                    next_line = line_entries[j]
                    next_y0, next_y1 = next_line["y0"], next_line["y1"]
                    if next_y0 - y1_c < PARA_GAP_THRESHOLD:
                        next_line["label"] = current_label
                        next_line["related_chunks"] = current_chunks
                        j += 1
                    else:
                        break

            if i < len(line_entries) - 1:
                next_line = line_entries[i + 1]
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
                            "related_chunks": final_chunks,
                            "font_size": max(current_font_size, next_line["font_size"]),
                            "is_bold": current_bold or next_line["is_bold"]
                        }
                        line_entries[i] = new_entry
                        del line_entries[i + 1]
                        continue  

            merged_lines.append((current_text, current_label, current_chunks))

            # Explicit paragraph break after bold or large-font headers
            if current_bold or current_font_size > 1.0 + sum(e["font_size"] for e in line_entries)/len(line_entries):
                merged_lines.append((PARA_MARKER, "text", []))

            if i < len(line_entries) - 1:
                next_line = line_entries[i + 1]
                gap = next_line["y0"] - current["y1"]
                if gap >= PARA_GAP_THRESHOLD:
                    merged_lines.append((PARA_MARKER, "text", []))

            i += 1
        return merged_lines

    def get_lines_from_dict_orig(self, page: fitz.Page) -> list[tuple[str, str, list[Chunk]]]:
        # Thresholds for merging lines
        Y_THRESHOLD = 2.0  
        X_GAP_THRESHOLD = 15.0
        PARA_GAP_THRESHOLD = 8.0  
        PARA_MARKER = "<PARA_BREAK>"
    
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
                for ln_idx, ln in enumerate(block["lines"]):
                    line_text = "".join(span["text"] for span in ln["spans"]).strip()
                    if not line_text:
                        continue

                    x0, y0, x1, y1 = ln["bbox"]
                    # if self.debug:
                    #     print(f"\n--- DEBUG: Checking line '{line_text}' ---")
                    #     print(f"  Line BBox: ({x0}, {y0}, {x1}, {y1})")

                    nearby_images = self._find_nearest_image_chunk(page_num, [x0, y0, x1, y1])
                    if nearby_images is not None:
                        _, chunk_list = nearby_images
                        label = "image"
                        if self.debug:
                            print("  🖼️ Marked as IMAGE label (title or caption logic)")
                            print(f"  Related Image Chunks: {[chunk.id for chunk in chunk_list]}")
                        related_chunks = chunk_list
                    else:
                        # we can do table detection or skip
                        label = "text"
                        related_chunks = []

                    line_entries.append({
                        "text": line_text,
                        "label": label,
                        "line_index": ln_idx,
                        "x0": x0,
                        "y0": y0,
                        "x1": x1,
                        "y1": y1,
                        "related_chunks": related_chunks  # store the image/table chunk(s) if any
                    })

        self.sort_line_entries_with_threshold(line_entries, y_threshold=1.0)
        if(self.debug):
            print(f"\n--- DEBUG Line entries: Found {len(line_entries)} lines ---")
            for entry in line_entries:
                print(f"  Line: {entry['text']}, Label: {entry['label']}, BBox: ({entry['x0']}, {entry['y0']}, {entry['x1']}, {entry['y1']})")
    
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
    
    def split_paragraphsV0(self, lines: list[str]) -> list[list[str]]:
            paragraphs = []
            current_par = []
            for line in lines:
                if line.strip() == "<PARA_BREAK>":
                    if current_par:
                        paragraphs.append(current_par)
                        current_par = []
                else:
                    current_par.append(line)
            if current_par:
                paragraphs.append(current_par)
            return paragraphs

    def split_paragraphs(
        self, 
        lines: list[tuple[str, str, list[Chunk]]]
    ) -> list[tuple[list[str], str, list[Chunk]]]:
        """
        1) Builds paragraphs from lines, splitting on <PARA_BREAK>.
        2) Merges consecutive paragraphs that have labels != 'text'.
        (e.g., if 3 or more image paragraphs appear in a row, they become one merged paragraph.)
        """

        paragraphs = []
        current_par_texts: list[str] = []
        current_par_label: str | None = None
        current_par_chunks: list[Chunk] = []

        for text, label, related_chunks in lines:
            if text.strip() == "<PARA_BREAK>":
                if current_par_texts:
                    paragraphs.append(
                        (current_par_texts, current_par_label or "text", current_par_chunks)
                    )
                    current_par_texts = []
                    current_par_label = None
                    current_par_chunks = []
            else:
                current_par_texts.append(text)

                if current_par_label is None:
                    current_par_label = label
                elif current_par_label == "text" and label in {"image", "table"}:
                    current_par_label = label

                # Combine chunk lists (unique references)
                for c in related_chunks:
                    if c not in current_par_chunks:
                        current_par_chunks.append(c)

        # Last paragraph if leftover lines
        if current_par_texts:
            paragraphs.append(
                (current_par_texts, current_par_label or "text", current_par_chunks)
            )

        merged_paragraphs: list[tuple[list[str], str, list[Chunk]]] = []
        i = 0
        n = len(paragraphs)

        while i < n:
            par_texts, par_label, par_chunks = paragraphs[i]

            if par_label == "text":
                merged_paragraphs.append((par_texts, par_label, par_chunks))
                i += 1
            else:
                # We have a non-text paragraph => gather consecutive paragraphs that are also non-text
                merged_texts = list(par_texts)       # copy
                merged_chunks = list(par_chunks)     # copy
                j = i + 1

                while j < n:
                    nxt_texts, nxt_label, nxt_chunks = paragraphs[j]
                    if nxt_label != "text":
                        merged_texts.extend(nxt_texts)
                        for c in nxt_chunks:
                            if c not in merged_chunks:
                                merged_chunks.append(c)
                        j += 1
                    else:
                        break
                
                final_label = par_label
                merged_paragraphs.append((merged_texts, final_label, merged_chunks))
                i = j
        return merged_paragraphs
    
    def is_potential_header(self, line: str) -> bool:
        """
        Determine if a line is a potential header based on length, punctuation,
        capitalization, and common trailing words.
        """
        if not line:
            return False

        words = line.strip().split()
        if len(words) > 10:
            return False  # too long

        if line[-1] in ".?!":
            return False  # ends like a sentence

        if not line[0].isupper():
            return False  # likely not a section heading

        # Avoid lines ending in incomplete thoughts (prepositions)
        trailing_words = {"to", "of", "the", "and", "in", "for", "with", "on", "at", "by"}
        if words[-1].lower() in trailing_words:
            return False

    def merge_single_line_headings(
        self, 
        paragraphs: list[tuple[list[str], str, list[Chunk]]]
    ) -> list[tuple[list[str], str, list[Chunk]]]:

        merged_pars: list[tuple[list[str], str, list[Chunk]]] = []
        i = 0

        while i < len(paragraphs):
            p_texts, p_label, p_chunks = paragraphs[i]

            # Check if this paragraph is a single-line potential header
            if len(p_texts) == 1:
                line = p_texts[0].strip()
                if line and (len(line.split()) <= 10) and (line[-1] not in ".?!"):
                    # Candidate header found
                    if i + 1 < len(paragraphs):
                        n_texts, n_label, n_chunks = paragraphs[i + 1]
                        # Define "large" as multiple lines, or a single line with >10 words
                        if (len(n_texts) > 1) or (len(n_texts) == 1 and len(n_texts[0].split()) > 10):
                            # Merge header with the next paragraph
                            n_texts[0] = f"[{line}]: " + n_texts[0]

                            # Combine chunk references (deduplicate)
                            combined_chunks = p_chunks + n_chunks
                            seen = set()
                            dedup_chunks: list[Chunk] = []
                            for c in combined_chunks:
                                if c not in seen:
                                    seen.add(c)
                                    dedup_chunks.append(c)

                            # Keep the next paragraph's label
                            merged_pars.append((n_texts, n_label, dedup_chunks))
                            i += 2  # Skip the next paragraph (it's merged)
                            continue
                        else:
                            # Not large → keep heading as its own paragraph, wrapped in [ ]
                            header_line = f"[{line}]"
                            merged_pars.append(([header_line], p_label, p_chunks))
                            i += 1
                            continue
                    else:
                        header_line = f"[{line}]"
                        merged_pars.append(([header_line], p_label, p_chunks))
                        i += 1
                        continue

            # Default case: add the current paragraph unchanged
            merged_pars.append((p_texts, p_label, p_chunks))
            i += 1
        return merged_pars

    def debug_print_paragraphs(
        self, 
        paragraphs: list[tuple[list[str], str, list[Chunk]]]
    ) -> None:
        print("\n=== DEBUG: Extracted Paragraphs ===")
        for idx, (texts, label, related_chunks) in enumerate(paragraphs):
            print(f"\n--- Paragraph {idx + 1} ---")
            print(f"Label: {label}")

            paragraph_text = " ".join(texts)
            print(f"Text: {paragraph_text}")

            if related_chunks:
                print("Related Chunks:")
                for chunk in related_chunks:
                    chunk_id = chunk.id
                    chunk_type = chunk.blobs[0].blob_type if chunk.blobs else "Unknown"
                    print(f"  - Chunk ID: {chunk_id}, Type: {chunk_type}")

            print("-" * 40) 
        print("\n=== END DEBUG ===\n")

    def chunk_paragraph_by_sentence(self, paragraph_lines: list[str], max_tokens: int = 100) -> list[str]:
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

    def extract_document_chunks(self) -> tuple[list[Chunk], dict[int, Chunk]]:
        
        def print_lines_with_label(page_num: int, page_lines: list[tuple[str, str]]) -> None:
            print(f"\n--- 🚀 DEBUG: Page {page_num} raw lines ---")
            for idx, (text, label, _) in enumerate(page_lines):
                print(f"  Raw line {idx}: '{text}' (Label: {label})")

        carry_over_paragraph: Optional[tuple[list[str], str, list[Chunk]]] = None
        def create_chunks_with_headers_carryoverpara(all_paragraph_texts, page_chunk_id, page_num, generate_id, debug=False):
            nonlocal carry_over_paragraph
            chunks = []
            current_headers: List[str] = []
            para_id = 0

            # If there is a carry-over paragraph, prepend it
            if carry_over_paragraph:
                first_para_lines, first_para_label, first_para_chunks = all_paragraph_texts[0]
                
                # Merge carry-over paragraph with the first paragraph of this page
                merged_lines = carry_over_paragraph[0] + first_para_lines
                merged_label = first_para_label  # Usually, labels would match as both are text
                merged_chunks = carry_over_paragraph[2] + first_para_chunks

                all_paragraph_texts[0] = (merged_lines, merged_label, merged_chunks)
                carry_over_paragraph = None  # Clear carry-over after use

            for idx, (para_lines, para_label, para_chunks) in enumerate(all_paragraph_texts):
                header_matches = re.findall(r'\[(.*?)\]:', " ".join(para_lines))
                if header_matches:
                    current_headers = header_matches.copy()

                if para_label == "text":
                    splitted_chunks = self.chunk_paragraph_by_sentence(para_lines, max_tokens=200)
                    first_blob = True
                    for chunk_text in splitted_chunks:
                        blob_headers = current_headers if first_blob else header_matches

                        if debug:
                            print(f"  Chunk text: {chunk_text}")

                        para_chunk_id = generate_id()
                        para_blob = Blob(
                            blob_type="text",
                            content=chunk_text,
                            paraHeader=blob_headers if blob_headers else None,
                            start=page_num + 1,  # fixed numbering here
                            para_id=para_id,
                            image_chunk_ref=None
                        )
                        para_chunk = Chunk(
                            id=para_chunk_id,
                            pageid=str(page_num + 1),  # fixed numbering here
                            blobs=[para_blob],
                            parentId=page_chunk_id,
                            children=[]
                        )

                        chunks.append(para_chunk)
                        first_blob = False
                        para_id += 1

                    current_headers = header_matches.copy()

                else:
                    para_chunk_id = generate_id()
                    chunk_ids = [c.id for c in para_chunks]

                    para_blob = Blob(
                        blob_type=para_label + "_label",
                        content=para_lines,
                        paraHeader=current_headers if current_headers else None,
                        start=page_num + 1,  # fixed numbering here
                        para_id=para_id,
                        image_chunk_ref=chunk_ids
                    )

                    para_chunk = Chunk(
                        id=para_chunk_id,
                        pageid=str(page_num + 1),  # fixed numbering here
                        blobs=[para_blob],
                        parentId=page_chunk_id,
                        children=[]
                    )

                    chunks.append(para_chunk)
                    current_headers = []
                    para_id += 1

            # Check if the last paragraph ends without punctuation (indicating spillover)
            last_paragraph_text, last_label, last_chunks = all_paragraph_texts[-1]
            if last_label == "text" and not re.search(r'[.!?]$', " ".join(last_paragraph_text).strip()):
                # Set it as carry-over paragraph
                carry_over_paragraph = (last_paragraph_text, last_label, last_chunks)
                # Remove last paragraph's chunks from current list as it'll appear in next page again
                chunks = chunks[:-len(splitted_chunks)]

            return chunks

        def create_chunks_with_headers(all_paragraph_texts, page_chunk_id, page_num, generate_id, debug=False):
            chunks = []
            current_headers: List[str] = []
            para_id = 0

            for (para_lines, para_label, para_chunks) in all_paragraph_texts:
                header_matches = re.findall(r'\[(.*?)\]:', " ".join(para_lines))
                if header_matches:
                    #current_headers.extend(header_matches)
                    current_headers = header_matches.copy()

                if para_label == "text":
                    splitted_chunks = self.chunk_paragraph_by_sentence(para_lines, max_tokens=200)
                    first_blob = True
                    for chunk_text in splitted_chunks:
                        blob_headers = current_headers if first_blob else header_matches

                        if debug:
                            print(f"  Chunk text: {chunk_text}")

                        para_chunk_id = generate_id()
                        para_blob = Blob(
                            blob_type="text",
                            content=chunk_text,
                            paraHeader=blob_headers if blob_headers else None,
                            start=page_num+1,
                            para_id=para_id,
                            image_chunk_ref=None
                        )
                        para_chunk = Chunk(
                            id=para_chunk_id,
                            pageid=str(page_num+1),
                            blobs=[para_blob],
                            parentId=page_chunk_id,
                            children=[]
                        )

                        chunks.append(para_chunk)
                        first_blob = False
                        para_id += 1

                    current_headers = header_matches

                else:
                    para_chunk_id = generate_id()
                    chunk_ids = [c.id for c in para_chunks]

                    para_blob = Blob(
                        blob_type=para_label + "_label",
                        content=para_lines,
                        paraHeader=current_headers if current_headers else None,
                        start=page_num+1,
                        para_id=para_id,
                        image_chunk_ref=chunk_ids
                    )

                    para_chunk = Chunk(
                        id=para_chunk_id,
                        pageid=str(page_num+1),
                        blobs=[para_blob],
                        parentId=page_chunk_id,
                        children=[]
                    )

                    chunks.append(para_chunk)
                    current_headers = []
                    para_id += 1

            return chunks
        
        def create_chunks_with_headers_orig(all_paragraph_texts, page_chunk_id, page_num, generate_id, debug=False):
            para_id = 0
            for (para_lines, para_label, para_chunks) in all_paragraph_texts:
                if para_label == "text":
                    # split into sentence chunks
                    splitted_chunks = self.chunk_paragraph_by_sentence(para_lines, max_tokens=200)
                    for chunk_text in splitted_chunks:
                        #print the chunk text
                        if self.debug:
                            print(f"  Chunk text: {chunk_text}")
                        para_chunk_id = generate_id()
                        para_blob = Blob(
                            blob_type="text",
                            content=chunk_text,          # single string
                            start=page_num,
                            para_id=para_id,
                            image_chunk_ref=None 
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
                else:
                    # non text paragraphs
                    para_chunk_id = generate_id()
                    chunk_ids = [c.id for c in para_chunks]

                    para_blob = Blob(
                        blob_type=para_label+"_label",
                        content=para_lines,
                        start=page_num,
                        para_id=para_id,
                        image_chunk_ref=chunk_ids
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
            return chunks
        # ------------------- chunk the file --------------------
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
                print(f"\n--- 🚀 DEBUG: Page {page_num+1} ---")
                print_lines_with_label(page_num, page_lines_with_labels)

            page_chunk_id = generate_id()
            page_chunk = Chunk(
                id=page_chunk_id,
                pageid=str(page_num+1),
                blobs=[],
                children=[]
            )
            page_chunks[page_num] = page_chunk
            chunks.append(page_chunk)

            pix = page.get_pixmap()
            page_image_path = os.path.join(self.output_dir, f"page_{page_num}.png")
            pix.save(page_image_path)

            page_image_blob = Blob(
                blob_type="page_image",
                start=page_num,
                img_path=page_image_path
            )
            page_chunk.blobs.append(page_image_blob)
            image_chunks = self.doc_image_chunksmap[page_num]
            for img_chunk in image_chunks.values():
                img_chunk.parentId = page_chunk_id
                page_chunk.children.append(img_chunk.id)
                chunks.append(img_chunk)

            # paragraphs using the <PARA_BREAK> markers.
            paragraphs= self.split_paragraphs(page_lines_with_labels)
            if self.debug:
                print(f"\n--- 🚀 DEBUG: Page {page_num} paragraphs ---")
                self.debug_print_paragraphs(paragraphs)
            
            all_paragraph_texts = self.merge_single_line_headings(paragraphs)
            para_chunks = create_chunks_with_headers_carryoverpara(all_paragraph_texts, page_chunk_id, page_num, generate_id, self.debug)
            for para_chunk in para_chunks:
                page_chunk.children.append(para_chunk.id)
            chunks.extend(para_chunks)
            

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

    def get_imagechunkmap_for_doc(self) -> dict[int, dict[str, Chunk]]:
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
    
    def getAllImageChunks(self) -> List[Chunk]:
        image_chunks = []
        for page_num in range(len(self.doc_image_chunksmap)):
            image_chunksmap = self.doc_image_chunksmap[page_num]
            for img_name, chunk in image_chunksmap.items():
                image_chunks.append(chunk)
        return image_chunks
    
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
            self.doc_image_chunksmap = self.get_imagechunkmap_for_doc()
            doc_chunks, page_chunks = self.extract_document_chunks()
            if self.debug:
                self.debug_print_lines(doc_chunks)
        all_chunks = doc_chunks
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

    print(json.dumps(items, default=custom_json, indent=2))
    return 0

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)