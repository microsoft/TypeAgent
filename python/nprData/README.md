# NPR All Things Considered Dataset

This directory contains materials for generating and working with a corpus of NPR's All Things Considered podcast episodes. Within this directory is code to:

- Scrape transcripts from `https://npr.org`
- Generate chunks from the transcripts
- Create embeddings from the corpus
- Query the corpus using a local qdrant instance

## Getting Started

Follow these steps to set up the directory to run locally:

1. `pip install -r requirements.txt`
2. Create an `env_vars` file and add the necessary environment variables
3. `python qdrant_handler.py`

## Generating Dataset

In the event there is a need to generate the dataset, use the `generate_data` file:

- `python generate_data.py`

This will generate a new `npr.json` file containing the dataset.

## Generating Chunks with Embeddings

To generate chunks with embeddings, run

- `python generate_chunks.py`

This will generate chunks from the existing `npr.json` dataset and will create an embedding for each chunk using the set embedding model variable (right now only openai models are supported).

## Dataset Structure

The data is broken up into the following hierarchy:

```[python]
class Episode:
    id: str
    date: str
    sections: List[Section]

class Section:
    title: str
    transcript: List[Turn]
    id: str

class Turn:
    id: str
    speaker: str
    content: str
    speaker_role: str | None = None
```

Each podcast `Episode` contains a list of `Section` objects. These `Section` objects represent different topics discussed in the podcast episode. Each `Section` contains a list of `Turn` objects representing each turn in the dialogue for that section.

The `speaker_role` field corresponds to the speaker's role in the podcast. For example if the speaker is the host, then the `speaker_role` is `host`. If the speaker is from an organization, that speaker's role will be `organization`.

## Qdrant Instance

To get a locally running qdrant instance, please follow these steps from the Qdrant docs: https://qdrant.tech/documentation/quickstart/