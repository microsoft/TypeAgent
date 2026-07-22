# @typeagent/browser-extension

The TypeAgent browser extension (Chrome/Edge + Electron). This package holds the
extension source, build scripts, and packaging. The core browser **agent** lives
in `browser-typeagent` (`../browser`); the shared browser types and content-script
RPC client live in `@typeagent/browser-control-rpc` (`../browserControlRpc`).

## Build

To build the extension, run `pnpm run build` in this folder. For debug support,
run `pnpm run dev`. Output goes to `dist/extension/` (Chrome/Edge) and
`dist/electron/` (Electron).

## Install (Chrome/Edge)

1. Enable developer mode in your browser. For Chrome and Edge, the steps are:

   - Launch browser
   - Click on the extensions icon next to the address bar. Select "Manage extensions" at the bottom of the menu.
   - This launches the extensions page. Enable the developer mode toggle on this page.

2. Build the extension (see above).
3. Load the unpacked extension:
   - Go to the "Manage extensions" page from step #1
   - Click on "Load unpacked". Navigate to this package's `dist/extension` folder.

## Running the extension

1. Launch the browser where you installed the extension.
2. Launch the TypeAgent shell or the TypeAgent CLI. These are integrated with the
   extension and can send commands. You can issue commands such as:
   - open new tab
   - go to new york times
   - follow news link
   - scroll down
   - go back
   - etc.

## Chat panel

The extension's chat panel supports the same `@conversation` slash
commands and natural-language conversation management as the Shell and
CLI (`new`, `list`, `info`, `switch`, `prev`, `next`, `rename`,
`delete`). Switching, creating, or moving between conversations clears
the panel and replays the new conversation's history, so peer activity
from a Shell or CLI joined to the same conversation is also visible.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
