# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from io import BytesIO
import wave;
import uvicorn
import logging
import torch
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from transformers import pipeline
from datasets import load_dataset
import struct
from pydantic import BaseModel
import time

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

# Load the model
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
print('Using device:', device)
print("Loading model...")
synthesizer = pipeline("text-to-speech", "microsoft/speecht5_tts", device=device)
embeddings_dataset = load_dataset("Matthijs/cmu-arctic-xvectors", split="validation")
filenames = []
for (i, x) in enumerate(embeddings_dataset):
    filenames.append([x["filename"],str(i)])
speaker_embeddings = list(map((x := lambda x: torch.tensor(x["xvector"]).unsqueeze(0)), embeddings_dataset));

print("Model loaded!")


@app.get("/voices")
async def voices():
    return JSONResponse(content=filenames, status_code=200)

class SynthesizeRequest(BaseModel):
    text: str
    voiceName: str | None = None

@app.post("/synthesize")
async def synthesize(data: SynthesizeRequest):
    try:
        text = data.text
        if data.voiceName is None:
            voiceName = 7306
        else:
            voiceName = int(data.voiceName)
        print("Synthesizing with voice", voiceName, ":", text)
        start = time.time()
        speech = synthesizer(text, forward_params={"speaker_embeddings": speaker_embeddings[voiceName]})
        end = time.time()
        print("Synthesized in", end-start, "seconds")
        byte_io = BytesIO()
        f = wave.open(byte_io, 'wb')
        f.setnchannels(1)
        f.setsampwidth(3)        
        f.setframerate(speech["sampling_rate"])
        data_as_bytes = (struct.pack('<i', int(samp*(2**23-1))) for samp in speech["audio"])
        for data_bytes in data_as_bytes:
            f.writeframes(data_bytes[0:3])
        f.close()
        byte_io.seek(0)
        print("Written in", time.time()-end, "seconds")  
        return StreamingResponse(byte_io, media_type="audio/wav")        
    except Exception as e:
        logging.error("An error occurred during synthesize", exc_info=True)
        return JSONResponse(content={"error": "An internal error has occurred!"}, status_code=500)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8002)
