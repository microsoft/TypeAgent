```json
{
  "readme": "# Visual Studio TypeAgent

## Overview
The Visual Studio TypeAgent provides integration for editor, solution, build, and debug actions via the EnvDTE automation API. This agent allows you to manage breakpoints, control debugging, handle files, build and run solutions, search and navigate code, execute commands, and perform edit actions within Visual Studio.

## Architecture Diagram
```
+---------------------+
| Visual Studio       |
| +-----------------+ |
| | Office Add-in   | |
| | (port 3003)     | |
| +-----------------+ |
+---------|-----------+
          |
          | WebSocket
          | (port 5680)
          |
+---------|-----------+
| Node.js Bridge      |
| Server              |
+---------------------+
```

## Action Categories
| Category              | Actions                                      |
|-----------------------|----------------------------------------------|
| **breakpointsManagement** | addBreakpoint, removeBreakpoint              |
| **debuggingControl**      | break, go, stepInto, stepOut, stepOver, stop, debug |
| **fileOperations**        | openFile, closeAll, saveAll                    |
| **buildAndRun**           | build, clean, run                              |
| **searchAndNavigation**   | findInFiles, findText, gotoLine                |
| **commandExecution**      | executeCommand                                 |
| **editActions**           | redo, undo                                     |

## Prerequisites
- Visual Studio installed
- Node.js installed
- pnpm package manager installed
- Office Add-in development tools installed

## Quick Start
1. **Build the agent package:**
   ```sh
   pnpm run build packages/agents/visualStudio
   ```

2. **Install Office Add-in development certificates:**
   ```sh
   npx office-addin-dev-certs install
   ```

3. **Add the Visual Studio add-in:**
   ```sh
   pnpm run visualStudio:addin
   ```

## Manual Setup
1. **Clone the repository:**
   ```sh
   git clone <repository-url>
   cd <repository-directory>
   ```

2. **Install dependencies:**
   ```sh
   pnpm install
   ```

3. **Build the agent package:**
   ```sh
   pnpm run build packages/agents/visualStudio
   ```

4. **Install Office Add-in development certificates:**
   ```sh
   npx office-addin-dev-certs install
   ```

5. **Add the Visual Studio add-in:**
   ```sh
   pnpm run visualStudio:addin
   ```

## Project Structure
```
packages/
├── agents/
│   └── visualStudio/
│       ├── src/
│       │   ├── actions/
│       │   │   ├── breakpointsManagement/
│       │   │   ├── debuggingControl/
│       │   │   ├── fileOperations/
│       │   │   ├── buildAndRun/
│       │   │   ├── searchAndNavigation/
│       │   │   ├── commandExecution/
│       │   │   └── editActions/
│       │   ├── index.ts
│       │   └── types.ts
│       ├── package.json
│       └── README.md
└── bridge/
    ├── src/
    │   ├── server.ts
    │   └── client.ts
    ├── package.json
    └── README.md
```

## API Limitations
- **breakpointsManagement**: Limited to adding and removing breakpoints.
- **debuggingControl**: Limited to basic debugging controls such as break, go, stepInto, stepOut, stepOver, stop, and debug.
- **fileOperations**: Limited to opening, closing, and saving files.
- **buildAndRun**: Limited to building, cleaning, and running the solution.
- **searchAndNavigation**: Limited to finding text in files, finding text, and navigating to a specific line.
- **commandExecution**: Limited to executing commands within the Visual Studio environment.
- **editActions**: Limited to redo and undo actions.

## Troubleshooting
- **Issue:** Add-in not loading in Visual Studio.
  - **Solution:** Ensure the Office Add-in development certificates are installed correctly using `npx office-addin-dev-certs install`.

- **Issue:** WebSocket connection issues.
  - **Solution:** Verify that the Node.js bridge server is running on port 5680 and the Office Add-in dev server is running on port 3003.

- **Issue:** Actions not executing as expected.
  - **Solution:** Check the Visual Studio output window for any errors and ensure the EnvDTE automation API is accessible.

For further assistance, please refer to the project's documentation or open an issue on the repository.
```
}
```