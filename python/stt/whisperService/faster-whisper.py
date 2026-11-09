# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import asyncio
from pathlib import Path
import subprocess
import tempfile
import uvicorn
import numpy as np
import torch
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.datastructures import Headers, State
from starlette.types import ASGIApp, Message, Receive, Scope, Send
import logging
from faster_whisper import WhisperModel

import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "True"

# Configure logging
logging.basicConfig(
    level=logging.ERROR,
    format="%(asctime)s - %(levelname)s - %(message)s",
)

MAX_UPLOAD_BYTES = 30 * 1024 * 1024
MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 64 * 1024
MAX_AUDIO_SECONDS = 300
SAMPLE_RATE = 16000
UPLOAD_TIMEOUT_SECONDS = 30
DECODE_TIMEOUT_SECONDS = 30
READ_CHUNK_BYTES = 64 * 1024


class TranscriptionInputMiddleware:
    def __init__(self, app: ASGIApp, state: State) -> None:
        self.app = app
        self.state = state
        self.lock = asyncio.Lock()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or scope["method"] != "POST"
            or scope["path"].rstrip("/") != "/transcribe"
        ):
            await self.app(scope, receive, send)
            return

        async def reject(status: int, message: str) -> None:
            response = JSONResponse(
                {"error": message},
                status_code=status,
                headers={"Retry-After": "1"} if status == 503 else None,
            )
            await response(scope, receive, send)

        content_length = Headers(scope=scope).get("content-length")
        if content_length is not None:
            if not content_length.isdecimal() or len(content_length) > 20:
                await reject(400, "Invalid request size.")
                return
            if int(content_length) > MAX_REQUEST_BYTES:
                await reject(
                    413, "The audio upload exceeds the request size limit."
                )
                return
        if self.state.pending_transcriptions >= 2:
            await reject(503, "The transcription service is busy. Try again shortly.")
            return

        self.state.pending_transcriptions += 1
        try:
            async with self.lock:
                with tempfile.SpooledTemporaryFile(max_size=1024 * 1024) as body:
                    size = 0
                    loop = asyncio.get_running_loop()
                    upload_deadline = loop.time() + UPLOAD_TIMEOUT_SECONDS
                    while True:
                        try:
                            message = await asyncio.wait_for(
                                receive(), timeout=upload_deadline - loop.time()
                            )
                        except asyncio.TimeoutError:
                            await reject(408, "The audio upload exceeded the time limit.")
                            return
                        if message["type"] == "http.disconnect":
                            return
                        if message["type"] != "http.request":
                            raise RuntimeError("Unexpected transcription request message.")
                        chunk = message.get("body", b"")
                        size += len(chunk)
                        if size > MAX_REQUEST_BYTES:
                            await reject(413, "The audio upload exceeds the request size limit.")
                            return
                        body.write(chunk)
                        if not message.get("more_body", False):
                            break
                    body.seek(0)

                    async def replay() -> Message:
                        chunk = body.read(READ_CHUNK_BYTES)
                        return {
                            "type": "http.request",
                            "body": chunk,
                            "more_body": body.tell() < size,
                        }

                    await self.app(scope, replay, send)
        finally:
            self.state.pending_transcriptions -= 1


# Initialize the app
app = FastAPI()
app.state.pending_transcriptions = 0
app.add_middleware(TranscriptionInputMiddleware, state=app.state)

# allow all cors
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load the Whisper model
print("Loading model...")
device = "cuda" if torch.cuda.is_available() else "cpu"
compute_type = "float16" if torch.cuda.is_available() else "default"
model = WhisperModel("medium.en", device=device, compute_type=compute_type)
print("Model loaded!")


def decode_audio(audio_bytes: bytes) -> np.ndarray:
    max_samples = int(MAX_AUDIO_SECONDS * SAMPLE_RATE)
    with tempfile.TemporaryDirectory(prefix="typeagent-whisper-") as directory:
        source = Path(directory) / "audio"
        source.write_bytes(audio_bytes)
        try:
            result = subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-nostdin",
                    "-loglevel",
                    "fatal",
                    "-max_alloc",
                    str(64 * 1024 * 1024),
                    "-threads",
                    "1",
                    "-protocol_whitelist",
                    "file",
                    "-i",
                    str(source),
                    "-map",
                    "0:a:0",
                    "-vn",
                    "-sn",
                    "-dn",
                    "-ac",
                    "1",
                    "-ar",
                    str(SAMPLE_RATE),
                    "-t",
                    str((max_samples + 1) / SAMPLE_RATE),
                    "-fs",
                    str((max_samples + 1) * 2),
                    "-f",
                    "s16le",
                    "pipe:1",
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=DECODE_TIMEOUT_SECONDS,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise HTTPException(
                422, "Audio decoding exceeded the processing time limit."
            ) from error
    if result.returncode != 0 or not result.stdout or len(result.stdout) % 2:
        raise HTTPException(400, "Audio could not be decoded.")
    if len(result.stdout) > max_samples * 2:
        raise HTTPException(413, "The audio recording exceeds the duration limit.")
    audio = np.frombuffer(result.stdout, dtype="<i2").astype(np.float32)
    audio /= 32768.0
    return audio


def transcribe_audio(audio_bytes: bytes) -> str:
    segments, _ = model.transcribe(decode_audio(audio_bytes))
    return "\n".join(segment.text for segment in segments)


@app.post("/transcribe/")
async def transcription(file: UploadFile = File(...)) -> JSONResponse:
    try:
        audio_bytes = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(audio_bytes) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "The audio file exceeds the upload size limit.")
        worker = asyncio.create_task(asyncio.to_thread(transcribe_audio, audio_bytes))
        try:
            text = await asyncio.shield(worker)
        except asyncio.CancelledError:
            cleanup = asyncio.gather(worker, return_exceptions=True)
            while not cleanup.done():
                try:
                    await asyncio.shield(cleanup)
                except asyncio.CancelledError:
                    continue
            results = cleanup.result()
            if isinstance(results[0], Exception):
                logging.error("Cancelled transcription failed", exc_info=results[0])
            raise
        return JSONResponse(content={"transcription": text}, status_code=200)
    except HTTPException as error:
        logging.warning("Audio input rejected: %s", error.detail)
        return JSONResponse(
            content={"error": error.detail}, status_code=error.status_code
        )
    except Exception:
        logging.error("An error occurred during transcription", exc_info=True)
        return JSONResponse(
            content={"error": "An internal error has occurred!"}, status_code=500
        )


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
