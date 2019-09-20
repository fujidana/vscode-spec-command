# Change Log

All notable changes to the __spec__ extension will be documented in this file.

<!-- Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file. -->

## [Unreleased]

## [0.5.0] - 2019-09-20

### Added

* IntelliSensse and navigation features expanded into workspace files (disabled by default; use the settings to enable it)

### Changed

* added a string literal using backslash-escaped single quotes (`\'`) in the syntaxes (both disgnostics and highlighting)
* fix of inappropriate syntax highlighting on a multi-line string (including a sting whose closing quote is missing) in some statements

## [0.4.0] - 2019-09-13

### Added

* syntax diagnostics (primitive)
* IntelliSense features expanded into user-defined macros and functions in open documents
* code navigation such as 'Go to Definition', which covers user-defined macros and functions in open documents

## [0.3.1] - 2019-09-11

### Changed

* fix of corrupted rule for motor mnemonics
* overhaul of syntax highlighting

## [0.3.0] - 2019-09-07

### Added

* IntelliSence features expanded into common macros related to motor actions, such as `mv` and `ascan`

## [0.2.0] - 2019-09-04

### Added

* the following IntelliSense features covering built-in functions, macros, variables and several other keywords:
  * hovers
  * code completion proposals
  * Help with function signatures

## [0.1.1] - 2019-08-29

### Added

* syntax highlighting feature
* code snippets feature

[Unreleased]: https://github.com/fujidana/vscode-spec/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/fujidana/vscode-spec/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/fujidana/vscode-spec/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/fujidana/vscode-spec/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/fujidana/vscode-spec/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/fujidana/vscode-spec/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/fujidana/vscode-spec/releases/tag/v0.1.1
