// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CodeEditorActions =
    | EditorActionSelectAll
    | EditorActionDiffReviewNext
    | EditorActionAccessibleDiffViewerNext
    | EditorActionDiffReviewPrev
    | EditorActionAccessibleDiffViewerPrev
    | EditorActionSetSelectionAnchor
    | EditorActionGoToSelectionAnchor
    | EditorActionSelectFromAnchorToCursor
    | EditorActionCancelSelectionAnchor
    | EditorActionSelectToBracket
    | EditorActionJumpToBracket
    | EditorActionRemoveBrackets
    | EditorActionMoveCarretLeftAction
    | EditorActionMoveCarretRightAction
    | EditorActionTransposeLetters
    | EditorActionClipboardCutAction
    | EditorActionClipboardCopyAction
    | EditorActionClipboardPasteAction
    | EditorActionClipboardCopyWithSyntaxHighlightingAction
    | EditorActionQuickFix
    | EditorActionRefactor
    | EditorActionSourceAction
    | EditorActionOrganizeImports
    | EditorActionAutoFix
    | EditorActionFixAll
    | EditorActionCodeAction
    | EditorActionGoToDeclaration
    | EditorActionRevealDefinition
    | EditorActionOpenDeclarationToTheSide
    | EditorActionRevealDefinitionAside
    | EditorActionPreviewDeclaration
    | EditorActionPeekDefinition
    | EditorActionRevealDeclaration
    | EditorActionPeekDeclaration
    | EditorActionGoToTypeDefinition
    | EditorActionPeekTypeDefinition
    | EditorActionGoToImplementation
    | EditorActionPeekImplementation
    | EditorActionGoToReferences
    | EditorActionReferenceSearchTrigger
    | EditorActionGoToLocations
    | EditorActionPeekLocations
    | EditorActionFindReferences
    | EditorActionShowReferences
    | EditorActionHideColorPicker
    | EditorActionInsertColorWithStandaloneColorPicker
    | EditorActionShowOrFocusStandaloneColorPicker
    | EditorActionCommentLine
    | EditorActionAddCommentLine
    | EditorActionRemoveCommentLine
    | EditorActionBlockComment
    | EditorActionShowContextMenu
    | EditorActionPasteAs
    | EditorActionPasteAsText
    | EditorActionStartFindReplaceAction
    | EditorActionsFindWithArgs
    | EditorActionNextMatchFindAction
    | EditorActionPreviousMatchFindAction
    | EditorActionGoToMatchFindAction
    | EditorActionNextSelectionMatchFindAction
    | EditorActionPreviousSelectionMatchFindAction
    | EditorActionReplaceOne
    | EditorActionReplaceAll
    | EditorActionSelectAllMatches
    | EditorActionFontZoomIn
    | EditorActionFontZoomOut
    | EditorActionFontZoomReset
    | EditorActionFormatDocument
    | EditorActionFormatSelection
    | EditorActionFormat
    | EditorActionTriggerSuggest
    | EditorActionResetSuggestSize
    | EditorActionInlineSuggestTrigger
    | EditorActionInlineSuggestShowNext
    | EditorActionInlineSuggestShowPrevious
    | EditorActionInlineSuggestAcceptNextWord
    | EditorActionInlineSuggestAcceptNextLine
    | EditorActionInlineSuggestCommit
    | EditorActionInlineSuggestHide
    | EditorActionInlineSuggestJump
    | EditorActionInlineSuggestToggleAlwaysShowToolbar
    | EditorActionInlineSuggestDevExtractRepro
    | EditorActionMarkerNext
    | EditorActionMarkerPrev
    | EditorActionMarkerNextInFiles
    | EditorActionMarkerPrevInFiles
    | EditorActionDebugEditorGpuRenderer
    | EditorActionShowHover
    | EditorActionShowDefinitionPreviewHover
    | EditorActionScrollUpHover
    | EditorActionScrollDownHover
    | EditorActionScrollLeftHover
    | EditorActionScrollRightHover
    | EditorActionPageUpHover
    | EditorActionPageDownHover
    | EditorActionGoToTopHover
    | EditorActionGoToBottomHover
    | EditorActionIncreaseHoverVerbosityLevel
    | EditorActionDecreaseHoverVerbosityLevel
    | EditorActionIndentationToSpaces
    | EditorActionIndentationToTabs
    | EditorActionIndentUsingTabs
    | EditorActionIndentUsingSpaces
    | EditorActionChangeTabDisplaySize
    | EditorActionDetectIndentation
    | EditorActionReindentlines
    | EditorActionReindentSelectedLines
    | EditorActionInPlaceReplaceUp
    | EditorActionInPlaceReplaceDown
    | EditorActionCopyLinesUpAction
    | EditorActionCopyLinesDownAction
    | EditorActionDuplicateSelection
    | EditorActionMoveLinesUpAction
    | EditorActionMoveLinesDownAction
    | EditorActionSortLinesAscending
    | EditorActionSortLinesDescending
    | EditorActionRemoveDuplicateLines
    | EditorActionTrimTrailingWhitespace
    | EditorActionDeleteLines
    | EditorActionIndentLines
    | EditorActionOutdentLines
    | EditorActionInsertLineBefore
    | EditorActionInsertLineAfter
    | EditorActionJoinLines
    | EditorActionTranspose
    | EditorActionTransformToUppercase
    | EditorActionTransformToLowercase
    | EditorActionTransformToSnakecase
    | EditorActionTransformToCamelcase
    | EditorActionTransformToPascalcase
    | EditorActionTransformToTitlecase
    | EditorActionTransformToKebabcase
    | EditorActionLinkedEditing
    | EditorActionOpenLink
    | EditorActionInsertCursorAbove
    | EditorActionInsertCursorBelow
    | EditorActionInsertCursorAtEndOfEachLineSelected
    | EditorActionAddSelectionToNextFindMatch
    | EditorActionAddSelectionToPreviousFindMatch
    | EditorActionMoveSelectionToNextFindMatch
    | EditorActionMoveSelectionToPreviousFindMatch
    | EditorActionSelectHighlights
    | EditorActionChangeAll
    | EditorActionAddCursorsToBottom
    | EditorActionAddCursorsToTop
    | EditorActionFocusNextCursor
    | EditorActionFocusPreviousCursor
    | EditorActionInlineEditAccept
    | EditorActionInlineEditReject
    | EditorActionInlineEditJumpTo
    | EditorActionInlineEditJumpBack
    | EditorActionInlineEditTrigger
    | EditorActionTriggerParameterHints
    | EditorActionRename
    | EditorActionSmartSelectGrow
    | EditorActionSmartSelectExpand
    | EditorActionSmartSelectShrink
    | EditorActionToggleStickyScroll
    | EditorActionFocusStickyScroll
    | EditorActionSelectPreviousStickyScrollLine
    | EditorActionSelectNextStickyScrollLine
    | EditorActionGoToFocusedStickyScrollLine
    | EditorActionSelectEditor
    | EditorActionForceRetokenize
    | EditorActionToggleTabFocusMode
    | EditorActionUnicodeHighlightDisableHighlightingOfAmbiguousCharacters
    | EditorActionUnicodeHighlightDisableHighlightingOfInvisibleCharacters
    | EditorActionUnicodeHighlightDisableHighlightingOfNonBasicAsciiCharacters
    | EditorActionUnicodeHighlightShowExcludeOptions
    | EditorActionWordHighlightNext
    | EditorActionWordHighlightPrev
    | EditorActionWordHighlightTrigger
    | EditorActionInspectTMScopes
    | EditorActionAccessibleViewNext
    | EditorActionAccessibleViewNextCodeBlock
    | EditorActionAccessibleViewPreviousCodeBlock
    | EditorActionAccessibleViewPrevious
    | EditorActionAccessibleViewGoToSymbol
    | EditorActionAccessibilityHelp
    | EditorActionAccessibleView
    | EditorActionAccessibleViewDisableHint
    | EditorActionAccessibilityHelpConfigureKeybindings
    | EditorActionAccessibilityHelpConfigureAssignedKeybindings
    | EditorActionAccessibilityHelpOpenHelpLink
    | EditorActionAccessibleViewAcceptInlineCompletion
    | EditorActionToggleWordWrap
    | EditorActionFormatDocumentMultiple
    | EditorActionFormatSelectionMultiple
    | EditorActionDirtydiffPrevious
    | EditorActionDirtyDiffNext
    | EditorActionNextCommentThreadAction
    | EditorActionPreviousCommentThreadAction
    | EditorActionNextCommentedRangeAction
    | EditorActionPreviousCommentedRangeAction
    | EditorActionNextCommentingRange
    | EditorActionPreviousCommentingRange
    | EditorActionSubmitComment
    | EditorActionWebvieweditorShowFind
    | EditorActionWebvieweditorHideFind
    | EditorActionWebvieweditorFindNext
    | EditorActionWebvieweditorFindPrevious
    | EditorActionExtensionEditorShowFind
    | EditorActionExtensionEditorFindNext
    | EditorActionExtensionEditorFindPrevious
    | EditorActionToggleScreenReaderAccessibilityMode
    | EditorActionFormatChanges
    | EditorActionToggleColumnSelection
    | EditorActionToggleMinimap
    | EditorActionToggleRenderControlCharacter
    | EditorActionToggleRenderWhitespace
    | EditorActionInsertSnippet
    | EditorActionShowSnippets
    | EditorActionSurroundWithSnippet
    | EditorActionFormatDocumentNone
    | EditorActionMeasureExtHostLatency
    | EditorActionStartDebugTextMate
    | EditorActionDefineKeybinding;

