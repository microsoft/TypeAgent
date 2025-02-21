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
    def __init__(self, file_path: str, output_dir: str = "output"):
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
                        if len(current_line) < min_len and (i + 1) < len(lines):  # <-- CHANGED
                            next_line = lines[i + 1].strip()
                            # Use ": " as the separator instead of "\n"
                            new_line = current_line + ": " + next_line  # <-- CHANGED
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
            for line in raw_text.splitlines():  # <-- CHANGED
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
        Extract text from each PDF page, breaking paragraphs into multi-line chunks
        of limited size (by line count and token count). 
        """
        def parse_paragraphs(raw_text: str) -> list[list[str]]:
            paragraphs: list[list[str]] = []
            current_para: list[str] = []
            for line in raw_text.splitlines():
                if not line.strip():
                    if current_para:
                        paragraphs.append(current_para)
                        current_para = []
                else:
                    current_para.append(line)
            if current_para:
                paragraphs.append(current_para)
            return paragraphs
        
        def chunk_paragraph_by_sentence_with_heading_merge(
            paragraph_lines: list[str],
            max_tokens: int = 200
        ) -> list[str]:
            """
            1. Detect heading lines and merge each with its next line, separated by ': '.
            (e.g., 'ABSTRACT' + '\n' + 'The neural...' -> 'ABSTRACT: The neural...')
            2. Then combine all lines into a single string, do naive sentence splitting,
            and chunk them so we never split inside a sentence.
            3. Return a list of chunk strings, each with up to `max_tokens` tokens.
            """

            ############################
            # HELPER: Identify Heading
            ############################
            def is_heading_line(line: str) -> bool:
                """
                Simple heuristic: a line is considered a heading if:
                - It is <= 10 words, and
                - It's either all uppercase or in a known heading keyword set.
                Customize as needed.
                """
                heading_keywords = {"abstract", "introduction", "conclusion", "references", "methods"}
                trimmed = line.strip()
                if not trimmed:
                    return False

                words = trimmed.split()
                if len(words) > 10:
                    return False

                # All uppercase or known heading keyword
                if trimmed.upper() == trimmed or trimmed.lower() in heading_keywords:
                    return True
                return False

            ############################
            # STEP A: Merge Headings
            ############################
            # We'll modify 'paragraph_lines' in place, merging heading lines
            merged_lines = []
            i = 0
            while i < len(paragraph_lines):
                line = paragraph_lines[i].rstrip()
                if is_heading_line(line) and (i + 1) < len(paragraph_lines):
                    # Merge heading with the next line, separated by ': '
                    next_line = paragraph_lines[i+1].strip()
                    merged_line = line + ": " + next_line
                    merged_lines.append(merged_line)
                    i += 2  # skip the next line
                else:
                    merged_lines.append(line)
                    i += 1

            # Now 'merged_lines' no longer has separate heading lines and next lines.
            # e.g. 'ABSTRACT' + 'We propose...' => 'ABSTRACT: We propose...'

            ############################
            # STEP B: Sentence Splitting
            ############################
            # Merge into one text for naive sentence splitting
            text_merged = " ".join(merged_lines).strip()

            # Use a regex to split after . or ? or ! followed by whitespace
            #   e.g. "ABSTRACT: We propose... Our approach..." => 2 sentences
            sentences = re.split(r'(?<=[.?!])\s+', text_merged)

            ############################
            # STEP C: Accumulate Sentences into Chunks
            ############################
            chunks: list[str] = []
            current_tokens: list[str] = []
            token_count = 0

            for sent in sentences:
                sent_tokens = sent.split()
                if not sent_tokens:
                    continue

                # If adding this sentence would exceed max_tokens, finalize current chunk
                if token_count + len(sent_tokens) > max_tokens:
                    if current_tokens:
                        chunks.append(" ".join(current_tokens))
                    current_tokens = []
                    token_count = 0

                # Add the sentence to the current chunk
                current_tokens.extend(sent_tokens)
                token_count += len(sent_tokens)

            # leftover
            if current_tokens:
                chunks.append(" ".join(current_tokens))

            return chunks

        def chunk_paragraph(paragraph_lines: list[str], max_tokens: int = 200, max_lines: int = 8) -> list[str]:
            """
            Break a paragraph (list of lines) into multi-line chunks.
            Each chunk has at most `max_tokens` tokens *and* at most `max_lines` lines.
            
            Returns a list of strings, where each string is a multi-line chunk.
            """
            out_chunks: list[str] = []
            current_chunk_lines: list[str] = []
            current_token_count = 0

            for line in paragraph_lines:
                line_tokens = line.split()
                line_token_count = len(line_tokens)

                # If adding this line exceeds max_tokens or max_lines, 
                # we close off the current chunk and start a new one.
                if (current_token_count + line_token_count > max_tokens) or (len(current_chunk_lines) >= max_lines):
                    # finalize the current chunk as a multi-line string
                    out_chunks.append("\n".join(current_chunk_lines))  # <-- CHANGED
                    current_chunk_lines = []
                    current_token_count = 0

                # Now add this line to the current chunk
                current_chunk_lines.append(line)
                current_token_count += line_token_count

            # If there's leftover lines, add them as the last chunk
            if current_chunk_lines:
                out_chunks.append("\n".join(current_chunk_lines))  # <-- CHANGED

            return out_chunks

        def chunk_paragraph_new(paragraph_lines: list[str], max_tokens: int = 200) -> list[str]:
            """
            If you want headings merged with next line (suffix ':'), then
            do naive sentence splitting, never break mid-sentence, 
            and chunk up to 'max_tokens'.
            """
            return chunk_paragraph_by_sentence_with_heading_merge(paragraph_lines, max_tokens)
    
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
                    # Break large paragraphs into smaller multi-line chunks
                    #splitted_chunks = chunk_paragraph(paragraph_lines, max_tokens=200, max_lines=8)
                    splitted_chunks = chunk_paragraph_new(paragraph_lines, max_tokens=200)
                    for chunk_text in splitted_chunks:
                        # chunk_text is now a multi-line string
                        para_chunk_id = generate_id()
                        para_blob = Blob(
                            blob_type="text",
                            content=chunk_text,  # <-- store the multi-line string directly
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
            self.debug_print_lines(text_chunks)
            #table_chunks = self.extract_tables(pdf, page_chunks=page_chunks)
            image_chunks = self.extract_images(page_chunks)
        all_chunks = text_chunks + image_chunks
        
        # post process the chunks
        all_chunks = self.apply_pipeline(
                                            chunks=all_chunks,
                                            remove_blanks=True,
                                            merge_shorts=True
                                        )
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