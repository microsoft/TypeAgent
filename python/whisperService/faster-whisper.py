# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from io import BytesIO
from pydub import AudioSegment
import uvicorn
import numpy as np
import torch
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging
from faster_whisper import WhisperModel

import os
os.environ['KMP_DUPLICATE_LIB_OK']='True'

# Configure logging
logging.basicConfig(level=logging.ERROR, format='%(asctime)s - %(levelname)s - %(message)s')

# Initialize the app
app = FastAPI()

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


@app.post("/transcribe/")
async def transcription(file: UploadFile = File(...)):
    try:
        audio_bytes = await file.read()

        # Use pydub to handle different audio formats and convert audio
        audio = AudioSegment.from_file(BytesIO(audio_bytes))
        audio = audio.set_channels(1).set_frame_rate(16000).set_sample_width(2)

        # Convert data from 16 bit wide integers to floating point with a width of 32 bits.
        # Clamp the audio stream frequency to a PCM wavelength compatible default of 32768hz max.
        audio_np = (
            np.frombuffer(audio.raw_data, dtype=np.int16).astype(np.float32) / 32768.0
        )

        # faster_whisper returns a generator. Iterate though it to get the transcription
        segments, _ = model.transcribe(audio_np)
        segments = list(segments)
        transcription = "\n".join(i.text for i in segments)

        return JSONResponse(content={"transcription": transcription}, status_code=200)
    except Exception as e:
        logging.error("An error occurred during transcription", exc_info=True)
        return JSONResponse(content={"error": "An internal error has occurred!"}, status_code=500)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
