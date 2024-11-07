# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

from chaparral.train.trainer import Trainer
from chaparral.util.datareader import DataReader
from chaparral.train.model import Model

if __name__ == "__main__":
    print("now tuning... 🎷")

    # load dataset
    dataset = DataReader().load_text_file("tr2_data.txt")

    # format data into train and eval sets
    train_set, eval_set = dataset.create_train_eval_sets()

    # load model
    model_name = "mistralai/Mixtral-8x7b-v0.1"
    model = Model(model_name)

    # init trainer
    trainer = Trainer()

    # pass data, params to trainer
    trainer.set_data(train_set, eval_set)

    # train model
    trainer.train()

    # save model
    # pytorch should save this automatically
    # need to put in code to control output dir