// Select all content in the editor
export type EditorActionSelectAll = {
    actionName: "editor.action.selectAll";
};

// Navigate to the next difference in the diff review
export type EditorActionDiffReviewNext = {
    actionName: "editor.action.diffReview.next";
};

// Go to Next Difference in accessibility mode when in a diff editor
export type EditorActionAccessibleDiffViewerNext = {
    actionName: "editor.action.accessibleDiffViewer.next";
};

// Navigate to the previous difference in the diff review
export type EditorActionDiffReviewPrev = {
    actionName: "editor.action.diffReview.prev";
};

// Go to Previous Difference in accessibility mode when in a diff editor
export type EditorActionAccessibleDiffViewerPrev = {
    actionName: "editor.action.accessibleDiffViewer.prev";
};

// Set selection anchor when the editor text is focused
export type EditorActionSetSelectionAnchor = {
    actionName: "editor.action.setSelectionAnchor";
};

// Go to selection anchor
export type EditorActionGoToSelectionAnchor = {
    actionName: "editor.action.goToSelectionAnchor";
};

// Select text from anchor to cursor when the editor text is focused and the selection anchor is set
export type EditorActionSelectFromAnchorToCursor = {
    actionName: "editor.action.selectFromAnchorToCursor";
};

// Cancel selection anchor when the editor text is focused and a selection anchor is set
export type EditorActionCancelSelectionAnchor = {
    actionName: "editor.action.cancelSelectionAnchor";
};

// Select the text inside and including the brackets or curly braces
export type EditorActionSelectToBracket = {
    actionName: "editor.action.selectToBracket";
    parameters: {
        selectBrackets?: boolean;
    };
};

// Jump to bracket when the editor text is focused
export type EditorActionJumpToBracket = {
    actionName: "editor.action.jumpToBracket";
};

