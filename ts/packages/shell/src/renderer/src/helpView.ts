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
<!--
                            Frequent commands:<br/><br/>
                            <b>@clear</b> - clears all messages from the shell<br/>
                            <b>@random</b> - Issues a random request that may or may not be serviceable depending on which domain agents are enabled.<br/>
-->                            
                        </div>`;
    }

    getContainer() {
        return this.mainContainer;
    }
}
