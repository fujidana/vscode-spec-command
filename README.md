# vscode-spec README

This VS Code extension provides editing/viewing support to the following files:

* `spec-macro`: __spec__ command file, typically loaded by `qdo` after a user writes user-defined macros in it
* `spec-log`: __spec__ transaction log file, created when __spec__ is launched with `-l logfile` option

The default file extensions of these files this extension expects are `.mac` and `.tlog`, respectively.
VS Code provides a way for a user to change the association with file extensions.

```json
"files.associations": {
  "*.src": "spec-macro",
  "*.log": "spec-log"
}
```

## What's __spec__?

> __spec__ is internationally recognized as the leading software for instrument control and data acquisition in X-ray diffraction experiments.
> It is used at more than 200 synchrotrons, industrial laboratories, universities and research facilities around the globe.

_cited from [CSS - Certified Scientific Software](https://www.certif.com) homepage._

This is not the official one developed by Certified Scientific Software.
Use [GitHub issues](https://github.com/fujidana/vscode-spec/issues) for bug reports and feature requests about the extension.

## NOTICE for previous version users

The language identifier of __spec__ command files are changed from `spec` to `spec-macro` in the version 1.3.0.

The following identifiers in the extension settings are deprecated in the version 1.2.0:

* `vscode-spec.mnemonic.motor.labels`
* `vscode-spec.mnemonic.motor.descriptions`
* `vscode-spec.mnemonic.counter.labels`
* `vscode-spec.mnemonic.motor.descriptions`

and the following identifiers are provided instead:

* `vscode-spec.mnemonic.motors`
* `vscode-spec.mnemonic.counters`

If you registered motor and counter mnemonics in the extension settings in the older version, please manually copy those values in the deprecated identifiers to the new identifiers.
Read also __Extension Settings__ section below.
Sorry for inconvenence.

## Features

### Features for __spec__ command files

* __Diagnostics__ - syntax check
* __Syntax highlighting__ - colorizing symbols using a grammer
* __IntelliSense__ - code completion and hinting
  * __Hovers__
  * __Code completion proposals__ - autocompletion that works during a user types a symbol
    * __Code snippets__ - templates that make it easier to enter repeating code patterns, such as loops or conditional-statements
  * __Help with function signatures__ - help that appears during a user types an argument in a function call.
* __Code navigation__
  * __Show all symbol definitions within a document__ - symbol definitions in a file, used in: _Go to Symbol in File_ (Ctrl+Shift+O) and the navigation bar below the editor tabs (aka breadcrumb)
  * __Show definitions of a symbol__ - symbol definitions in open files, used in: _Go to Definition_ (F12) and _Peek Definition_ (Alt+F12) in right-click menu
* __Commands__ - the following commands can be invoked from the command pallate (Ctrl+Shit+P):
  * "Run Seclection/Line in Terminal" and "Run File in Terminal" commands. These commands expect __spec__ interactive shell has been ready in the active terminal view.
  * "Open Reference Manuall" command.

This extention treats user-defined symbols declared at the top level (i.e., not in a code block, curly brackets) as global and those in code blocks as local.
Global symbols are visible beyond a file where the symbol is defined; local symbols are visible only when the cursor is in the same block.

The extension was developed with reference to the recent official PDF document about __spec__ release 6 (version 3 of the spec documentation, printed 16 July 2017).
The help text of built-in symbols are cited from this document, except where otherwise noted.

### Features for __spec__ transaction log files

* __Syntax highlighting__
* __Code navigation__
  * __Show all symbol definitions within a document__
* __Code folding__

Lines of __spec__ prompts such as `1.FOURC>` are picked out for code navigation and folding.

## Requirements

The extension assumes UTF-8 as the file encoding in workspace scan, regardless of user settings or selection in current editor.
This does not mean the developer garantees UTF-8 characters are safe for __spec__ interpreters.

The __spec__ grammar is torelant, lazy in other word.
It is difficult to perfectly mimic its behavior.
Instead, this extension requires stricter coding than the __spec__ interpreters does.
For example, __spec__ interpreters evaluate the following two lines equivalently:

```
qdo /home/myuser/mymacro.mac
qdo "/home/myuser/mymacro.mac"
```

but the extension shows an alert on the first line because it expects explicit quotation marks for a string literal.

Also, the extension does not support macros made of an imperfect statement, except `ifd` and `ifp` (defined in `SPECD/standard.mac`).
User-defined macros must be made of one or more perfect sentenses.

```
def ifd 'if (DATAFILE != "" && DATAFILE != "/dev/null")'
ifd do_something; else do_otherthing;
```

## Extension Settings

This extention contributes the follwing settings, which are configurable from the _Settings_ windw (`Ctrl+,`):

* `vscode-spec.editor.hintVolume.*` - controls the volume of explanatory text shown by IntelliSense features.
* `vscode-spec.editor.codeSnippets` - provides a place to add code snippet templates that include motor or counter mnemonics in TextMate snippet syntax. Snippets for `mv`, `mvr`, `umv`, `umvr`, `ascan`, `dscan`, `a2scan`, `d2scan`, `a3scan`, `d3scan`, `a4scan`, `d4scan`, and `mesh` are provided by default and thus, users does not need to add it. Read [Snippets in Visual Studio Code](https://code.visualstudio.com/docs/editor/userdefinedsnippets) for other information about the syntax. In addition, `%MOT` and `%CNT` are avaiable as the placeholders of motor and counter mnemonics, respectively. Optionally, a description can be added after a hash sign (`#`). Example: `mv ${1%MOT} ${2:pos} # absolute move`.
* `vscode-spec.mnemonic.motors` and `vscode-spec.mnemonic.counters` - registers motor and counter mnemonics and optionally their descriptions after `#` letter. They are used by IntelliSense features and code snippets above.  Example: `tth # two-theta angle`.
* `vscode-spec.workspace.*` - controls the rule to scan files in workspace.
* `vscode-spec.command.filePathPrefixInTerminal` - specifies file path prefix used in "Run File in Active Terminal" command.

Read [Visual Studio Code User and Workspace Settings](https://code.visualstudio.com/docs/getstarted/settings) for details about the _Settings_ window.

## Known Issues

* Syntax check by this extension has small differences with actual __spec__ interpreters.
* Statement continuation by putting a backslash at the end of the line is not fully supported in syntax highlighting.

Also read [GitHub issues](https://github.com/fujidana/vscode-spec/issues).