// Remove brackets when the editor text is focused
export type EditorActionRemoveBrackets = {
    actionName: "editor.action.removeBrackets";
};

// Move caret left action
export type EditorActionMoveCarretLeftAction = {
    actionName: "editor.action.moveCarretLeftAction";
};

// Move caret right action
export type EditorActionMoveCarretRightAction = {
    actionName: "editor.action.moveCarretRightAction";
};

// Transpose letters in the editor
export type EditorActionTransposeLetters = {
    actionName: "editor.action.transposeLetters";
};

// Cut action for the clipboard
export type EditorActionClipboardCutAction = {
    actionName: "editor.action.clipboardCutAction";
};

// Clipboard copy action
export type EditorActionClipboardCopyAction = {
    actionName: "editor.action.clipboardCopyAction";
};

// Clipboard paste action
export type EditorActionClipboardPasteAction = {
    actionName: "editor.action.clipboardPasteAction";
};

// Copies content to clipboard with syntax highlighting
export type EditorActionClipboardCopyWithSyntaxHighlightingAction = {
    actionName: "editor.action.clipboardCopyWithSyntaxHighlightingAction";
};

// Quick fix action when the editor has a code actions provider, text input is focused, and the editor is not readonly
export type EditorActionQuickFix = {
    actionName: "editor.action.quickFix";
};

// Refactor when the editor has a code actions provider, text input is focused, and the editor is not readonly
export type EditorActionRefactor = {
    actionName: "editor.action.refactor";
    parameters: {
        kind?: string;
        apply?: "first" | "ifSingle" | "never";
        preferred?: boolean;
    };
};

// Source Action...
export type EditorActionSourceAction = {
    actionName: "editor.action.sourceAction";
    parameters: {
        kind?: string;
        apply?: "first" | "ifSingle" | "never";
        preferred?: boolean;
    };
};

// Organize imports when text input is focused, editor is not readonly, and source.organizeImports is supported
export type EditorActionOrganizeImports = {
    actionName: "editor.action.organizeImports";
};

// Auto fix action when text input is focused, editor is not readonly, and quick fix is supported
export type EditorActionAutoFix = {
    actionName: "editor.action.autoFix";
};

// Fix all issues in the editor
export type EditorActionFixAll = {
    actionName: "editor.action.fixAll";
};

// Trigger a code action
export type EditorActionCodeAction = {
    actionName: "editor.action.codeAction";
    parameters: {
        kind?: string;
        apply?: "first" | "ifSingle" | "never";
        preferred?: boolean;
    };
};

// Go to Declaration action
export type EditorActionGoToDeclaration = {
    actionName: "editor.action.goToDeclaration";
};

// Go to Definition when the editor has a definition provider and the text is focused
export type EditorActionRevealDefinition = {
    actionName: "editor.action.revealDefinition";
};

// Open declaration to the side
export type EditorActionOpenDeclarationToTheSide = {
    actionName: "editor.action.openDeclarationToTheSide";
};

// Open Definition to the Side when the editor has a definition provider, the editor text is focused, and not in an embedded editor
export type EditorActionRevealDefinitionAside = {
    actionName: "editor.action.revealDefinitionAside";
};

// Preview the declaration of a symbol
export type EditorActionPreviewDeclaration = {
    actionName: "editor.action.previewDeclaration";
};

// Peek Definition when the editor has a definition provider, the text is focused, and not in reference search or embedded editor
export type EditorActionPeekDefinition = {
    actionName: "editor.action.peekDefinition";
};

// Go to Declaration
export type EditorActionRevealDeclaration = {
    actionName: "editor.action.revealDeclaration";
};

// Peek Declaration
export type EditorActionPeekDeclaration = {
    actionName: "editor.action.peekDeclaration";
};

// Go to Type Definition
export type EditorActionGoToTypeDefinition = {
    actionName: "editor.action.goToTypeDefinition";
};

// Peek Type Definition
export type EditorActionPeekTypeDefinition = {
    actionName: "editor.action.peekTypeDefinition";
};

// Go to Implementations when the editor has an implementation provider and the text is focused
export type EditorActionGoToImplementation = {
    actionName: "editor.action.goToImplementation";
};

// Peek Implementations when the editor has an implementation provider, the editor text is focused, and not in reference search or embedded editor
export type EditorActionPeekImplementation = {
    actionName: "editor.action.peekImplementation";
};

// Go to References when the editor has a reference provider, the text is focused, and not in reference search or embedded editor
export type EditorActionGoToReferences = {
    actionName: "editor.action.goToReferences";
};

// Peek References
export type EditorActionReferenceSearchTrigger = {
    actionName: "editor.action.referenceSearch.trigger";
};

// Go to locations from a position in a file
export type EditorActionGoToLocations = {
    actionName: "editor.action.goToLocations";
    parameters: {
        uri: string;
        position: string;
        locations: string[];
        multiple: "peek" | "gotoAndPeek" | "goto";
        noResultsMessage: string;
    };
};

// Peek locations from a position in a file
export type EditorActionPeekLocations = {
    actionName: "editor.action.peekLocations";
    parameters: {
        uri: string;
        position: string;
        locations: string[];
        multiple: "peek" | "gotoAndPeek" | "goto";
    };
};

// Find references action in the editor
export type EditorActionFindReferences = {
    actionName: "editor.action.findReferences";
};

// Show references in the editor
export type EditorActionShowReferences = {
    actionName: "editor.action.showReferences";
};

// Hide the standalone color picker when the standalone color picker is visible
export type EditorActionHideColorPicker = {
    actionName: "editor.action.hideColorPicker";
};

// Insert hex/rgb/hsl colors with the focused standalone color picker when the standalone color picker is focused
export type EditorActionInsertColorWithStandaloneColorPicker = {
    actionName: "editor.action.insertColorWithStandaloneColorPicker";
};

