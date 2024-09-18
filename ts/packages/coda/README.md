# CODA VSCODE extension

## Build

To build the vs code extension, run `pnpm run build` in this folder.

## Deploy

To deploy the extension locally in your vscode environment, run `pnpm run deploy:local` in this folder. You should see the extension in the list of installed extensions in vscode using the command `code --list-extensions`. To uninstall the extension, run `code --uninstall-extension aisystems.copilot-coda`.

## Features

1. Launch the vscode after you installed the extension.
2. Launch the typeagent shell or the typeagent cli. These are integrated with the extension and can send commands. You can issue commands from this interface such as:
   - Create a text file
   - Create a readme file with sample table with two rows
   - Split window into two columns
   - Revert back to a single column
   - Change color scheme to Monokai
   - Change theme back to light
   - Actually I want the color to be solarized light
   - Create a new python code file that merges two sorted arrays of numbers
   - etc

> Tip: If you have any problems, please check to see if the `coda` extension was installed correctly using the command `code --list-extensions`. You should see `aisystems.copilot-coda` in the list of vscode extensions.

## Requirements

This extension is integrated to work with the code app agent in the dispatcher. You can manually turn the code app agent on using the typeagent cli or shell.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
