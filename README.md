# __spec__ Command File Extension for Visual Studio Code

The extension enhances user experiences in editing __spec__ command files, typically loaded by `qdo` after a user writes user-defined macros in it.

The default file extention of __spec__ command files is `.mac` but VS Code provides ways for a user to change the association.
Check VS Code official documents for further details.

## What's __spec__?

> __spec__ is internationally recognized as the leading software for instrument control and data acquisition in X-ray diffraction experiments.
> It is used at more than 200 synchrotrons, industrial laboratories, universities and research facilities around the globe.

_cited from [CSS - Certified Scientific Software](https://www.certif.com) homepage._

Note that the extention is not the official one developed by Certified Scientific Software.
Use [GitHub issues](https://github.com/fujidana/vscode-spec-command/issues) for bug reports and feature requests about the extension.

## NOTICE for previous version users

Recent versions of __spec__ language support (`vscode-spec`) becames to support both __spec__ command files and __spec__ log files.
However, it may be not a rare cases in which files of either kind are only opened in a workspace.
VS Code loads the extension into memory at the first time a file of which a kind the extension supports is being opened and thus, building independent extensions based on the file type looks a better implementation mannaer.
For this reason (and also for another reasons such as ease of maintenance and expandability to new features), the developer has decided to split the extension into two; one is for __spec__ command files (both the exention identifier and language identifier are `spec-command`) and the other is for __spec__ log file (`spec-log`). This document is for the former extension.

If one has configuration items that start with `vscode-spec` in _setting.json_ files, replace them with `spec-command`.
The original identifier, `vscode-spec`, will be used as an extension pack that bundles both the split extensions.

The language identifier of __spec__ command files was also renamed `spec-command` in v1.5.0 (it was `spec` in the versions earlier than v1.3.0, `spec-macro` in v1.3.0, and `spec-cmd` in v1.4.0).
If one associates __spec__ command files with different file extension from the default value, replate the identifier in _settings.json_.

Sorry for inconvenence.

The following identifiers in the extension settings are deprecated at v1.2.0 and removed at v1.5.0:

* `vscode-spec.mnemonic.motor.labels`
* `vscode-spec.mnemonic.motor.descriptions`
* `vscode-spec.mnemonic.counter.labels`
* `vscode-spec.mnemonic.motor.descriptions`

## Features

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
  * "Run Seclection/Line in Terminal" and "Run File in Terminal" commands. These commands assume __spec__ interactive shell has been ready in the active terminal view.
  * "Open Reference Manuall" command.

This extention treats user-defined symbols declared at the top level (i.e., not in a code block, curly brackets) as global and those in code blocks as local.
Global symbols are visible beyond a file where the symbol is defined; local symbols are visible only when the cursor is in the same block.

![screenshot of the hover](resources/screenshot.png "hover demo")

The extension was developed with reference to the recent official PDF document about __spec__ release 6 (version 3 of the spec documentation, printed 16 July 2017).
The help text of built-in symbols are cited from this document, except where otherwise noted.

## Requirements

The extension assumes UTF-8 as the file encoding in workspace scan, regardless of user settings or selection in current editor.
This does not mean the developer garantees UTF-8 characters are safe for __spec__ interpreters.

The __spec__ grammar is torelant and its behavior is determined only at runtime, which makes it impossible for the extension to mimic spec's interpreter perfectly.
For example, the extention treats `f(var)` in a __spec__ script as a function call (like most people assume) but there is another possibility:

```
1.SEPC> def f1(var) '{p var}' # function definition
2.SEPC> f1(123)               # function call, common
123
3.SEPC> f1(123) f1(456)       # invalid syntax
syntax error on ";"

4.SEPC> def f2 '{p "$*"}'     # macro definition
5.SEPC> f2(123)               # macro call, anomalous but valid
(123)
5.SEPC> f2(123) f2(456)       # also valid
(123) f2(456)
```

Macros made of an imperfect statement are another examples the extention can not handle well
(`ifd` and `ifp` defined in `SPECD/standard.mac` are exceptionally supported).
User-defined macros must be made of one or more perfect sentenses.

```
def ifd 'if (DATAFILE != "" && DATAFILE != "/dev/null")'
ifd do_something; else do_otherthing;
```

This extension also requires stricter coding than the __spec__ interpreters does.
For example, __spec__ interpreters evaluate the following two lines equivalently:

```
qdo /home/myuser/mymacro.mac
qdo "/home/myuser/mymacro.mac"
```

but the extension shows an alert on the first line because it expects explicit quotation marks for a string literal.

## Extension Settings

This extention contributes the follwing settings, which are configurable from the _Settings_ windw (`Ctrl+,`):

* `spec-command.editor.hintVolume.*` - controls the volume of explanatory text shown by IntelliSense features.
* `spec-command.editor.codeSnippets` - provides a place to add code snippet templates that include motor/counter mnemonics in TextMate snippet syntax. Snippets for `mv`, `mvr`, `umv`, `umvr`, `ascan`, `dscan`, `a2scan`, `d2scan`, `a3scan`, `d3scan`, `a4scan`, `d4scan`, and `mesh` are provided by default and thus, users does not need to add it. Read [Snippets in Visual Studio Code](https://code.visualstudio.com/docs/editor/userdefinedsnippets) for other information about the syntax. In addition, `%MOT` and `%CNT` are avaiable as the placeholders of motor/counter mnemonics, respectively. Optionally, a description can be added after a hash sign (`#`). Example: `mv ${1%MOT} ${2:pos} # absolute move`.
* `spec-command.mnemonic.motors`, `spec-command.mnemonic.counters` - registers motor/counter mnemonics and optionally their descriptions after `#` letter. They are used by IntelliSense features and code snippets above.  Example: `tth # two-theta angle`.
* `spec-command.workspace.*` - controls the rule to scan files in workspace.
* `spec-command.command.filePathPrefixInTerminal` - specifies file path prefix used in "Run File in Active Terminal" command.

Read [Visual Studio Code User and Workspace Settings](https://code.visualstudio.com/docs/getstarted/settings) for details about the _Settings_ window.

## Known Issues

* Syntax check by this extension has small differences with actual __spec__ interpreters.
* Statement continuation by putting a backslash at the end of the line is not fully supported in syntax highlighting.

Also read [GitHub issues](https://github.com/fujidana/vscode-spec-cmmand/issues).
