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
    
    def get_lines_from_dict_alt(self, page: fitz.Page) -> list[str]:
        """
        Use page.get_text('dict') to reconstruct actual lines by combining spans.
        Returns a list of strings, each representing one 'visual' line of text.
        """
        data = page.get_text("dict")
        all_lines = []

        for block in data["blocks"]:
            # block["type"] == 0 means text; 1 might be images, etc.
            if block["type"] == 0:
                for line in block["lines"]:
                    # Combine all spans into one string
                    line_text = "".join(span["text"] for span in line["spans"])
                    line_text = line_text.strip()
                    if line_text:
                        all_lines.append(line_text)

        return all_lines

    def get_lines_from_dict(self, page: fitz.Page) -> list[str]:
        # How close in 'y' do lines need to be to unify? (tune this)
        Y_THRESHOLD = 2.0  # e.g., lines whose y-mid differs by less than ~2 points
        # How close in 'x'? If there's minimal gap between x1 of line A and x0 of line B,
        # we unify them. Some PDFs have bigger or smaller spacing, so tune as needed.
        X_GAP_THRESHOLD = 15.0

        data = page.get_text("dict")
        # We'll store each line as a dict with text, plus bounding box info
        # at the "line" level.
        # Because each line can have multiple spans, we unify them first,
        # but keep the line's overall bounding box.
        line_entries = []

        for block in data["blocks"]:
            if block["type"] == 0:  # text block
                for ln in block["lines"]:
                    # Combine text from all spans
                    line_text = "".join(span["text"] for span in ln["spans"]).strip()
                    if not line_text:
                        continue

                    # line bbox
                    # According to PyMuPDF docs, each "line" has a "bbox": [x0, y0, x1, y1]
                    x0, y0, x1, y1 = ln["bbox"]
                    line_entries.append({
                        "text": line_text,
                        "x0": x0,
                        "y0": y0,
                        "x1": x1,
                        "y1": y1,
                    })

        # Now we have a list of line-like entries, but some might be the same "row" if the PDF
        # separated them. We'll do a second pass to unify adjacent lines if they're close in Y.

        # 1) Sort line_entries top-to-bottom, then left-to-right
        #    This helps us unify lines in a consistent reading order.
        #    Use y0 as primary, x0 as secondary.
        line_entries.sort(key=lambda e: (e["y0"], e["x0"]))

        merged_lines: list[str] = []
        i = 0
        while i < len(line_entries):
            current = line_entries[i]
            current_text = current["text"]
            x0_c = current["x0"]
            y0_c = current["y0"]
            x1_c = current["x1"]
            y1_c = current["y1"]

            # Look ahead to see if the next line is close in Y and right next to x1_c
            if i < len(line_entries) - 1:
                next_line = line_entries[i + 1]
                x0_n = next_line["x0"]
                y0_n = next_line["y0"]
                x1_n = next_line["x1"]
                y1_n = next_line["y1"]
                text_n = next_line["text"]

                # Compute mid-Y for each line to see how far they are
                midY_c = (y0_c + y1_c) / 2.0
                midY_n = (y0_n + y1_n) / 2.0
                y_diff = abs(midY_c - midY_n)

                # If they're nearly the same row
                if y_diff < Y_THRESHOLD:
                    # And if the gap between x1_c and x0_n is small => probably the same line
                    x_gap = x0_n - x1_c
                    if 0 <= x_gap < X_GAP_THRESHOLD:
                        # unify them
                        unified_text = current_text.rstrip() + " " + text_n.lstrip()
                        # Also unify bounding box => from x0_c to x1_n, 
                        # min y0, max y1 if you want
                        new_entry = {
                            "text": unified_text,
                            "x0": x0_c,
                            "y0": min(y0_c, y0_n),
                            "x1": x1_n,
                            "y1": max(y1_c, y1_n),
                        }
                        # replace current line with the merged line
                        line_entries[i] = new_entry
                        # remove the next line because it's merged
                        del line_entries[i + 1]
                        # do not increment i, because we might unify more lines
                        continue
            merged_lines.append(current_text)
            i += 1
        return merged_lines

    def is_heading_line(line: str) -> bool:
        trimmed = line.strip()
        if not trimmed:
            return False

        words = trimmed.split()
        if len(words) > 10:
            return False

        if trimmed[-1] in {'.', '?', '!', ':'}:
            return False

        first_word = words[0]
        if first_word.isdigit():
            return True
    
        return True

    def parse_paragraphs_from_lines(self, lines: list[str]) -> list[list[str]]:
        paragraphs: list[list[str]] = []
        current_para: list[str] = []
        for line in lines:
            if not line.strip():
                if current_para:
                    paragraphs.append(current_para)
                    current_para = []
            else:
                current_para.append(line)
        if current_para:
            paragraphs.append(current_para)
        return paragraphs

    def merge_short_lines_with_colon(
        self,
        chunks: List[Chunk],
        min_len: int = 40
    ) -> List[Chunk]:
        for chunk in chunks:
            for blob in chunk.blobs:
                if blob.blob_type == "text" and isinstance(blob.content, str):
                    lines = blob.content.split("\n")
                    merged_lines = []
                    i = 0
                    while i < len(lines):
                        current_line = lines[i].strip()
                        # If short and there is a next line, merge them
                        if len(current_line) < min_len and (i + 1) < len(lines):
                            next_line = lines[i + 1].strip()
                            # Use ": " as the separator instead of "\n"
                            new_line = current_line + ": " + next_line
                            merged_lines.append(new_line)
                            i += 2  # Skip the next line (already merged)
                        else:
                            merged_lines.append(current_line)
                            i += 1
                    blob.content = "\n".join(merged_lines)
        return chunks
        
    def detect_headings(self, chunks: List[Chunk], pdf_path: str, font_size_threshold: float = 14.0) -> List[Chunk]:
        """
        Example heading detection: if a line's average font size is > threshold, 
        label it as [HEADER]. This is just a stub. Real logic might track bold/size for each line.
        """
        doc = fitz.open(pdf_path)
        for chunk in chunks:
            # Assume all blobs in this chunk have the same page index, 
            # but you can refine if needed.
            if chunk.blobs and chunk.blobs[0].blob_type == "text":
                page_idx = chunk.blobs[0].start
                page = doc[page_idx]

                # Naive approach: if there's a single line in the chunk,
                # check the bounding boxes & font size from page.get_text("dict").
                # This is a complex step in real docs. For demonstration:
                text_json = page.get_text("dict")
                # text_json['blocks'] is a list of text blocks, each containing lines/spans
                # then match chunk text to lines/spans to see if it's > font_size_threshold

                # simple 'incomplete' approach:
                for blob in chunk.blobs:
                    if blob.blob_type == "text" and isinstance(blob.content, str):
                        # Suppose we check if there's only 1 or 2 lines => might be a heading
                        line_count = len(blob.content.split("\n"))
                        if line_count <= 2:
                            # pretend it's big text => label as heading
                            # In real usage, you'd compare actual font sizes from the dict
                            blob.content = "[HEADER] " + blob.content
        return chunks

    def apply_pipeline(self, chunks: List[Chunk],
                        remove_blanks: bool = True,
                        merge_shorts: bool = True) -> List[Chunk]:
        """
        High-level function to apply some or all transformations in a pipeline.
        """
        if remove_blanks:
            chunks = self.remove_blank_lines(chunks)
        if merge_shorts:
            chunks = self.merge_short_lines_with_colon(chunks)
        return chunks

    def extract_text_chunks(self, do_ocr: bool = False) -> tuple[list[Chunk], dict[int, Chunk]]:

        def parse_paragraphs(raw_text: str) -> list[list[str]]:
            """Split raw_text into paragraphs (list of lines) using blank lines as separators."""
            paragraphs: list[list[str]] = []
            current_para: list[str] = []
            for line in raw_text.splitlines():
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
            joined_text = "\n".join(paragraph_lines)
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
                blob_type="page_image",         # No direct text
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
                            content=" ".join(sub_para) if isinstance(sub_para, list) else sub_para,
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

    def extract_text_chunksV2(self, do_ocr: bool = False) -> tuple[list[Chunk], dict[int, Chunk]]:
        """
        A new method that uses page.get_text('dict') to reconstruct lines 
        more accurately (including merges of spans so "1 Introduction" 
        isn't split). Then proceeds with your normal paragraph 
        and sentence-based chunking logic.
        """
        def merge_single_line_headings(paragraphs: list[list[str]]) -> list[list[str]]:
            """
            Same logic as in V3 to merge single-line paragraphs 
            that appear to be short headings.
            """
            merged_pars: list[list[str]] = []
            skip_next = False

            for i in range(len(paragraphs)):
                if skip_next:
                    skip_next = False
                    continue

                current_par = paragraphs[i]
                if i < len(paragraphs) - 1:
                    next_par = paragraphs[i + 1]
                    if len(current_par) == 1:
                        line = current_par[0].strip()
                        if line and (len(line.split()) <= 10) and (line[-1] not in ".?!"):
                            # Merge with next paragraph
                            if next_par:
                                next_par[0] = line + ": " + next_par[0]
                            else:
                                next_par.append(line)
                            merged_pars.append(next_par)
                            skip_next = True
                        else:
                            merged_pars.append(current_par)
                    else:
                        merged_pars.append(current_par)
                else:
                    merged_pars.append(current_par)

            return merged_pars
        
        def print_lines(page_num: int, page_lines: list[str]) -> None:
            print(f"\n--- DEBUG: Page {page_num} raw lines ---")
            for idx, ln in enumerate(page_lines):
                print(f"  Raw line {idx}: '{ln}'")

        def chunk_paragraph_by_sentence(paragraph_lines: list[str], max_tokens: int = 200) -> list[str]:
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

            # 4) Parse paragraphs from these lines
            paragraphs = self.parse_paragraphs_from_lines(page_lines)

            # 5) Possibly merge single-line headings
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
            text_chunks, page_chunks = self.extract_text_chunksV2()
            if self.debug:
                self.debug_print_lines(text_chunks)
            #table_chunks = self.extract_tables(pdf, page_chunks=page_chunks)
            image_chunks = self.extract_images(page_chunks)
        all_chunks = text_chunks + image_chunks
        
        # post process the chunks
        '''
        all_chunks = self.apply_pipeline(
                                            chunks=all_chunks,
                                            remove_blanks=True,
                                            merge_shorts=True
                                        )
        '''
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