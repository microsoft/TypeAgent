import json
from tqdm import tqdm

with open("npr_chunks.json", "r") as f:
    data = json.load(f)

for chunk in tqdm(data):
    del chunk["embedding"]

with open("npr_chunks_no_embedding.json", "w") as f:
    json.dump(data, f, indent=4)
