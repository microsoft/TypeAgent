// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type VisualStudioActions =
  | AddBreakpointAction
  | RemoveBreakpointAction
  | FindInFilesAction
  | ExecuteCommandAction
  | OpenFileAction
  | BreakAction
  | GoAction
  | StepIntoAction
  | StepOutAction
  | StepOverAction
  | StopAction
  | BuildAction
  | CleanAction
  | DebugAction
  | RunAction
  | CloseAllAction
  | SaveAllAction
  | RedoAction
  | UndoAction
  | FindTextAction
  | GotoLineAction;

// Adds a new breakpoint to the debugger.
// IMPORTANT: Ensure the file path and line number are correct.
// User: "Can you add a breakpoint at line 42 in main.cpp?"
// Agent: "Adding a breakpoint at line 42 in main.cpp."
export type AddBreakpointAction = {
  actionName: "addBreakpoint";
  parameters: {
    // The file where the breakpoint will be added.
    file: string;
    // The line number where the breakpoint will be added (as a string; handler parses to int).
    line: string;
    // Optional condition for the breakpoint.
    condition?: string;
  };
};

// Removes an existing breakpoint from the debugger.
// User: "Please remove the breakpoint with ID 12345."
// Agent: "Removing the breakpoint with ID 12345."
export type RemoveBreakpointAction = {
  actionName: "removeBreakpoint";
  parameters: {
    // One of {breakpointId} or {file+line} must be provided.
    // The ID of the breakpoint to be removed.
    breakpointId?: string;
    // The file where the breakpoint is located.
    file?: string;
    // The line number where the breakpoint is located (as a string; handler parses to int).
    line?: string;
  };
};

// Performs a search operation across files in the solution.
// User: "Can you search for 'searchTerm' in all the files with 'fileTypes' extensions?"
// Agent: "Searching for 'searchTerm' in files with 'fileTypes' extensions."
export type FindInFilesAction = {
  actionName: "findInFiles";
  parameters: {
    // The term to search for in the files.
    searchTerm: string;
    // Optional file types to limit the search.
    fileTypes?: string;
  };
};

// Executes a command in the Visual Studio environment.
// User: "Can you run the command in Visual Studio for me?"
// Agent: "Executing the command in Visual Studio."
export type ExecuteCommandAction = {
  actionName: "executeCommand";
  parameters: {
    // The name of the command to execute.
    commandName: string;
    // Optional arguments for the command.
    commandArgs?: string;
  };
};

// Opens a file in the Visual Studio environment.
// User: "Can you open the file located at [filePath] in Visual Studio?"
// Agent: "Opening the file at [filePath] in Visual Studio."
export type OpenFileAction = {
  actionName: "openFile";
  parameters: {
    // The path of the file to open.
    filePath: string;
    // Default behavior is "text".
    // Valid values: "text" | "code" | "designer" | "debug".
    // The view kind to use when opening the file.
    viewKind?: "text" | "code" | "designer" | "debug";
  };
};

// Causes the given process to pause its execution so that its current state can be analyzed.
// User: "Pause the process right now."
// Agent: "Pausing the process immediately."
export type BreakAction = {
  actionName: "break";
  parameters: {};
};

// Starts executing the program from the current statement.
// User: "Run the program from here."
// Agent: "Starting execution from the current statement."
export type GoAction = {
  actionName: "go";
  parameters: {};
};

// Steps into the next function call, if possible.
// User: "Can you step into the next function call, please?"
// Agent: "Stepping into the next function call."
export type StepIntoAction = {
  actionName: "stepInto";
  parameters: {};
};

// Steps out of the current function.
// User: "Can you step out of the current function, please?"
// Agent: "Stepping out of the current function."
export type StepOutAction = {
  actionName: "stepOut";
  parameters: {};
};

// Steps over the next function call.
// User: "Can you step over the next function call, please?"
// Agent: "Stepping over the next function call."
export type StepOverAction = {
  actionName: "stepOver";
  parameters: {};
};

// Stops debugging, terminating, or detaching from all attached processes.
// User: "Please stop the debugging process."
// Agent: "Stopping the debugging process."
export type StopAction = {
  actionName: "stop";
  parameters: {};
};

// Causes the active solution configuration to begin building.
// User: "Can you start building the solution, please?"
// Agent: "Starting to build the solution."
export type BuildAction = {
  actionName: "build";
  parameters: {
    // Whether to wait for the build to complete.
    waitForCompletion?: boolean;
  };
};

// Deletes all compiler-generated support files for marked projects.
// User: "Can you clean the solution, please?"
// Agent: "Cleaning the solution."
export type CleanAction = {
  actionName: "clean";
  parameters: {
    // Whether to wait for the clean operation to complete.
    waitForCompletion?: boolean;
  };
};

// Starts debugging the solution.
// User: "Can you start debugging the solution?"
// Agent: "Starting to debug the solution."
export type DebugAction = {
  actionName: "debug";
  parameters: {};
};

// Causes the active solution configuration to execute.
// User: "Can you run the current solution for me?"
// Agent: "Running the current solution."
export type RunAction = {
  actionName: "run";
  parameters: {};
};

// Closes all open documents in the environment and optionally saves them.
// User: "Close all open files, please."
// Agent: "Closing all open files."
export type CloseAllAction = {
  actionName: "closeAll";
  parameters: {
    // Whether to save changes before closing.
    saveChanges?: boolean;
  };
};

// Saves all documents currently open in the environment.
// User: "Can you save all my open files, please?"
// Agent: "Saving all open files."
export type SaveAllAction = {
  actionName: "saveAll";
  parameters: {};
};

// Re-executes the last action that was undone by the Undo() method or the user.
// User: "Can you redo the last change I undid?"
// Agent: "Redoing the last undone change."
export type RedoAction = {
  actionName: "redo";
  parameters: {};
};

// Reverses the action last performed by the user in the document.
// User: "Can you undo my last change?"
// Agent: "Undoing the last change."
export type UndoAction = {
  actionName: "undo";
  parameters: {};
};

// Searches for the given text from the active point to the end of the document.
// User: "Can you search for the text 'example' from here to the end of the document?"
// Agent: "Searching for 'example' from the current position to the end of the document."
export type FindTextAction = {
  actionName: "findText";
  parameters: {
    // The text to search for in the document.
    text: string;
    // Optional flags for the search operation.
    caseSensitive?: boolean;
    wholeWord?: boolean;
    useRegex?: boolean;
  };
};

// Moves to the beginning of the indicated line and selects the line if requested.
// User: "Can you go to line 42 and select it?"
// Agent: "Going to line 42 and selecting it."
export type GotoLineAction = {
  actionName: "gotoLine";
  parameters: {
    // The line number to go to (as a string; handler parses to int).
    line: string;
    // Whether to select the line after moving to it.
    select?: boolean;
  };
};