// Show or focus a standalone color picker which uses the default color provider. It displays hex/rgb/hsl colors.
export type EditorActionShowOrFocusStandaloneColorPicker = {
    actionName: "editor.action.showOrFocusStandaloneColorPicker";
};

// Comment a line when the editor is focused and not readonly
export type EditorActionCommentLine = {
    actionName: "editor.action.commentLine";
};

// Add a comment line when the editor is focused and not readonly
export type EditorActionAddCommentLine = {
    actionName: "editor.action.addCommentLine";
};

// Remove comment line when the editor text is focused and not read-only
export type EditorActionRemoveCommentLine = {
    actionName: "editor.action.removeCommentLine";
};

// Block comment action when the editor text is focused and not read-only
export type EditorActionBlockComment = {
    actionName: "editor.action.blockComment";
};

// Show context menu when text input is focused
export type EditorActionShowContextMenu = {
    actionName: "editor.action.showContextMenu";
};

// Paste as
export type EditorActionPasteAs = {
    actionName: "editor.action.pasteAs";
    parameters: {
        kind?: string;
    };
};

// Paste as text action
export type EditorActionPasteAsText = {
    actionName: "editor.action.pasteAsText";
};

// Start Find and Replace action when the editor is focused or open
export type EditorActionStartFindReplaceAction = {
    actionName: "editor.action.startFindReplaceAction";
};

// Open a new In-Editor Find Widget
export type EditorActionsFindWithArgs = {
    actionName: "editor.actions.findWithArgs";
    parameters: {
        searchString?: string;
        replaceString?: string;
        isRegex?: boolean;
        matchWholeWord?: boolean;
        isCaseSensitive?: boolean;
        preserveCase?: boolean;
        findInSelection?: boolean;
    };
};

// Move to the next match when the editor is focused
export type EditorActionNextMatchFindAction = {
    actionName: "editor.action.nextMatchFindAction";
};

// Navigate to the previous match when the editor is focused
export type EditorActionPreviousMatchFindAction = {
    actionName: "editor.action.previousMatchFindAction";
};

// Go to match find action
export type EditorActionGoToMatchFindAction = {
    actionName: "editor.action.goToMatchFindAction";
};

// Move to the next selection match when the editor is focused
export type EditorActionNextSelectionMatchFindAction = {
    actionName: "editor.action.nextSelectionMatchFindAction";
};

// Perform the previous selection match find action when the editor is focused
export type EditorActionPreviousSelectionMatchFindAction = {
    actionName: "editor.action.previousSelectionMatchFindAction";
};

// Replace one occurrence when the editor is focused and the find widget is visible
export type EditorActionReplaceOne = {
    actionName: "editor.action.replaceOne";
};

// Replace all occurrences when the editor is focused and the find widget is visible
export type EditorActionReplaceAll = {
    actionName: "editor.action.replaceAll";
};

// Select all matches when the editor is focused and the find widget is visible
export type EditorActionSelectAllMatches = {
    actionName: "editor.action.selectAllMatches";
};

// Zoom in the font size in the editor
export type EditorActionFontZoomIn = {
    actionName: "editor.action.fontZoomIn";
};

// Zoom out the font in the editor
export type EditorActionFontZoomOut = {
    actionName: "editor.action.fontZoomOut";
};

// Reset the font zoom level
export type EditorActionFontZoomReset = {
    actionName: "editor.action.fontZoomReset";
};

// Format the document when the editor has a document formatting provider, the editor text is focused, and the editor is not readonly or in a composite editor
export type EditorActionFormatDocument = {
    actionName: "editor.action.formatDocument";
};

// Format the selected text when the editor has a document selection formatting provider, the editor is focused, and the editor is not readonly
export type EditorActionFormatSelection = {
    actionName: "editor.action.formatSelection";
};

// Format the editor content
export type EditorActionFormat = {
    actionName: "editor.action.format";
};

// Trigger suggestion when the editor has a completion item provider, text input is focused, the editor is not readonly, and the suggest widget is not visible
export type EditorActionTriggerSuggest = {
    actionName: "editor.action.triggerSuggest";
};

// Reset the size of the suggestion widget
export type EditorActionResetSuggestSize = {
    actionName: "editor.action.resetSuggestSize";
};

// Trigger inline suggestions when GitHub Copilot inline suggestions are enabled, the editor is focused, there is no selection, and inline suggestions are not visible
export type EditorActionInlineSuggestTrigger = {
    actionName: "editor.action.inlineSuggest.trigger";
};

// Show next inline suggestion when inline suggestion is visible and editor is not readonly
export type EditorActionInlineSuggestShowNext = {
    actionName: "editor.action.inlineSuggest.showNext";
};

// Show previous inline suggestion when inline suggestions are visible and the editor is not readonly
export type EditorActionInlineSuggestShowPrevious = {
    actionName: "editor.action.inlineSuggest.showPrevious";
};

// Accept the next word in inline suggestions when suggestions are visible and the editor is not readonly
export type EditorActionInlineSuggestAcceptNextWord = {
    actionName: "editor.action.inlineSuggest.acceptNextWord";
};

// Accept the next line in inline suggestions
export type EditorActionInlineSuggestAcceptNextLine = {
    actionName: "editor.action.inlineSuggest.acceptNextLine";
};

// Commit inline suggestion when certain conditions are met
export type EditorActionInlineSuggestCommit = {
    actionName: "editor.action.inlineSuggest.commit";
};

// Hide inline suggestions when inline edit or inline suggestion is visible
export type EditorActionInlineSuggestHide = {
    actionName: "editor.action.inlineSuggest.hide";
};

// Jump to inline suggestion when inline edit is visible and cursor is not at inline edit, no selection, hover not focused, tab does not move focus, and suggestion widget is not visible
export type EditorActionInlineSuggestJump = {
    actionName: "editor.action.inlineSuggest.jump";
};

