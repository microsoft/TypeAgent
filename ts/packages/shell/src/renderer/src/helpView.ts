// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export class HelpView {
    private mainContainer: HTMLDivElement;

    constructor() {
        this.mainContainer = document.createElement("div");

        this.mainContainer.innerHTML = `                        <div style="text-align: left; margin: 20px; font-size: 14px;">
                            <a href="https://aka.ms/TypeAgent" target="_new">TypeAgent Online</a><br/><br/>
                            <a href="https://github.com/microsoft/TypeAgent/blob/main/ts/packages/shell/README.md" target="_new">agent shell README</a><br/><br/>
                            <div>Try entering <b>@help</b> (or press F1) for a list of commands. Some commands operate on their own while
                            others require sub-commands, for example: <b>@config</b>.  To see the list of sub-commands you can run 
                            <b>@help <i>&lt;command&gt;</i></b>.</div><br/><br/>

                            Keyboard Shortcuts:<br/><br/>
                            <b>F1</b> - show help message (<b>@help</b>).<br/>
                            <b>F2</b> - issue random request (<b>@random</b>).<br/>
                            <b>F11</b> - Toggle full screen</br>
                            <b>F12</b> - Toggle devTools</br>
                            <b>Alt</b> - Show menu</br>
                            <b>Alt+M</b> - Start speech recognition.<br/>
                            <b>Ctrl+M</b> - Toggle continuous speech recognition on off.<br/>
                            <b>CmdOrCTRL+-</b> - Zoom in or out (alternatively use CmdOrCTRL and mouse wheel).</br>                            
                            
                        </div>`;
    }

    getContainer() {
        return this.mainContainer;
    }
}
