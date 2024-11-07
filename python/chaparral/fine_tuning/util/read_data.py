import argparse
import json

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Utility tool for reading i/o txt file data")
    parser.add_argument("filename", type=str, help="The name of the file to read from.")

    args = parser.parse_args()

    print(args.filename)

    with open(args.filename, "r") as file:
        data = json.load(file)

        prompt = data["prompt"]
        info_pairs = data["infoPairs"]

        print("Prompt:", prompt)
        exit()

        for pair in info_pairs:
            print(f"Pair message: {pair['message']}")
            print(f"Pair knowledge: {pair['knowledge']}")
            print("\n")

        # Next:
        # 1. Make structs for this input data so that it can be loaded into memory
        # 2. Write an input assembly method that takes info pair and constructs
        #    a proper input from it (prompt + input pair message) => knowledge
        # 3. Begin researching how to construct a fine tuning pipeline around this