// Always Show Toolbar
export type EditorActionInlineSuggestToggleAlwaysShowToolbar = {
    actionName: "editor.action.inlineSuggest.toggleAlwaysShowToolbar";
};

// Extract Repro for inline suggestions in development mode
export type EditorActionInlineSuggestDevExtractRepro = {
    actionName: "editor.action.inlineSuggest.dev.extractRepro";
};

// Move to the next marker when the editor is focused
export type EditorActionMarkerNext = {
    actionName: "editor.action.marker.next";
};

// Navigate to the previous marker when the editor is focused
export type EditorActionMarkerPrev = {
    actionName: "editor.action.marker.prev";
};

// Move to the next marker in files when the editor is focused
export type EditorActionMarkerNextInFiles = {
    actionName: "editor.action.marker.nextInFiles";
};

// Navigate to the previous marker in files when the editor is focused
export type EditorActionMarkerPrevInFiles = {
    actionName: "editor.action.marker.prevInFiles";
};

// Action related to debugging the GPU renderer in the editor
export type EditorActionDebugEditorGpuRenderer = {
    actionName: "editor.action.debugEditorGpuRenderer";
};

// Show or focus the editor hover which shows documentation, references, and other content for a symbol at the current cursor position when the editor text is focused
export type EditorActionShowHover = {
    actionName: "editor.action.showHover";
    parameters: {
        args?: {
            focus?: "noAutoFocus" | "focusIfVisible" | "autoFocusImmediately";
        };
    };
};

// Show the definition preview hover in the editor
export type EditorActionShowDefinitionPreviewHover = {
    actionName: "editor.action.showDefinitionPreviewHover";
};

// Scroll up the editor hover when the editor hover is focused
export type EditorActionScrollUpHover = {
    actionName: "editor.action.scrollUpHover";
};

// Scroll down the editor hover when the editor hover is focused
export type EditorActionScrollDownHover = {
    actionName: "editor.action.scrollDownHover";
};

// Scroll left the editor hover when the editor hover is focused
export type EditorActionScrollLeftHover = {
    actionName: "editor.action.scrollLeftHover";
};

// Scroll right the editor hover when the editor hover is focused
export type EditorActionScrollRightHover = {
    actionName: "editor.action.scrollRightHover";
};

// Page up the editor hover when the editor hover is focused
export type EditorActionPageUpHover = {
    actionName: "editor.action.pageUpHover";
};

// Page down the editor hover when the editor hover is focused
export type EditorActionPageDownHover = {
    actionName: "editor.action.pageDownHover";
};

// Go to the top of the editor hover when the editor hover is focused
export type EditorActionGoToTopHover = {
    actionName: "editor.action.goToTopHover";
};

// Go to the bottom of the editor hover when the editor hover is focused
export type EditorActionGoToBottomHover = {
    actionName: "editor.action.goToBottomHover";
};

// Increase hover verbosity level
export type EditorActionIncreaseHoverVerbosityLevel = {
    actionName: "editor.action.increaseHoverVerbosityLevel";
};

// Decrease hover verbosity level
export type EditorActionDecreaseHoverVerbosityLevel = {
    actionName: "editor.action.decreaseHoverVerbosityLevel";
};

// Convert the tab indentation to spaces.
export type EditorActionIndentationToSpaces = {
    actionName: "editor.action.indentationToSpaces";
};

// Convert the spaces indentation to tabs.
export type EditorActionIndentationToTabs = {
    actionName: "editor.action.indentationToTabs";
};

// Use indentation with tabs.
export type EditorActionIndentUsingTabs = {
    actionName: "editor.action.indentUsingTabs";
};

// Use indentation with spaces.
export type EditorActionIndentUsingSpaces = {
    actionName: "editor.action.indentUsingSpaces";
};

// Change the space size equivalent of the tab.
export type EditorActionChangeTabDisplaySize = {
    actionName: "editor.action.changeTabDisplaySize";
};

// Detect the indentation from content
export type EditorActionDetectIndentation = {
    actionName: "editor.action.detectIndentation";
};

// Reindent the lines of the editor.
export type EditorActionReindentlines = {
    actionName: "editor.action.reindentlines";
};

// Reindent the selected lines of the editor.
export type EditorActionReindentSelectedLines = {
    actionName: "editor.action.reindentselectedlines";
};

// In-place replace action when the editor is focused and not read-only
export type EditorActionInPlaceReplaceUp = {
    actionName: "editor.action.inPlaceReplace.up";
};

// In-place replace down when the editor is focused and not readonly
export type EditorActionInPlaceReplaceDown = {
    actionName: "editor.action.inPlaceReplace.down";
};

// Copy lines up when the editor is focused and not readonly
export type EditorActionCopyLinesUpAction = {
    actionName: "editor.action.copyLinesUpAction";
};

// Copy lines down when the editor text is focused and not read-only
export type EditorActionCopyLinesDownAction = {
    actionName: "editor.action.copyLinesDownAction";
};

// Duplicate selection action
export type EditorActionDuplicateSelection = {
    actionName: "editor.action.duplicateSelection";
};

// Move lines up when the editor text is focused and not read-only
export type EditorActionMoveLinesUpAction = {
    actionName: "editor.action.moveLinesUpAction";
};

// Move lines down when the editor text is focused and not read-only
export type EditorActionMoveLinesDownAction = {
    actionName: "editor.action.moveLinesDownAction";
};

// Sort lines in ascending order
export type EditorActionSortLinesAscending = {
    actionName: "editor.action.sortLinesAscending";
};

// Sort lines in descending order
export type EditorActionSortLinesDescending = {
    actionName: "editor.action.sortLinesDescending";
};

