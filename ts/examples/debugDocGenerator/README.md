# Debug Documentation Generator

> **Note**: This project was created with AI assistance using Claude Sonnet 4 via GitHub Copilot in VS Code.

> **Sample Output**: See `debug-hierarchy.md` in this directory for an example of the generated documentation.

This tool generates a hierarchical markdown document that lists all `registerDebug` calls in the TypeAgent codebase, making it easy to discover which debug namespaces are available for debugging specific components.

## Purpose

When debugging TypeAgent, you need to enable specific debug namespaces using the `DEBUG` environment variable. However, finding the right namespace can be challenging across a large codebase. This tool solves that by:

1. Scanning all TypeScript/JavaScript files for `registerDebug` calls
2. Organizing them into a hierarchical structure based on namespace
3. Generating a markdown document with file locations and usage examples

## Usage

### Building and Running

```bash
# Build the project
npm run build

# Run the generator (scans three folders up from tool location by default)
npm start

# Show help information
npm run start:help

# Run with a custom path
npm start /path/to/scan

# Or run directly with node
node dist/main.js
node dist/main.js --help
node dist/main.js /path/to/project
node dist/main.js ../../../packages
```

### Command Line Arguments

- **PATH**: Optional path to scan for `registerDebug` calls. If not provided, defaults to three folders up from the compiled tool location (`../../..` relative to `dist/main.js`).
- **--help, -h**: Show help information and usage examples.

### Output

The tool generates a `debug-hierarchy.md` file in the current working directory. This file contains:

- A hierarchical list of all debug namespaces
- Clickable links to file locations and line numbers for each `registerDebug` call
- Usage examples for enabling debug output
- Statistics about the scan results

### Example Output Structure

```markdown
# Debug Namespace Hierarchy

## Namespace Hierarchy

- **typeagent**
  - **azure**
    - **deploy**
      - `debug` in `tools/scripts/azureDeploy.mjs:11`
      - **error**
        - `debugError` in `tools/scripts/azureDeploy.mjs:12`
  - **shell**
    - **speech**
      - `debug` in `packages/shell/src/renderer/src/speech.ts:10`
      - **error**
        - `debugError` in `packages/shell/src/renderer/src/speech.ts:11`
```

## How It Works

1. **File Discovery**: Recursively scans directories for `.ts` and `.mts` files
2. **Pattern Matching**: Uses regex to find `registerDebug` calls in the format:
   - `const variableName = registerDebug("namespace")`
   - `registerDebug("namespace")`
3. **Hierarchy Building**: Splits namespaces by `:` to create a tree structure
4. **Markdown Generation**: Creates a formatted document with file references

## Debug Usage Examples

Once you have the generated documentation, you can use it to enable specific debug output:

```bash
# Enable all typeagent debug messages
DEBUG=typeagent:* npm start

# Enable only shell-related debug messages  
DEBUG=typeagent:shell:* npm start

# Enable specific component debugging
DEBUG=typeagent:shell:speech npm start

# Enable multiple namespaces
DEBUG=typeagent:shell:*,typeagent:browser:* npm start

# Enable with error level
DEBUG=typeagent:shell:speech:error npm start
```

## Features

- **Comprehensive Scanning**: Finds all `registerDebug` calls across the entire codebase
- **Hierarchical Organization**: Groups related debug namespaces together
- **File References**: Shows exactly where each debug logger is defined
- **Usage Examples**: Provides copy-paste ready DEBUG environment variable examples
- **Flexible Input**: Can scan any directory, not just the TypeAgent root

## Dependencies

- Node.js and npm
- TypeScript compilation support
- Access to the filesystem for scanning files

This tool is particularly useful for developers working on TypeAgent who need to debug specific components and want to discover the available debug namespaces quickly.
