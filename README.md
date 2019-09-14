# vscode-spec README

This extension provides **spec** macro script (`*.mac`) support for Visual Studio Code.
This extension is not the official one developed by Certified Scientific Software.

## What's **spec**?

> **spec** is internationally recognized as the leading software for instrument control and data acquisition in X-ray diffraction experiments.
> It is used at more than 200 synchrotrons, industrial laboratories, universities and research facilities around the globe.

*cited from [CSS - Certified Scientific Software](https://www.certif.com) homepage.*

## Features

This extension supports the following features:

* __Diagnostics__ - syntax check, _still primitive_
* __Syntax highlight__ - colorizing symbols using a grammer
* __IntelliSense__ - code completion and hinting
  * __Hovers__
  * __Code completion proposals__ - autocompletion that works during a user types a symbol
    * __Code snippets__
  * __Help with function signatures__ - help that appears during a user types an argument in a function call.
* __Code navigation__
  * __Show all symbol definitions within a document__ - symbol definitions in a file, used in: _Go to Symbol in File_ (Ctrl+Shift+O) and the navigation bar below the editor tabs
  * __Show definitions of a symbol__ - symbol definitions in open files, used in: _Go to Definition_ (F12) and _Peek Definition_ (Alt+F12) in right-click menu

These features cover user-defined functions and macros in open documents, in addition to built-in variables, constants, functions, macros and some other keywords.
User-defined variables are currently outside the scope.

This extension was developed with reference to the recent official PDF document about **spec** release 6 (version 3 of the spec documentation, printed 16 July 2017).

## Requirements

Nothing.

## Extension Settings

This extention contributes the follwing settings:

1. controls the volume of explanatory text shown by IntelliSense features.
2. registers information about the motor mnemonics, which enables IntelliSense features for `mv`, `mvr`, `ascan`, `dscan`, etc.

    * `spec.mnemonics.motor.labels`: a string array of the motor mnemonic, for example, `["th", "tth", "phi"]`
    * `spec.mnemonics.motor.descriptions`: a string array of the descripive text of the motor mnemonic, for example, `["theta", "2 theta"]`. This property is optional; its array length needs not be equal to that of `spec.mnemonics.motor.labels`.

One can find the settings in *Extension / spec* in the *Settings* window.
Read [Visual Studio Code User and Workspace Settings](https://code.visualstudio.com/docs/getstarted/settings) if one has difficulty in setting them.

<!-- Include if your extension adds any VS Code settings through the `contributes.configuration` extension point . -->

## Known Issues

* Currently the syntax diagnostics covers limited parts of the grammar and its error message is primitive.
* Statement continuation by putting a backslash at the end of the line is not supported.