// Remove duplicate lines in the editor
export type EditorActionRemoveDuplicateLines = {
    actionName: "editor.action.removeDuplicateLines";
};

// Trim trailing whitespace when the editor is focused and not readonly
export type EditorActionTrimTrailingWhitespace = {
    actionName: "editor.action.trimTrailingWhitespace";
};

// Delete lines when text input is focused and editor is not readonly
export type EditorActionDeleteLines = {
    actionName: "editor.action.deleteLines";
};

// Indent lines when the editor is focused and not read-only
export type EditorActionIndentLines = {
    actionName: "editor.action.indentLines";
};

// Outdent lines when the editor text is focused and not read-only
export type EditorActionOutdentLines = {
    actionName: "editor.action.outdentLines";
};

// Insert a line before the current line when the editor is focused and not readonly
export type EditorActionInsertLineBefore = {
    actionName: "editor.action.insertLineBefore";
};

// Insert a line after the current line when the editor is focused and not readonly
export type EditorActionInsertLineAfter = {
    actionName: "editor.action.insertLineAfter";
};

// Joins lines in the editor
export type EditorActionJoinLines = {
    actionName: "editor.action.joinLines";
};

// Transpose action in the editor
export type EditorActionTranspose = {
    actionName: "editor.action.transpose";
};

// Transform text to uppercase
export type EditorActionTransformToUppercase = {
    actionName: "editor.action.transformToUppercase";
};

// Transform text to lowercase
export type EditorActionTransformToLowercase = {
    actionName: "editor.action.transformToLowercase";
};

// Transform text to snake_case
export type EditorActionTransformToSnakecase = {
    actionName: "editor.action.transformToSnakecase";
};

// Transform text to camel case
export type EditorActionTransformToCamelcase = {
    actionName: "editor.action.transformToCamelcase";
};

// Transform text to PascalCase
export type EditorActionTransformToPascalcase = {
    actionName: "editor.action.transformToPascalcase";
};

// Transform text to title case
export type EditorActionTransformToTitlecase = {
    actionName: "editor.action.transformToTitlecase";
};

// Transform text to kebab-case
export type EditorActionTransformToKebabcase = {
    actionName: "editor.action.transformToKebabcase";
};

// Linked editing when the editor has a rename provider, the editor is focused, and the editor is not readonly
export type EditorActionLinkedEditing = {
    actionName: "editor.action.linkedEditing";
};

// Open a link in the editor
export type EditorActionOpenLink = {
    actionName: "editor.action.openLink";
};

// Insert a cursor above when the editor text is focused
export type EditorActionInsertCursorAbove = {
    actionName: "editor.action.insertCursorAbove";
};

// Insert a cursor below when the editor text is focused
export type EditorActionInsertCursorBelow = {
    actionName: "editor.action.insertCursorBelow";
};

// Insert cursor at the end of each line selected when the editor text is focused
export type EditorActionInsertCursorAtEndOfEachLineSelected = {
    actionName: "editor.action.insertCursorAtEndOfEachLineSelected";
};

// Add selection to the next find match when the editor is focused
export type EditorActionAddSelectionToNextFindMatch = {
    actionName: "editor.action.addSelectionToNextFindMatch";
};

// Add selection to previous find match
export type EditorActionAddSelectionToPreviousFindMatch = {
    actionName: "editor.action.addSelectionToPreviousFindMatch";
};

// Move selection to the next find match when the editor is focused
export type EditorActionMoveSelectionToNextFindMatch = {
    actionName: "editor.action.moveSelectionToNextFindMatch";
};

// Move selection to the previous find match
export type EditorActionMoveSelectionToPreviousFindMatch = {
    actionName: "editor.action.moveSelectionToPreviousFindMatch";
};

// Select highlights when the editor is focused
export type EditorActionSelectHighlights = {
    actionName: "editor.action.selectHighlights";
};

// Change all occurrences when the editor is focused and not readonly
export type EditorActionChangeAll = {
    actionName: "editor.action.changeAll";
};

// Add cursors to the bottom
export type EditorActionAddCursorsToBottom = {
    actionName: "editor.action.addCursorsToBottom";
};

// Add cursors to the top
export type EditorActionAddCursorsToTop = {
    actionName: "editor.action.addCursorsToTop";
};

// Focuses the next cursor
export type EditorActionFocusNextCursor = {
    actionName: "editor.action.focusNextCursor";
};

// Focuses the previous cursor
export type EditorActionFocusPreviousCursor = {
    actionName: "editor.action.focusPreviousCursor";
};

// Accept inline edit when cursor is at inline edit, inline edit is visible, and editor is not readonly
export type EditorActionInlineEditAccept = {
    actionName: "editor.action.inlineEdit.accept";
};

// Reject inline edit when inline edit is visible and editor is not readonly
export type EditorActionInlineEditReject = {
    actionName: "editor.action.inlineEdit.reject";
};

// Jump to inline edit when inline edit is visible, cursor is not at inline edit, and editor is not readonly
export type EditorActionInlineEditJumpTo = {
    actionName: "editor.action.inlineEdit.jumpTo";
};

// Jump back in inline edit mode when the cursor is at inline edit and the editor is not readonly
export type EditorActionInlineEditJumpBack = {
    actionName: "editor.action.inlineEdit.jumpBack";
};

// Trigger inline edit when the editor is not readonly and inline edit is not visible
export type EditorActionInlineEditTrigger = {
    actionName: "editor.action.inlineEdit.trigger";
};

// Trigger parameter hints when the editor has a signature help provider and the text is focused
export type EditorActionTriggerParameterHints = {
    actionName: "editor.action.triggerParameterHints";
};

// Rename action when the editor has a rename provider, text is focused, and the editor is not readonly
export type EditorActionRename = {
    actionName: "editor.action.rename";
};

