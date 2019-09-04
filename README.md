# vscode-spec README

This extension provides **spec** macro script (`*.mac`) support for Visual Studio Code.
**spec** is software for instrument control and data acquisition in X-ray diffraction experiments, used at synchrotrons, industrial laboratories, universities and research facilities.

This extension is not the official one provided by Certified Scientific Software.

## Features

This extension currently supports

* Syntax Highlight
* Code Snippets
* Hovers (for built-in symbols only)
* Code completion proposals (for built-in symbols only)
* Help with function signatures (for built-in symbols only)

This extension was developed with reference to the recent official PDF document about **spec** release 6 (version 3 of the spec documentation, printed 16 July 2017).

## Requirements

Nothing.

## Extension Settings

This extention contributes the settings to control the volume of explanatory text shown by IntelliSense features.
One can find the settings in **Extension / spec** in the **Settings** window.
Read [Visual Studio Code User and Workspace Settings](https://code.visualstudio.com/docs/getstarted/settings) if one can not find them.

<!-- Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `myExtension.enable`: enable/disable this extension
* `myExtension.thing`: set to `blah` to do something -->

## Known Issues

* Statement continuation by putting a backslash at the end of the line is not supported.
