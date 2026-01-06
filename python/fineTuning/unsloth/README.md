# Unsloth Fine-Tuning Tools

This folder contains tools for fine-tuning language models using the [Unsloth](https://github.com/unslothai/unsloth) library, specifically focused on knowledge extraction tasks.

## Overview

These scripts enable training and inference of language models to extract structured knowledge (entities, actions, relationships) from conversational text, particularly NPR podcast transcripts.

## Files

### Training & Inference

| File | Description |
|------|-------------|
| [trainEntities.py](trainEntities.py) | Fine-tunes a language model (e.g., Phi-4) using LoRA adapters to extract knowledge from text. Supports 4-bit quantization for efficient training. |
| [batchInfer.py](batchInfer.py) | Runs batch inference on a dataset using a trained model to extract knowledge structures. |
| [knowledgePrompt.py](knowledgePrompt.py) | Contains the prompt template that defines the knowledge extraction schema (entities, actions, facets). |

### Keyword Extraction

| File | Description |
|------|-------------|
| [nltkExtract.py](nltkExtract.py) | Extracts keywords from datasets using multiple methods: NLTK-RAKE, YAKE, KeyBERT, and spaCy. |
| [baseExtract.py](baseExtract.py) | Basic word extraction and analysis from dataset messages. |

## Requirements

- Python 3.10+
- CUDA-capable GPU (recommended)
- Dependencies (install via pip):
  ```
  unsloth
  torch
  transformers
  datasets
  rake-nltk
  yake
  keybert
  spacy
  sentence-transformers
  ```

For spaCy, download the English model:
```bash
python -m spacy download en_core_web_sm
```

## Usage

### Training a Model

```bash
python trainEntities.py
```

This script:
1. Loads a pre-trained model (default: `unsloth/Phi-4`)
2. Applies LoRA adapters for efficient fine-tuning
3. Trains on knowledge extraction data
4. Saves the fine-tuned model to `/data/phi-4-lora-3200`

### Batch Inference

```bash
python batchInfer.py --model_path /data/phi-4-lora-3200 --dataset_path /data/dataset.json --output_file results.txt
```

Arguments:
- `--model_path`: Path to the fine-tuned model
- `--dataset_path`: Path to input JSON dataset
- `--output_file`: Path for output results

### Keyword Extraction

```bash
python nltkExtract.py --dataset_path /data/dataset.json --output_file extraction.txt --max_length 1 --verbose
```

Arguments:
- `--dataset_path`: Path to input JSON dataset
- `--max_length`: Maximum words in keyword phrases
- `--output_file`: Path for output results
- `--verbose`: Enable detailed output
- `--nogpu`: Force CPU usage instead of GPU

## Knowledge Schema

The knowledge extraction prompt defines the following TypeScript types:

- **ConcreteEntity**: Named entities with types and facets
- **Action**: Verbs with subjects, objects, and tense
- **Facet**: Properties/attributes of entities
- **KnowledgeResponse**: Combined entities and actions

## Model Support

The training script supports various 4-bit quantized models including:
- Llama 3.1 (8B, 70B, 405B)
- Mistral (7B, Nemo 12B)
- Phi-3.5, Phi-4
- Gemma 2 (9B, 27B)

## License

Copyright (c) Microsoft Corporation and Henry Lucco.  
Licensed under the MIT License.