// Smart select grow action
export type EditorActionSmartSelectGrow = {
    actionName: "editor.action.smartSelect.grow";
};

// Expand smart selection when the editor text is focused
export type EditorActionSmartSelectExpand = {
    actionName: "editor.action.smartSelect.expand";
};

// Shrink smart selection when the editor text is focused
export type EditorActionSmartSelectShrink = {
    actionName: "editor.action.smartSelect.shrink";
};

// Toggle/enable the editor sticky scroll which shows the nested scopes at the top of the viewport
export type EditorActionToggleStickyScroll = {
    actionName: "editor.action.toggleStickyScroll";
};

// Focus on the editor sticky scroll
export type EditorActionFocusStickyScroll = {
    actionName: "editor.action.focusStickyScroll";
};

// Select the previous sticky scroll line when sticky scroll is focused
export type EditorActionSelectPreviousStickyScrollLine = {
    actionName: "editor.action.selectPreviousStickyScrollLine";
};

// Select the next editor sticky scroll line when sticky scroll is focused
export type EditorActionSelectNextStickyScrollLine = {
    actionName: "editor.action.selectNextStickyScrollLine";
};

// Go to the focused sticky scroll line when sticky scroll is focused
export type EditorActionGoToFocusedStickyScrollLine = {
    actionName: "editor.action.goToFocusedStickyScrollLine";
};

// Select Editor when sticky scroll is focused
export type EditorActionSelectEditor = {
    actionName: "editor.action.selectEditor";
};

// Force retokenize action
export type EditorActionForceRetokenize = {
    actionName: "editor.action.forceRetokenize";
};

// Determines whether the tab key moves focus around the workbench or inserts the tab character in the current editor. This is also called tab trapping, tab navigation, or tab focus mode.
export type EditorActionToggleTabFocusMode = {
    actionName: "editor.action.toggleTabFocusMode";
};

// Disable highlighting of ambiguous characters
export type EditorActionUnicodeHighlightDisableHighlightingOfAmbiguousCharacters =
    {
        actionName: "editor.action.unicodeHighlight.disableHighlightingOfAmbiguousCharacters";
    };

// Disable highlighting of invisible characters
export type EditorActionUnicodeHighlightDisableHighlightingOfInvisibleCharacters =
    {
        actionName: "editor.action.unicodeHighlight.disableHighlightingOfInvisibleCharacters";
    };

// Disable highlighting of non-basic ASCII characters
export type EditorActionUnicodeHighlightDisableHighlightingOfNonBasicAsciiCharacters =
    {
        actionName: "editor.action.unicodeHighlight.disableHighlightingOfNonBasicAsciiCharacters";
    };

// Show options to exclude Unicode highlighting
export type EditorActionUnicodeHighlightShowExcludeOptions = {
    actionName: "editor.action.unicodeHighlight.showExcludeOptions";
};

// Move to the next highlighted word when the editor text is focused and there are word highlights
export type EditorActionWordHighlightNext = {
    actionName: "editor.action.wordHighlight.next";
};

// Navigate to the previous highlighted word when the editor text is focused and has word highlights
export type EditorActionWordHighlightPrev = {
    actionName: "editor.action.wordHighlight.prev";
};

// Trigger word highlight action
export type EditorActionWordHighlightTrigger = {
    actionName: "editor.action.wordHighlight.trigger";
};

// Inspect TextMate scopes
export type EditorActionInspectTMScopes = {
    actionName: "editor.action.inspectTMScopes";
};

// Show Next in Accessible View when accessible view is shown and supports navigation
export type EditorActionAccessibleViewNext = {
    actionName: "editor.action.accessibleViewNext";
};

// Accessible View: Next Code Block when accessible view contains code blocks and current provider is 'panelChat'
export type EditorActionAccessibleViewNextCodeBlock = {
    actionName: "editor.action.accessibleViewNextCodeBlock";
};

// Accessible View: Previous Code Block when accessible view contains code blocks and current provider is 'panelChat'
export type EditorActionAccessibleViewPreviousCodeBlock = {
    actionName: "editor.action.accessibleViewPreviousCodeBlock";
};

// Show Previous in Accessible View when accessible view is shown and supports navigation
export type EditorActionAccessibleViewPrevious = {
    actionName: "editor.action.accessibleViewPrevious";
};

// Go To Symbol in Accessible View when accessibility help is shown and accessible view go to symbol is supported or accessible view go to symbol is supported and accessible view is shown
export type EditorActionAccessibleViewGoToSymbol = {
    actionName: "editor.action.accessibleViewGoToSymbol";
};

// Show accessibility help when accessibility help is not shown
export type EditorActionAccessibilityHelp = {
    actionName: "editor.action.accessibilityHelp";
};

// Accessible view action
export type EditorActionAccessibleView = {
    actionName: "editor.action.accessibleView";
};

// Disable Accessible View Hint when accessibility help is shown and verbosity is enabled or accessible view is shown and verbosity is enabled
export type EditorActionAccessibleViewDisableHint = {
    actionName: "editor.action.accessibleViewDisableHint";
};

// Accessibility Help Configure Unassigned Keybindings when accessibility help is shown and accessible view has unassigned keybindings
export type EditorActionAccessibilityHelpConfigureKeybindings = {
    actionName: "editor.action.accessibilityHelpConfigureKeybindings";
};

// Accessibility Help Configure Assigned Keybindings when accessibility help is shown and accessible view has assigned keybindings
export type EditorActionAccessibilityHelpConfigureAssignedKeybindings = {
    actionName: "editor.action.accessibilityHelpConfigureAssignedKeybindings";
};

// Accessibility Help Open Help Link when accessibility help is shown
export type EditorActionAccessibilityHelpOpenHelpLink = {
    actionName: "editor.action.accessibilityHelpOpenHelpLink";
};

