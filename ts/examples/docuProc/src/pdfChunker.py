# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import os
import subprocess
import sys

def is_tesseract_installed():
    try:
        subprocess.check_output(["tesseract", "--version"], stderr=subprocess.STDOUT)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False

def install_tesseract():
    if is_tesseract_installed():
        print("Tesseract is already installed.")
        return

    print("Installing Tesseract OCR...")
    try:
        if sys.platform == "win32":
            tesseract_path = "C:\\Program Files\\Tesseract-OCR\\tesseract.exe"
            if os.path.exists(tesseract_path):
                print("Tesseract is installed but not in PATH. Consider adding it.")
                return
            
            # Check if Chocolatey is available and install Tesseract
            try:
                subprocess.check_output(["choco", "--version"], stderr=subprocess.DEVNULL)
                print("Chocolatey found. Installing Tesseract using Chocolatey...")
                subprocess.check_call(["choco", "install", "-y", "tesseract"])
                return
            except (subprocess.CalledProcessError, FileNotFoundError):
                print("Chocolatey is not installed. Please install Tesseract manually from https://github.com/UB-Mannheim/tesseract.")
        elif sys.platform == "darwin":
            subprocess.check_call(["brew", "install", "tesseract"])  # macOS (Homebrew)
        elif sys.platform.startswith("linux"):
            subprocess.check_call(["sudo", "apt", "install", "-y", "tesseract-ocr"])  # Debian/Ubuntu
        else:
            print("Unsupported OS: Please install Tesseract manually.")
    except subprocess.CalledProcessError as e:
        print(f"Failed to install Tesseract: {e}")

def install_dependencies():
    required_packages = ["pdfplumber", "pymupdf", "pytesseract", "Pillow"]
    install_tesseract()
    for package in required_packages:
        try:
            __import__(package)
        except ImportError:
            print(f"Installing missing package: {package}...")
            try:
                subprocess.check_call([sys.executable, "-m", "pip", "install", "--user", package])
            except subprocess.CalledProcessError as e:
                print(f"Failed to install {package}: {e}")

install_dependencies()

import json
import pdfplumber # type: ignore
import fitz # type: ignore
import datetime
import csv
from dataclasses import dataclass
from typing import List, Dict, Any, Optional
import pytesseract # type: ignore
from PIL import Image # type: ignore

IdType = str

import os
import sys
import json
import subprocess
import pdfplumber  #type: ignore
import fitz  #type: ignore
import pytesseract #type: ignore
from PIL import Image #type: ignore
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

# Ensure required dependencies are installed
def install_dependencies():
    required_packages = ["pdfplumber", "pymupdf", "pytesseract", "Pillow"]
    for package in required_packages:
        try:
            __import__(package)
        except ImportError:
            print(f"Installing missing package: {package}...")
            try:
                subprocess.check_call([sys.executable, "-m", "pip", "install", "--user", package])
            except subprocess.CalledProcessError as e:
                print(f"Failed to install {package}: {e}")
                sys.exit(1)  # Exit if installation fails

install_dependencies()

@dataclass
class Blob:
    """A sequence of text, table, or image data plus metadata."""
    type: str  # "text", "table", "image"
    content: Any  # Text (list of lines), table (list of lists), image path (str)
    start: int  # Page number (0-based)
    bbox: Optional[List[float]] = None  # Bounding box if applicable
    img_path: Optional[str] = None  # Path to the image file

    def to_dict(self) -> Dict[str, Any]:
        result = {
            "type": self.type,
            "content": self.content,
            "start": self.start,
        }
        if self.bbox:
            result["bbox"] = self.bbox
        if self.img_path:
            result["img_path"] = self.img_path
        return result

@dataclass
class Chunk:
    """A chunk at any level of nesting (root, inner, leaf)."""
    id: IdType
    pageid: IdType
    blobs: list[Blob]  # Blobs around the placeholders
    parentId: IdType
    children: list[IdType]  # len() is one less than len(blobs)
    
    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "pageid": self.pageid,
            "blobs": self.blobs,
            "parentId": self.parentId,
            "children": self.children,
        }
@dataclass
class ChunkedFile:
    """A file with chunks."""

    fileName: str
    chunks: list[Chunk]

    def to_dict(self) -> dict[str, object]:
        return {
            "fileName": self.fileName,
            "chunks": self.chunks,
        }

@dataclass
class ErrorItem:
    """An error item."""

    error: str
    fileName: str
    output: str | None = None

    def to_dict(self) -> dict[str, str]:
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

    def extract_text_chunks(self, pdf, by_paragraph: bool = True) -> List[Chunk]:
        chunks = []
        for page_num, page in enumerate(pdf.pages):
            text = page.extract_text()
            if text:
                lines = text.split("\n")
                chunk_id = generate_id()
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
                chunk_id = generate_id()
                blobs = [Blob("table", table_path, page_num)]
                chunks.append(Chunk(chunk_id, str(page_num), blobs, "", []))
        return chunks

    def extract_images(self) -> list[Chunk]:
        chunks = []
        doc = fitz.open(self.file_path)
        for page_num in range(len(doc)):
            for img_index, img in enumerate(doc[page_num].get_images(full=True)):
                xref = img[0]
                img_rect = doc[page_num].get_image_rects(xref)  # Get bounding box

                pix = fitz.Pixmap(doc, xref)
                img_path = os.path.join(self.output_dir, f"image_{page_num}_{img_index}.png")
                print(f"Saving image to {img_path}")
                pix.save(img_path)
                print(f"Image xref {xref}")
                
                # Extract bounding box safely
                bbox = list(img_rect[0]) if img_rect else None  # Ensure bbox exists
                
                # Perform OCR on the extracted image
                try:
                    text = pytesseract.image_to_string(Image.open(img_path))
                    print(f"OCR extracted text: {text.strip()}")
                except Exception as e:
                    print(f"Error performing OCR on {img_path}: {e}")
                    text = ""

                chunk_id = generate_id()
                blobs = [Blob("image", text.strip().split("\n"), page_num, bbox, img_path)]
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
            print(json.dumps(chunked_file.chunks, default=custom_json, indent=2))
            json.dump(chunked_file.chunks, f, default=custom_json, indent=2)

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
