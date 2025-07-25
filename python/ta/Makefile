# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

# This is Guido's Makefile. Please don't make it complicated.

.PHONY: all
all: venv format check test build

.PHONY: format
format: venv
	.venv/bin/black typeagent test tools

.PHONY: check
check: venv
	.venv/bin/pyright --pythonpath .venv/bin/python typeagent test tools

.PHONY: test
test: venv
	.venv/bin/python -m coverage run --source=typeagent -m pytest test

.PHONY: demo
demo: venv
	.venv/bin/python -m tools.utool $(FLAGS)

.PHONY: compare
compare: venv
	.venv/bin/python -m tools.utool --batch $(FLAGS)

.PHONY: mcp
mcp: venv
	.venv/bin/mcp dev typeagent/mcp/server.py

.PHONY: profile
profile: venv
	</dev/null .venv/bin/python -m cProfile -s ncalls -m test.cmpsearch --interactive --podcast ~/AISystems-Archive/data/knowpro/test/indexes/All_Episodes_index | head -60

.PHONY: scaling
scaling: venv
	</dev/null .venv/bin/python -m test.cmpsearch --interactive --podcast ~/AISystems-Archive/data/knowpro/test/indexes/All_Episodes_index

.PHONY: build
build: venv
	.venv/bin/python -m build --wheel

.PHONY: venv
venv: .venv

.venv:
	@echo "(If 'uv' fails with 'No such file or directory', try 'make install-uv')"
	uv sync -q
	@.venv/bin/black --version | sed 's/, / /'
	@.venv/bin/pyright --version
	@.venv/bin/pytest --version

install-uv:
	curl -Ls https://astral.sh/uv/install.sh | sh

.PHONY: clean
clean:
	rm -rf build dist venv .venv *.egg-info
	rm -f *_data.json *_embedding.bin
	find . -type d -name __pycache__ | xargs rm -rf

.PHONY: help
help:
	@echo "Usage: make [target]"
	@echo "make help        # Help (this message)"
	@echo "make             # Same as 'make all'"
	@echo "make all         # venv, format, check, test, build"
	@echo "make format      # Run black"
	@echo "make check       # Run pyright"
	@echo "make test        # Run pytest (tests are in test/)"
	@echo "make build       # Build the wheel (under dist/)"
	@echo "make demo        # python tools/utools.py (interactive)"
	@echo "make compare     # python tools/utools.py --batch"
	@echo "make venv        # Create .venv/"
	@echo "make clean       # Remove build/, dist/, .venv/, *.egg-info/"
	@echo "make install-uv  # Install uv (if not already installed)"
