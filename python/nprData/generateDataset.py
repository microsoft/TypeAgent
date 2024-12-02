# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

import json
import random
from structs import Chunk
from typing import List

filenameBase = 'npr_chunks_no_embedding'
pctTrain = 0.8
pctVal = 0.1
pctTest = 0.1

# creates a random list of chunks, with length samplesTotal
def createRandomIndexList(chunks: List[Chunk], samplesTotal: int = 5000) -> List[int]:   
    indexList = random.sample(range(len(chunks)), samplesTotal)
    return indexList

with open(filenameBase + '.json') as f:
    chunks = json.load(f)
    samplesTotal = 5000
    randomList = createRandomIndexList(chunks, samplesTotal=samplesTotal)
    trainList = randomList[:int(pctTrain * samplesTotal)]
    valList = randomList[int(pctTrain * samplesTotal):int((pctTrain + pctVal) * samplesTotal)]
    testList = randomList[int((pctTrain + pctVal) * samplesTotal):]
    # write train, val, and test files with the corresponding chunks
    with open(filenameBase + '_train.json', 'w') as ftrain:
        json.dump([chunks[i] for i in trainList], ftrain, indent=4)
    with open(filenameBase + '_val.json', 'w') as fval:
        json.dump([chunks[i] for i in valList], fval, indent=4)
    with open(filenameBase + '_test.json', 'w') as ftest:
        json.dump([chunks[i] for i in testList], ftest, indent=4)
    
    print("Train, val, and test files created successfully!")