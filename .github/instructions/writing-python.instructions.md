---
applyTo: '**/*.py'
---

No sycophancy. Be terse.

# For Agent mode

Use ripgrep (`rg`) for searching.

Never run git commands that many any changes. (`git status` and `git diff` are fine)

When the working directory is ~/TypeAgent/python/ta/:

- You don't need permission for any of the tool calls listed below
- Don't use '!' on the command line, it's some bash magic (even inside single quotes)
- Activate `.venv`
  - if this fails, run `make clean venv` and try again
- To get API keys in ad-hoc code, run `typeagent.aitools.utils.load_dotenv()`
- Use pytest to run tests in test/
- Use pyright to check type annotations in tools/, test/, typeagent/
- Ignore build/, dist/
- You can also use the pylance extension for type checking in VS Code
- Use `make check` to type-check all files
- Use `make test` to run all tests
- Use `make check test` to run `make check` and if it passes also run `make test`

**IMPORTANT! YOU ARE NOT DONE UNTIL `make check test format` PASSES**

# Code generation

When generating Python code (e.g. when translating TypeScript to Python),
please follow these guidelines:

* Assume Python 3.12

* Always strip trailing spaces

* Keep class and type names in `PascalCase`
* Use `python_case` for variable/field and function/method names

* Use `Literal` for unions of string literals
* Keep union notation (`X | Y`) for other unions
* Use `Protocol` for interfaces whose name starts with `I`
  followed by a capital letter
* Use `dataclass` for other classes and structured types
* Use `type` for type aliases (`PascalCase` again)
* Use `list`, `tuple`, `dict`, `set` etc., not `List` etc.

* Translate `foo?: string` to `foo: str | None = None`

* When writing tests:
  - don't mock; use the regular implementation (maybe introduce a fixture to create it)
  - assume `pytest`; use `assert` statements
  - match the type annotations of the tested functions
  - read the code of the tested functions to understand their behavior

* Don't put imports inside functions.
  Put them at the top of the file with the other imports.
  Exception: imports in a `if __name__ == "__main__":` block or a `main()` function.
  Another exception: pydantic and logfire.
  Final exception: to avoid circular import errors.

* Order imports alphabetically after lowercasing; group them as follows
  (with a blank line between groups):
  1. standard library imports
  2. established third-party libraries
  3. experimental third-party libraries (e.g. `typechat`)
  4. local imports (e.g. `from typeagent.knowpro import ...`)