// Accept Inline Completion in accessibility mode when the accessible view is shown and the current provider is inline completions
export type EditorActionAccessibleViewAcceptInlineCompletion = {
    actionName: "editor.action.accessibleViewAcceptInlineCompletion";
};

// Toggle word wrap in the editor
export type EditorActionToggleWordWrap = {
    actionName: "editor.action.toggleWordWrap";
};

// Format the document with multiple options
export type EditorActionFormatDocumentMultiple = {
    actionName: "editor.action.formatDocument.multiple";
};

// Format selection for multiple items
export type EditorActionFormatSelectionMultiple = {
    actionName: "editor.action.formatSelection.multiple";
};

// Navigate to the previous dirty diff when the editor text is focused and the text compare editor is not active
export type EditorActionDirtydiffPrevious = {
    actionName: "editor.action.dirtydiff.previous";
};

// Move to the next dirty diff when the editor text is focused and text compare editor is not active
export type EditorActionDirtyDiffNext = {
    actionName: "editor.action.dirtydiff.next";
};

// Action to navigate to the next comment thread
export type EditorActionNextCommentThreadAction = {
    actionName: "editor.action.nextCommentThreadAction";
};

// Navigate to the previous comment thread
export type EditorActionPreviousCommentThreadAction = {
    actionName: "editor.action.previousCommentThreadAction";
};

// Go to Next Commented Range when the active editor has a commenting range
export type EditorActionNextCommentedRangeAction = {
    actionName: "editor.action.nextCommentedRangeAction";
};

// Go to Previous Commented Range when the active editor has a commenting range
export type EditorActionPreviousCommentedRangeAction = {
    actionName: "editor.action.previousCommentedRangeAction";
};

// Go to Next Commenting Range when accessibility mode is enabled and comment is focused, or editor is focused, or accessibility help is shown and accessible view current provider ID is 'comments'
export type EditorActionNextCommentingRange = {
    actionName: "editor.action.nextCommentingRange";
};

// Go to Previous Commenting Range when accessibility mode is enabled and comment is focused, or editor is focused, or accessibility help is shown and accessible view current provider ID is 'comments'
export type EditorActionPreviousCommentingRange = {
    actionName: "editor.action.previousCommentingRange";
};

// Submit a comment when the comment editor is focused
export type EditorActionSubmitComment = {
    actionName: "editor.action.submitComment";
};

// Show find when the webview find widget is enabled, editor is not focused, and the active editor is 'WebviewEditor'
export type EditorActionWebvieweditorShowFind = {
    actionName: "editor.action.webvieweditor.showFind";
};

// Stop find when the webview find widget is visible, editor is not focused, and the active editor is WebviewEditor
export type EditorActionWebvieweditorHideFind = {
    actionName: "editor.action.webvieweditor.hideFind";
};

// Find next when the webview find widget is focused and the active editor is WebviewEditor
export type EditorActionWebvieweditorFindNext = {
    actionName: "editor.action.webvieweditor.findNext";
};

// Find previous when the webview find widget is focused and the active editor is WebviewEditor
export type EditorActionWebvieweditorFindPrevious = {
    actionName: "editor.action.webvieweditor.findPrevious";
};

// Find when the active editor is an extension and the editor is not focused
export type EditorActionExtensionEditorShowFind = {
    actionName: "editor.action.extensioneditor.showfind";
};

// Find Next when the webview find widget is focused, editor is not focused, and the active editor is 'workbench.editor.extension'
export type EditorActionExtensionEditorFindNext = {
    actionName: "editor.action.extensioneditor.findNext";
};

// Find Previous when the webview find widget is focused, editor is not focused, and the active editor is the extension editor
export type EditorActionExtensionEditorFindPrevious = {
    actionName: "editor.action.extensioneditor.findPrevious";
};

// Toggles an optimized mode for usage with screen readers, braille devices, and other assistive technologies
export type EditorActionToggleScreenReaderAccessibilityMode = {
    actionName: "editor.action.toggleScreenReaderAccessibilityMode";
};

// Format changes in the editor
export type EditorActionFormatChanges = {
    actionName: "editor.action.formatChanges";
};

// Toggle Column Selection Mode
export type EditorActionToggleColumnSelection = {
    actionName: "editor.action.toggleColumnSelection";
};

// Toggle Minimap
export type EditorActionToggleMinimap = {
    actionName: "editor.action.toggleMinimap";
};

// Toggle Control Characters
export type EditorActionToggleRenderControlCharacter = {
    actionName: "editor.action.toggleRenderControlCharacter";
};

// Toggle Render Whitespace
export type EditorActionToggleRenderWhitespace = {
    actionName: "editor.action.toggleRenderWhitespace";
};

// Insert Snippet action
export type EditorActionInsertSnippet = {
    actionName: "editor.action.insertSnippet";
    parameters: {
        snippet?: string;
        langId?: string;
        name?: string;
    };
};

// Show snippets action
export type EditorActionShowSnippets = {
    actionName: "editor.action.showSnippets";
};

// Surround with Snippet...
export type EditorActionSurroundWithSnippet = {
    actionName: "editor.action.surroundWithSnippet";
};

// Format the document when the editor is focused, has no document formatting provider, and is not readonly
export type EditorActionFormatDocumentNone = {
    actionName: "editor.action.formatDocument.none";
};

// Measure Extension Host Latency
export type EditorActionMeasureExtHostLatency = {
    actionName: "editor.action.measureExtHostLatency";
};

// Start TextMate Syntax Grammar Logging
export type EditorActionStartDebugTextMate = {
    actionName: "editor.action.startDebugTextMate";
};

// Define a keybinding action
export type EditorActionDefineKeybinding = {
    actionName: "editor.action.defineKeybinding";
};
