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
            try:
                subprocess.check_output(["choco", "--version"], stderr=subprocess.DEVNULL)
                subprocess.check_call(["choco", "install", "-y", "tesseract"])
                return        
            except (subprocess.CalledProcessError, FileNotFoundError):
                print("Chocolatey is not installed. Please install Tesseract manually from https://github.com/UB-Mannheim/tesseract.")
        elif sys.platform == "darwin":
            subprocess.check_call(["brew", "install", "tesseract"])
        elif sys.platform.startswith("linux"):
            subprocess.check_call(["sudo", "apt", "install", "-y", "tesseract-ocr"])
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

    def extract_text_chunks(self, pdf, by_paragraph: bool = True) -> List[Chunk]:
        chunks = []
        for page_num, page in enumerate(pdf.pages):
            text = page.extract_text()
            if text:
                paragraphs = text.split("\n\n") if by_paragraph else [text]
                chunk_id = generate_id()
                blobs = [Blob("text", para.split("\n"), page_num, para_id=i) for i, para in enumerate(paragraphs)]
                chunks.append(Chunk(chunk_id, str(page_num), blobs, "", []))
        return chunks

    def extract_tables(self, pdf) -> List[Chunk]:
        chunks = []
        for page_num, page in enumerate(pdf.pages):
            for table in page.extract_tables():
                table_path = os.path.join(self.output_dir, f"table_{page_num}_{generate_id()}.csv")
                with open(table_path, "w", newline="") as f:
                    csv.writer(f).writerows(table)
                chunks.append(Chunk(generate_id(), str(page_num), [Blob("table", table_path, page_num)], "", []))
        return chunks

    def extract_images(self) -> List[Chunk]:
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
                chunks.append(Chunk(generate_id(), str(page_num), [Blob("image", text.strip().split("\n"), page_num, bbox, img_path=img_path)], "", []))
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