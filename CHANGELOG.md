# Change Log

All notable changes to the __vscode-spec__ extension will be documented in this file.

<!-- Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file. -->

## [Unreleased]

## [1.2.0] - 2020-10-15

* contribute a setting for user-defined code snippets that may include a placeholder for a motor or counter mnemonic.
* add descriptions of built-in functions documented only in [CSS - spec help pages](https://certif.com/spec_help/index.html) (not in spec_manA4.pdf) into IntelliSence database: hdf5, taco (esrf), tango, epics, etc.

## [1.1.4] - 2020-10-05

* modify syntax checker so that `rdef` for functions (e.g., `rdef myfunc(i, j) "..."`) becomes valid.
* fix hyphenation errors in API reference

## [1.1.3] - 2020-09-16

* fix hyphenation errors in API reference
* update Node.js packages (including a vulnerable dependency)

## [1.1.2] - 2020-07-08

* fix a bug that caused duplicated user-defined symbols in IntelliSence. This occurred when a file whose URI scheme is not `file` (e.g., a virtual file in a `git` repository) was opened.
* fix a bug that prevented updating IntelliSence database after file rename.
* modify icon

## [1.1.1] - 2020-04-07

* update Node.js packages (including a vulnerable dependency)
* add icon

## [1.1.0] - 2020-01-15

* observe file events (deletion and rename) and track file reference. Previously the database of user-defined symbols lost the file reference after file deletion or rename.

## [1.0.0] - 2019-12-04

* add "Run Seclection/Line in Terminal" and "Run File in Terminal" commands. These commands expect __spec__ interactive shell has been ready in the active terminal view.
* redesign configuration settings
  * change the identifier prefix from `spec` to `vscode-spec` (so as to match the extension ID)
  * improve support for multi-root workspaces.
  * contribute settings to filter files in workspaces. Now all `*.mac` files in workspaces are scanned to pick up global symbols but are not diagnosed by default.
  * contribute a path prefix setting for "Run File in Terminal" command
  * contribute counter mnemonic registration
* add some code snippets for motors
* fix syntax parser bugs on glob-like pattern (used in `lsdef`, etc.)
* make icon for macro different from function (Because VS Code does not provide `Macro` as a symbol kind, the extension uses `Module` instead.)

## [0.7.2] - 2019-11-14

* improve behavior to handle symbols in IntelliSense and code navigation features
  * variables, constants and macro and function (`local`, `global`, `constant`, and `def`) declared at the top-level (i.e., not in the code block) are treated globally; IntelliSense feature lists these symbols in other editors (and optionally in workgroup files).
  * variables, constants and macro and function (`local`, `global`, `constant`, and `def`) declared in code blocks are treated locally; IntelliSense feature lists these symbols only when they are visible from the current cursor position.
  * IntelliSense feature now lists function parameters as local variables.

## [0.7.1] - 2019-10-30

* improve syntax parser, including
  * support of variant quatations of a string literal (`"`, `'`, `\"`, `\'`) (syntax parser only; code highligting engine assumes `"` as a string literal and `\'` as the body of a macro and function)
  * support of escape sequense of TTY command such as `\[md]`

## [0.7.0] - 2019-10-15

* expand IntelliSense and code navigation features into local and global variables nested in a block statements

## [0.6.0] - 2019-10-04

* equip totally rewritten syntax parser, which covers most grammar
* expand IntelliSense and code navigation features into constants
* enable to open the reference manual as a virtual document

## [0.5.2] - 2019-09-28

* categorize PI as a built-in constant (formerly a variable)
* register several undocumented built-in functions in the IntelliSense database
* fix incomplete syntax highlighting on external shared array declaration

## [0.5.0] - 2019-09-20

* expand IntelliSense and code navigation features into workspace files (disabled by default; use the settings to enable it)
* add a string literal using backslash-escaped single quotes (`\' ... \'`) in the syntaxes (both disgnostics and highlighting)
* fix inappropriate syntax highlighting on a multi-line string (including a sting whose closing quote is missing) in some statements

## [0.4.0] - 2019-09-13

* add new features:
  * syntax diagnostics (primitive; only some parts of statements are validated but most expressions are not)
  * code navigation such as 'Go to Definition', which covers user-defined macros and functions in open documents
* expand IntelliSense features into user-defined macros and functions in open documents

## [0.3.1] - 2019-09-11

* fix corrupted rule for motor mnemonics
* overhaul syntax highlighting

## [0.3.0] - 2019-09-07

* expand IntelliSence features into common macros related to motor actions, such as `mv` and `ascan`

## [0.2.0] - 2019-09-04

* add new features covering built-in functions, macros, variables and several other keywords:
  * hovers
  * code completion proposals
  * help with function signatures

## [0.1.1] - 2019-08-29

* add new features:
  * syntax highlighting
  * code snippets

[Unreleased]: https://github.com/fujidana/vscode-spec/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/fujidana/vscode-spec/compare/v1.1.4...v1.2.0
[1.1.4]: https://github.com/fujidana/vscode-spec/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/fujidana/vscode-spec/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/fujidana/vscode-spec/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/fujidana/vscode-spec/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/fujidana/vscode-spec/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/fujidana/vscode-spec/compare/v0.7.2...v1.0.0
[0.7.2]: https://github.com/fujidana/vscode-spec/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/fujidana/vscode-spec/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/fujidana/vscode-spec/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/fujidana/vscode-spec/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/fujidana/vscode-spec/compare/v0.5.0...v0.5.2
[0.5.0]: https://github.com/fujidana/vscode-spec/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/fujidana/vscode-spec/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/fujidana/vscode-spec/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/fujidana/vscode-spec/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/fujidana/vscode-spec/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/fujidana/vscode-spec/releases/tag/v0.1.1
