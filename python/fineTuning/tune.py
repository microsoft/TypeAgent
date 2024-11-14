# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

from chaparral.train.trainer import Trainer
from chaparral.util.datareader import DataReader
from chaparral.train.hf_model import HFModel
import argparse

def parse_args():
    parser = argparse.ArgumentParser(description="Fine-tune a model with given dataset.")
    parser.add_argument("--dataset_file", help="Path to the dataset file.")
    parser.add_argument("--model_name", default="mistralai/Mixtral-8x7b-v0.1", help="Name of the model to fine-tune.")
    return parser.parse_args()

if __name__ == "__main__":
    args = parse_args()
    dataset_file = args.dataset_file

    # load dataset
    dataset = DataReader().load_text_file(dataset_file)

    # format data into train and eval sets
    train_set, eval_set = dataset.create_train_eval_sets()

    # load model
    model_name = "mistralai/Mixtral-8x7b-v0.1"
    model = HFModel(model_name)

    model.train()
    # save model
    # pytorch should save this automatically
    # need to put in code to control output dir

    # 1. Update data reader to format data into the mixtral format
    # 2. Using transformers load formatted data in and split it
    #    between train and eval
    # 3. Add code to tokenize
    # 4. Make an hf_trainer.py file and use the Trainer class
    #    from HF to see if you can train that way otherwise we will do the raw
    #    dog torch way
    # 5. get the mixtral fine tuning repo working as well so we can compare
    #    results