# Unsloth Fine-Tuning Tools

This directory contains tools for fine-tuning language models using the [Unsloth](https://github.com/unslothai/unsloth) library, along with keyword extraction and analysis utilities.

## Overview

The tools in this directory support:
- **Model Training**: Fine-tune LLMs with LoRA using Unsloth for optimized training
- **Batch Inference**: Run inference on datasets using fine-tuned models
- **Keyword Extraction**: Extract keywords and entities using multiple NLP methods

## Files

### `trainEntities.py`
Fine-tunes a language model (default: Phi-4) using LoRA adapters for knowledge extraction tasks.

**Features:**
- Uses 4-bit quantization to reduce memory usage
- Supports multiple pre-quantized models (Llama, Mistral, Phi, Gemma)
- Applies LoRA with configurable rank and target modules
- Outputs trained model to specified directory

**Usage:**
```bash
python trainEntities.py
```

### `batchInfer.py`
Runs batch inference on a dataset using a fine-tuned model.

**Arguments:**
| Argument | Default | Description |
|----------|---------|-------------|
| `--model_path` | `/data/phi-4-lora-3200` | Path to the pre-trained model |
| `--dataset_path` | `/data/npr_chunks_no_embedding_seed127_samples5000_test.json` | Path to the dataset file |
| `--output_file` | `batchOutput.txt` | Path to the output file |

**Usage:**
```bash
python batchInfer.py --model_path /path/to/model --dataset_path /path/to/data.json --output_file results.txt
```

### `knowledgePrompt.py`
Defines the knowledge extraction prompt template used for training and inference. Generates prompts that instruct the model to extract entities, actions, and relationships from conversation messages.

### `baseExtract.py`
Extracts and analyzes word distributions from a dataset with filtering capabilities.

**Arguments:**
| Argument | Default | Description |
|----------|---------|-------------|
| `--dataset_path` | `/data/npr/npr_chunks_no_embedding.json` | Path to the dataset file |
| `--output_file` | `reformatted_data.txt` | Path to the output file |
| `--maxMsgPct` | `0.005` | Maximum message percentage threshold for filtering words (0.0-1.0) |

**Features:**
- Processes messages by section
- Filters high-frequency words based on message percentage threshold
- Generates word distribution statistics and visualizations
- Outputs section data with word lists and token counts

**Usage:**
```bash
python baseExtract.py --dataset_path /path/to/data.json --maxMsgPct 0.01
```

### `nltkExtract.py`
Comprehensive keyword and entity extraction using multiple NLP methods.

**Arguments:**
| Argument | Default | Description |
|----------|---------|-------------|
| `--dataset_path` | `/data/npr_chunks_no_embedding_seed127_samples5000_test.json` | Path to the dataset file |
| `--max_length` | `1` | Maximum number of words in a keyword phrase |
| `--output_file` | `extraction.txt` | Path to the output file |
| `--verbose` | `false` | Enable verbose output |
| `--nogpu` | `false` | Force CPU usage instead of GPU |

**Extraction Methods:**
- **RAKE** (Rapid Automatic Keyword Extraction)
- **YAKE** (Yet Another Keyword Extractor)
- **KeyBERT** (BERT-based keyword extraction)
- **NLTK** Named Entity Recognition
- **spaCy** Noun/verb phrase extraction and dependency parsing

**Usage:**
```bash
python nltkExtract.py --dataset_path /path/to/data.json --max_length 2 --verbose
```

## Installation

Install the required dependencies:

```bash
pip install -r requirements.txt
```

### Additional Setup

1. **spaCy model**: Download the English model:
   ```bash
   python -m spacy download en_core_web_sm
   ```

2. **NLTK data**: Download required NLTK data:
   ```python
   import nltk
   nltk.download('punkt')
   nltk.download('averaged_perceptron_tagger')
   nltk.download('maxent_ne_chunker')
   nltk.download('words')
   ```

## Data Format

The tools expect JSON datasets with the following structure:

```json
[
  {
    "speaker": "Speaker Name",
    "content": "Message content text...",
    "section_title": "Section Title"
  }
]
```

## Output

- **Training**: Saves LoRA adapters and tokenizer to the specified output directory
- **Inference**: Generates text file with extracted knowledge responses and timing statistics
- **Keyword Extraction**: Outputs extracted keywords, entities, and analysis results

## License

Copyright (c) Microsoft Corporation and Henry Lucco.
Licensed under the MIT License.
