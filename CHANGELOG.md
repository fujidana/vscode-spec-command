# Change Log

All notable changes to the __vscode-spec-command__ extension will be documented in this file.

## [Unreleased]

### Changed

- Make the following settings configurable in Folder Settings window in a multi-root workspace:
  - `spec-command.suggest.codeSnippets`
  - `spec-command.suggest.motors`
  - `spec-command.suggest.counters`

### Fixed

- `files.encoding` value in Folder Settings not being reffered to in a multi-root workspace

## [1.7.1] -- 2021-09-14

### Fixed

- syntax parser not analyzing files in virtual workspaces (i.e., files whose URI scheme is not `"file:"`)
- error in loading the database of build-in symbols when invoked as an web extension

## [1.7.0] -- 2021-09-14

### Changed

- Adapt for a web extension. The extension becomes available in Visual Studio Codespaces (VS Code for the Web).
- Migrate the extension to use webpack.

## [1.6.0] -- 2021-08-31

### Added

- Show more information (function arguments and file paths) in a list of auto completion items. This can be disabled by the `spec-command.suggest.suppressMessages` configuration property in the Settings editor.

### Changed

- Refer to `files.encoding` configuraition property for the file encoding used in workspace file scan. Previously it was fixed to `"utf-8"`.
- Redesign the configuration properties, leveraging recent updates on the Settings editor of VS Code.
  - Deprecate the following properties and instead refer to the built-in VS Code properties to filter files in current workspaces:
    - ~~`spec-command.workspace.inclusiveFilePattern`~~ -> `files.associations`
    - ~~`spec-command.workspace.exclusiveFilePattern`~~ -> `files.exclude`
  - Bundle the following three properties that controls the hint volume into a single property, `spec-command.suggest.suppressMessages`:
    - ~~`spec-command.editor.hintVolume.completionItem`~~
    - ~~`spec-command.editor.hintVolume.signatureHelp`~~
    - ~~`spec-command.editor.hintVolume.hover`~~
  - Rename the following three properties and use key-value pairs instead of strings:
    - ~~`spec-command.editor.codeSnippets`~~ -> `spec-command.suggest.codeSnippets`
    - ~~`spec-command.mnemonic.motors`~~ -> `spec-command.suggest.motors`
    - ~~`spec-command.mnemonic.counters`~~ -> `spec-command.suggest.counters`
  - Rename the following property:
    - ~~`spec-command.command.filePathPrefixInTerminal`~~ -> `spec-command.terminal.filePathPrefix`

## [1.5.1] - 2021-08-19

### Security

- Fix a typo in untrusted workspace settings. Contrary to the expectation, previosuly the `spec-command.command.filePathPrefixInTerminal` option was not disabled in unstrusted workspaces.

## [1.5.0] - 2021-07-01

### Added

- Show a preview when "Open Reference Manual" command is invoked. This feature can be disabled from the configuration.

### Changed

- Change the extension identifier from `vscode-spec` to `spec-command` and eliminate features for log files (Another extension, `spec-log`, has succeeded the features.)
- Change the prefix of the configuration properties from `vscode-spec` to `spec-command`
- Change the language identifier of __spec__ command files from `spec-cmd` to `spec-command`.
- Make "Open Reference Manual" command callable whether __spec__ command file is selected or not.
- Use references to built-in icons instead of SVG files bundled with the extension for editor toolbar.
- Remove the following deprecated contriution properties:
  - `vscode-spec.mnemonic.motor.descriptions`
  - `vscode-spec.mnemonic.motor.labels`
  - `vscode-spec.mnemonic.motor.descriptions`
  - `vscode-spec.mnemonic.counter.labels`
  - `vscode-spec.mnemonic.motor.descriptions`

### Fixed

- improper syntax highlighting rule that always marked `in` operators invalid

### Security

- Sanitize a file path used in the "Run File in Active Terminal" command in order to protect from code injection.
- Support _Workspace Trust_.
  - The `spec-command.command.filePathPrefixInTerminal` option is disabled in unstrusted workspaces.
  - The other features are not prohibited in an unstusted workspace.

## [1.4.0] - 2021-06-10

### Added

