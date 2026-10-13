# Local whisper service

This project runs a [Faster Whisper](https://github.com/SYSTRAN/faster-whisper) model locally, exposing a local REST endpoint.
You can launch the service by running e.g. `python faster-whisper.py`.

## Setup

### Prerequisites

- [Python 3.9 or newer](https://wiki.python.org/moin/BeginnersGuide/Download)
- [Pip](https://pip.pypa.io/en/stable/installation/)
- **Windows**
  - [FFMpeg](https://www.gyan.dev/ffmpeg/builds/) - you can run `winget install ffmpeg` to install the package
- **Linux**
  - `apt-get -y install python3-pyaudio portaudio19-dev` - needed to install `pyaudio`
  - `apt-get -y install ffmpeg libavcodec-extra` - needed for audio decoding
  - `apt-get -y install cudnn9-cuda-12`- Follow instruction in [NVIDIA cuDNN on Linux](https://docs.nvidia.com/deeplearning/cudnn/latest/installation/linux.html) to enable NVIDIA network repository.
- **MacOS**
  - `brew install ffmpeg portaudio` - needed for audio decoding and `pyaudio`

### Install

Option 1: Batch file

- Windows:
  - Run [./setup.cmd](./setup.cmd)
- MacOS/Linux:
  - Run `source setup.sh`

Option 2: Manual steps

- Create and activate a python virtual environment.
- `pip config --site set global.extra-index-url https://download.pytorch.org/whl/cu121`
- `pip install -r requirements.txt`

### Verify Setup

Test if the installation worked by starting the backend `python faster-whisper.py`.

## Connecting to the running service

You can connect to the whisper service using the example "whisperClient" project in the `ts/examples` folder. To use it:

- Go to the repo's [ts/examples/whisperClient](../../../ts/examples/whisperClient/) folder
- Build the project using `pnpm run build`
- Start the web UI using `pnpm run start`

This web client will capture audio from microphone, send to the local service for transcription and show the result.

## Input and processing limits

The service accepts audio files up to **30 MiB** and recordings up to **five minutes**. The complete multipart request has a separate 30 MiB + 64 KiB limit for form headers. Both declared and streamed request sizes are checked before multipart parsing.

FFmpeg decodes only the first audio stream into 16 kHz mono 16-bit PCM, with bounded output and a 30-second decoding timeout. Oversized files or recordings return HTTP 413, invalid audio returns HTTP 400, and a decoding timeout returns HTTP 422. These responses contain an `error` message instead of transcription text.

One request is processed at a time, and one additional request can wait. Further requests receive HTTP 503 with `Retry-After: 1`. Processing remains reserved until the worker finishes, including when its client cancels. The Shell and example client display failures and stop the failed recording; start a new recording to retry.

## Offline tests

The tests use the installed FFmpeg executable and a small model stand-in, without downloading a Whisper model or requiring a GPU:

```shell
pip install -r requirements-test.txt
python -m unittest -v test_audio_limits
```
