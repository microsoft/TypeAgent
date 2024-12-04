# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

import argparse
import json
from chaparral.models.data import Dataset

class DataReader:

    dataset: Dataset

    def load_text_file(self, filename: str) -> Dataset:
        with open(filename, "r") as file:
            raw_data = json.load(file)

            dataset = None
            if isinstance(raw_data, list):
                dataset = Dataset.from_list(raw_data)

            if isinstance(raw_data, dict):
                dataset = Dataset.from_dict(raw_data)

            self.dataset = dataset
            return dataset

if __name__ == "__main__":

    parser = argparse.ArgumentParser(description="Read data from a file.")
    parser.add_argument("filename", type=str, help="The name of the file to read from.")

    args = parser.parse_args()
    print(args.filename)

    reader = DataReader()
    reader.load_text_file(args.filename)
    print(reader.dataset.info_pairs[0].knowledge.to_dict())