- built-in symbols introduced in recent __spec__ versions into the IntelliSense database
- syntaxes built-in symbols introduced in recent __spec__ versions into syntax highlighting rules and diagnostics:
  - initialization of associative arrays without specifying the array index (__spec__ 6.05.03), e.g., `testarray = [ 123, 456, "testing"]`
  - initialization of 2D associative arrays (__spec__ 6.06.01), e.g. `testarray = [ 1:2:"item", 2:3:"item2" ]`
  - assignment of global and local variables at declaration (__spec__ 6.09.10): e.g., `local tmp[] = [ 1, 2, 3 ]; global VAR = 1.234;`
  - assingment of array at declaration (__spec__ 6.10.02), e.g., `array a[10] = [ 1, 2, 3 ]`

### Changed

- Eliminate non-physical files (for example, virtual files in a git repository) from IntelliSense targets.
- Change the language identifier of __spec__ command files from `spec-macro` to `spec-cmd`.
- Refine syntax highlighting rules to __spec__ log files.
- Update Node.js packages, including migration of the diagnostic engine from pegjs to peggy.

## [1.3.0] - 2021-05-25

### Added

- support to __spec__ log files (language identifier: `spec-log`, file extension: `.tlog`), including the following features:
  - synax highlighting
  - code navigation
  - folding

### Changed

- Change the language identifier of __spec__ command files from `spec` to `spec-macro`.
- Improve syntax support for string literal enclosed with `\"`.

## [1.2.1] - 2021-03-03

### Added

- syntax support for `ifp` and `ifd`, defined in SPECD/standard.mac

### Fixed

- a bug where TTY control key `so` was omitted from the syntax parser

## [1.2.0] - 2020-10-15

### Added

