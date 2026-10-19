"""Fetch unresolved review comments for a PR."""
import argparse


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--pr", type=int, required=True, help="PR number")
    p.add_argument("--since", default="30d", help="Age window, e.g. 7d")
    print(p.parse_args())


if __name__ == "__main__":
    main()
