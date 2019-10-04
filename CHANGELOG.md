# Change Log

All notable changes to the __spec__ extension will be documented in this file.

<!-- Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file. -->

## [Unreleased]

## [0.6.0] - 2019-10-04

### Add

* equip totally rewritten syntax parser, which covers most grammar
* expand IntelliSense and code navigation features into constants
* enable to open the reference manual as a virtual document

## [0.5.2] - 2019-09-28

### Changed

* categorize PI as a built-in constant (formerly a variable)
* register several undocumented built-in functions in the IntelliSense database
* fix incomplete syntax highlighting on external shared array declaration

## [0.5.0] - 2019-09-20

### Added

* expand IntelliSense and code navigation features into workspace files (disabled by default; use the settings to enable it)

### Changed

* add a string literal using backslash-escaped single quotes (`\' ... \'`) in the syntaxes (both disgnostics and highlighting)
* fix inappropriate syntax highlighting on a multi-line string (including a sting whose closing quote is missing) in some statements

## [0.4.0] - 2019-09-13

### Added

* add new features:
  * syntax diagnostics (primitive; only some parts of statements are validated but most expressions are not)
  * code navigation such as 'Go to Definition', which covers user-defined macros and functions in open documents
* expand IntelliSense features into user-defined macros and functions in open documents

## [0.3.1] - 2019-09-11

### Changed

* fix corrupted rule for motor mnemonics
* overhaul syntax highlighting

## [0.3.0] - 2019-09-07

### Added

* expand IntelliSence features into common macros related to motor actions, such as `mv` and `ascan`

## [0.2.0] - 2019-09-04

### Added

* add new features covering built-in functions, macros, variables and several other keywords:
  * hovers
  * code completion proposals
  * Help with function signatures

## [0.1.1] - 2019-08-29

### Added

* add new features:
  * syntax highlighting feature
  * code snippets feature

[Unreleased]: https://github.com/fujidana/vscode-spec/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/fujidana/vscode-spec/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/fujidana/vscode-spec/compare/v0.5.0...v0.5.2
[0.5.0]: https://github.com/fujidana/vscode-spec/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/fujidana/vscode-spec/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/fujidana/vscode-spec/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/fujidana/vscode-spec/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/fujidana/vscode-spec/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/fujidana/vscode-spec/releases/tag/v0.1.1