- a setting for user-defined code snippets that may include a placeholder for a motor or counter mnemonic (configuration parameter: `vscode-spec.editor.codeSnippets`)
- built-in functions documented only in [CSS - spec help pages](https://certif.com/spec_help/index.html) (not in spec_manA4.pdf) into IntelliSense database: hdf5, taco (esrf), tango, epics, etc. into IntelliSense database.

### Changed

- Redesign the configuration properties for motor/counter mnemonics.
  - Added:
    - `vscode-spec.mnemonic.motors`
    - `vscode-spec.mnemonic.conters`
  - Deprecated:
    - `vscode-spec.mnemonic.motor.descriptions`
    - `vscode-spec.mnemonic.motor.labels`
    - `vscode-spec.mnemonic.motor.descriptions`
    - `vscode-spec.mnemonic.counter.labels`
    - `vscode-spec.mnemonic.motor.descriptions`

## [1.1.4] - 2020-10-05

### Fixed

- syntax checker so that `rdef` for functions (e.g., `rdef myfunc(i, j) "..."`) becomes valid
- hyphenation errors in API reference

## [1.1.3] - 2020-09-16

### Fixed

- hyphenation errors in API reference

### Security

- Update Node.js packages, including a vulnerable dependency.

## [1.1.2] - 2020-07-08

### Changed

- extension icon

### Fixed

- a bug that caused duplicated user-defined symbols in IntelliSense. This occurred when a file whose URI scheme is not `file` (e.g., a virtual file in a `git` repository) was opened.
- a bug that prevented updating IntelliSense database after file rename

## [1.1.1] - 2020-04-07

### Add

- extension icon

### Security

- Update Node.js packages, including a vulnerable dependency.

## [1.1.0] - 2020-01-15

### Fixed

- Now observe file events (deletion and rename) and track file reference. Previously the database of user-defined symbols loses the file reference after file deletion or rename.

## [1.0.0] - 2019-12-04

### Added

- "Run Seclection/Line in Terminal" and "Run File in Terminal" commands. These commands expect __spec__ interactive shell has been ready in the active terminal view.
- some code snippets for motors

### Changed

- Redesign configuration settings:
  - change the property prefix from `spec` to `vscode-spec` (so as to match the extension ID)
  - improve support for multi-root workspaces
  - contribute settings to filter files in workspaces. Now all `*.mac` files in workspaces are scanned to pick up global symbols but are not diagnosed by default.
  - contribute a path prefix setting for "Run File in Terminal" command
  - contribute counter mnemonic registration
- Set the icon for macro different from function (Because VS Code does not provide `Macro` as a symbol kind, the extension uses `Module` instead).

### Fixed

- syntax parser bugs on glob-like pattern (used in `lsdef`, etc.)

## [0.7.2] - 2019-11-14

### Changed

- Improve behavior to handle symbols in IntelliSense and code navigation features:
  - variables, constants and macro and function (`local`, `global`, `constant`, and `def`) declared at the top-level (i.e., not in the code block) are treated globally; IntelliSense feature lists these symbols in other editors (and optionally in workspace files).
  - variables, constants and macro and function (`local`, `global`, `constant`, and `def`) declared in code blocks are treated locally; IntelliSense feature lists these symbols only when they are visible from the current cursor position.
  - IntelliSense feature now lists function parameters as local variables

## [0.7.1] - 2019-10-30

### Changed

- Improve syntax parser, including:
  - support of variant quatations of a string literal (`"`, `'`, `\"`, `\'`) (syntax parser only; code highligting engine assumes `"` as a string literal and `\'` as the body of a macro and function)
  - support of escape sequenses of TTY command such as `\[md]`

## [0.7.0] - 2019-10-15

### Added

- IntelliSense and code navigation features that cover local and global variables nested in a block statements

## [0.6.0] - 2019-10-04

### Added

- command to open the reference manual as a virtual document

### Changed

- Equip totally rewritten syntax parser, which covers most grammar.
- Expand IntelliSense and code navigation features into constants.

## [0.5.2] - 2019-09-28

### Added

- several undocumented built-in functions in the IntelliSense database

### Changed

- Categorize `PI` as a built-in constant (formerly a variable).

### Fixed

- incomplete syntax highlighting on external shared array declaration

## [0.5.0] - 2019-09-20

### Added

- IntelliSense and code navigation features that covers workspace files (disabled by default; use the settings to enable it)
- syntaxes to handle a string literal using backslash-escaped single quotes (`\' ... \'`) (both disgnostics and highlighting)

### Fixed

- inappropriate syntax highlighting on a multi-line string (including a sting whose closing quote is missing) in some statements

## [0.4.0] - 2019-09-13

### Added

- syntax diagnostics (primitive; only some parts of statements are validated but most expressions are not)
- code navigation feature for user-defined macros and functions in open documents
- IntelliSense feature for user-defined macros and functions in open documents

## [0.3.1] - 2019-09-11

### Changed

- overhaul syntax highlighting

### Fixed

- fix corrupted rule for motor mnemonics

## [0.3.0] - 2019-09-07

### Added

- IntelliSence features for common macros related to motor actions, such as `mv` and `ascan`

## [0.2.0] - 2019-09-04

### Added

- language support features covering built-in functions, macros, variables and several other keywords:
  - hovers
  - code completion proposals
  - help with function signatures

## [0.1.1] - 2019-08-29

### Added

- language support features for __spec__ command file (language identifier: `spec`, file extension: `.mac`):
  - syntax highlighting
  - code snippets

[Unreleased]: https://github.com/fujidana/vscode-spec-command/compare/v1.7.1...HEAD
[1.7.1]: https://github.com/fujidana/vscode-spec-command/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/fujidana/vscode-spec-command/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/fujidana/vscode-spec-command/compare/v1.5.1...v1.6.0
[1.5.1]: https://github.com/fujidana/vscode-spec-command/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/fujidana/vscode-spec-command/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/fujidana/vscode-spec-command/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/fujidana/vscode-spec-command/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/fujidana/vscode-spec-command/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/fujidana/vscode-spec-command/compare/v1.1.4...v1.2.0
[1.1.4]: https://github.com/fujidana/vscode-spec-command/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/fujidana/vscode-spec-command/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/fujidana/vscode-spec-command/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/fujidana/vscode-spec-command/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/fujidana/vscode-spec-command/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/fujidana/vscode-spec-command/compare/v0.7.2...v1.0.0
[0.7.2]: https://github.com/fujidana/vscode-spec-command/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/fujidana/vscode-spec-command/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/fujidana/vscode-spec-command/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/fujidana/vscode-spec-command/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/fujidana/vscode-spec-command/compare/v0.5.0...v0.5.2
[0.5.0]: https://github.com/fujidana/vscode-spec-command/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/fujidana/vscode-spec-command/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/fujidana/vscode-spec-command/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/fujidana/vscode-spec-command/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/fujidana/vscode-spec-command/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/fujidana/vscode-spec-command/releases/tag/v0.1.1
