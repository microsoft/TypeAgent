<!-- Copyright (c) Microsoft Corporation.
     Licensed under the MIT License. -->

# Action Grammar Language Support

Syntax highlighting for Action Grammar (.agr) files used in TypeAgent.

## Features

### Syntax Highlighting

- Rule definitions (`<RuleName> = ...;`) and rule references (`<RuleName>`)
- Capture syntax (`$(name:Type)` and `$(name)`)
- Action objects with embedded JavaScript syntax
- Operators (`|`, `?`, `*`, `+`), comments (`//`)
- Bracket matching and auto-closing pairs

### Language Server (LSP)

The extension includes an LSP server powered by `grammar-tools-core`:

- **Diagnostics**: Parse errors and warnings reported inline as you type
- **Go to Definition**: Jump from a `<RuleName>` reference to its definition
- **Find References**: Find all usages of a rule across the file
- **Hover**: See rule signatures and alternative counts on hover
- **Document Formatting**: Format `.agr` files (parse-and-rewrite round-trip)
- **Document Symbols**: Outline view showing all rule definitions

## Grammar Syntax Elements

### Rule Definitions

```agr
<RuleName> = pattern1 | pattern2;
```

### Captures

```agr
$(variableName:Type)  // Capture with type
$(variableName)       // Capture reference
```

### Rule References

```agr
<OtherRule>
```

### Action Objects

```agr
-> { actionName: "action", parameters: { ... } }
```

## Installation

### From Source (Development)

1. Navigate to the extension directory:

   ```bash
   cd extensions/agr-language
   ```

2. Install the extension using the VS Code CLI:

   ```bash
   code --install-extension .
   ```

   Or manually copy to your extensions folder:

   - **Windows**: `%USERPROFILE%\.vscode\extensions\agr-language-0.0.1\`
   - **macOS/Linux**: `~/.vscode/extensions/agr-language-0.0.1/`

3. Reload VS Code:
   - Press `F1` or `Ctrl+Shift+P` (Windows/Linux) / `Cmd+Shift+P` (macOS)
   - Type "Reload Window" and press Enter

### Using VSCE (Production)

To package and publish this extension:

```bash
# Install VSCE if not already installed
npm install -g @vscode/vsce

# Package the extension
vsce package

# Install the generated .vsix file
code --install-extension agr-language-0.0.1.vsix
```

## Testing

Open any `.agr` file to see syntax highlighting in action. A sample file is included: `sample.agr`

## Development

This extension uses TextMate grammar for syntax highlighting and an LSP server for language intelligence.

- **Syntax highlighting**: Defined in `syntaxes/agr.tmLanguage.json`
- **LSP server**: `src/server.ts` (diagnostics, definitions, references, hover, formatting, symbols)
- **LSP client**: `src/client.ts` (launches the server)

To modify the grammar:

1. Edit `syntaxes/agr.tmLanguage.json`
2. Reload VS Code to see changes
3. Use the scope inspector to debug: `Developer: Inspect Editor Tokens and Scopes`

To modify LSP features:

1. Edit `src/server.ts`
2. Run `pnpm run build` in this directory
3. Reload VS Code to pick up changes

## License

MIT - See [LICENSE](../../LICENSE) for details

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
