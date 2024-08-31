# Browser automation extension

## Build

To build the browser extension, run `pnpm run build` in this folder. For debug support, you can run `pnpm run dev`

## Install

1. Enable developer mode in your browser. For chrome and edge, the steps are:

   - Launch browser
   - Click on the extensions icon next to the address bar. Select "Manage extensions" at the bottom of the menu.
   - This launches the extensions page. Enable the developer mode toggle on this page.

2. Build the extension
3. Load the unpackaged extension
   - Go to the "manage extensions page" from step #1
   - Click on "load unpackaged extension". Navigate to the `dist/extension` folder of the browser extension package.

## Running the extension

1. Launch the browser where you installed the extension
2. Launch the typeagent shell or the typeagent cli. These are integrated with the extension and can send commands. You can issue commands from this interface such as:
   - open new tab
   - go to new york times
   - follow news link
   - scroll down
   - go back
   - etc.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
