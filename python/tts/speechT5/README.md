# Local TTS using SpeechT5 for TypeAgent shell

This directory contains an example of local Text to speech (TTS) server that works with the [TypeAgent shell](../../../ts/packages/shell/). TTS is implemented using [SpeechT5](https://github.com/microsoft/SpeechT5) framework and the

## Setup

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

### Usage

- Start the service `python speechT5.py`
- In [TypeAgent shell](../../../ts/packages/shell), change the TTS provider to local and choose a voice.
