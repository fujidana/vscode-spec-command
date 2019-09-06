# vscode-spec README

This extension provides **spec** macro script (`*.mac`) support for Visual Studio Code.
This extension is not the official one developed by Certified Scientific Software.

## What's **spec**?

> **spec** is internationally recognized as the leading software for instrument control and data acquisition in X-ray diffraction experiments.
> It is used at more than 200 synchrotrons, industrial laboratories, universities and research facilities around the globe.

*cited from [CSS - Certified Scientific Software](https://www.certif.com) homepage.*

## Features

This extension currently supports

* Syntax Highlight
* Code Snippets
* Hovers (of built-in symbols and motor-related macros)
* Code completion proposals (of built-in symbols and motor-related macros)
* Help with function signatures (of built-in functions)

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

* Statement continuation by putting a backslash at the end of the line is not supported.
