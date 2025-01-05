# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

import json

from chaparral.models.data import ChapparalDataset
from chaparral.prompts.knowledge import get_knowledge_prompt

if __name__ == "__main__":

    dataset_file = "./gpt4o_train_200.json"

    with open(dataset_file, "r") as in_file:
        data = json.load(in_file)

    dataset = ChapparalDataset.from_list(data)

    items = []
    for pair in dataset.info_pairs:
        items.append({
            "instruction" : get_knowledge_prompt(pair.message),
            "input": "",
            "output" : pair.knowledge.to_str()
        })

    print(len(items[0]["instruction"]), len(items[0]["output"]), len(items[0]["instruction"]) + len(items[0]["output"]))
    exit()

    with open("gpt4o_train_200_converted.json", "w") as out_file:
        json.dump(items, out_file)
