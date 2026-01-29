<!-- Copyright (c) Microsoft Corporation.
     Licensed under the MIT License. -->

# AGR Language Extension - Implementation Overview

## What Was Created

A VS Code extension providing syntax highlighting for Action Grammar (.agr) files used in the TypeAgent project.

## File Structure

```
extensions/agr-language/
├── package.json                    # Extension manifest
├── language-configuration.json     # Bracket matching and auto-closing pairs
├── syntaxes/
│   └── agr.tmLanguage.json        # TextMate grammar definition
├── README.md                       # User documentation
├── INSTALLATION.md                 # Installation instructions
└── .vscodeignore                   # Files to exclude from packaging
```

## Key Features Implemented

### 1. Syntax Elements Highlighted

- **Rule Definitions**: `@ <RuleName> = ...`

  - `@` operator in keyword color
  - Rule names in type color
  - Assignment operator `=` highlighted

- **Rule References**: `<RuleName>`

  - Angle brackets and rule name highlighted as type references

- **Captures**:

  - `$(name:Type)` - capture with type annotation
  - `$(name)` - capture reference
  - Different colors for capture operator, variable name, and type

- **Action Objects**: `-> { ... }`

  - Arrow operator highlighted
  - Embedded JavaScript syntax highlighting inside braces

- **Operators**: `|`, `?`, `*`, `+`

  - Alternation, optional, zero-or-more, one-or-more

- **Comments**: `// ...`

  - Standard line comments

- **String Literals**: `"..."` and `'...'`
  - With escape sequence support

### 2. Editor Features

- Auto-closing pairs for brackets: `()`, `[]`, `{}`, `<>`
- Bracket matching for all bracket types
- Auto-closing for quotes
- Comment toggling support

## Technical Implementation

### TextMate Grammar Structure

The grammar uses a repository-based pattern system:

```json
{
  "scopeName": "source.agr",
  "patterns": [
    { "include": "#comments" },
    { "include": "#rule-definition" },
    { "include": "#action-object" }
  ],
  "repository": {
    "rule-definition": { ... },
    "capture": { ... },
    "rule-reference": { ... },
    ...
  }
}
```

### Scope Naming Convention

Uses standard TextMate scope names for compatibility with all VS Code themes:

- `keyword.operator.rule.agr` - Rule operators
- `entity.name.type.rule.agr` - Rule names
- `variable.parameter.capture.agr` - Capture variables
- `comment.line.double-slash.agr` - Comments
- `meta.embedded.block.javascript` - Embedded JS in action objects

### Embedded Language Support

Action objects (`-> { }`) use embedded JavaScript syntax highlighting by including `source.js`, allowing full JS syntax support within action definitions.

## Installation Status

✅ Extension has been installed to: `~/.vscode/extensions/agr-language-0.0.1`

To activate:

1. Reload VS Code window (`Ctrl+Shift+P` → "Reload Window")
2. Open any `.agr` file to see syntax highlighting

## Testing

Test file: [playerSchema.agr](../../packages/agents/player/src/agent/playerSchema.agr)

Expected highlighting:

- Green/gray comments
- Colorized rule names in `@ <Name>`
- Distinct colors for captures `$(name:Type)`
- Blue/purple keywords for operators
- JS syntax in action objects

## References

- [VS Code Syntax Highlight Guide](https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide)
- [TextMate Language Grammar Guide](https://macromates.com/manual/en/language_grammars)
- [VS Code Extension API](https://code.visualstudio.com/api)

## Future Enhancements

Potential improvements:

- Semantic highlighting for rule references (detect undefined rules)
- IntelliSense for rule names
- Grammar validation
- Code folding for multi-line rules
- Hover information for captures and rule references
