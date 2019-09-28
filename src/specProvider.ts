import * as vscode from 'vscode';

interface PesPosition {
	offset: number;
	line: number;
	column: number;
}

interface PesRange {
	start: PesPosition;
	end: PesPosition;
}

export function convertPosition(pesPosition: PesPosition) {
	return new vscode.Position(pesPosition.line - 1, pesPosition.column - 1);
}

export function convertRange(pesRange: PesRange) {
	return new vscode.Range(convertPosition(pesRange.start), convertPosition(pesRange.end));
}

export const BUILTIN_URI = vscode.Uri.parse('spec:/built-in').toString();
export const MOTOR_URI = vscode.Uri.parse('spec:/mnemonic.motor').toString();

export const enum ReferenceItemKind {
	Constant,
	Variable,
	Macro,
	Function,
	Keyword,
	Snippet,
	Enum,
	Undefined,
}

export function convertCompletionItemKindToReferenceItemKind(completionItemKind?: vscode.CompletionItemKind): ReferenceItemKind {
	switch (completionItemKind) {
		case vscode.CompletionItemKind.Constant:
			return ReferenceItemKind.Constant;
		case vscode.CompletionItemKind.Variable:
			return ReferenceItemKind.Variable;
		case vscode.CompletionItemKind.Function:
			return ReferenceItemKind.Macro;
		case vscode.CompletionItemKind.Method:
			return ReferenceItemKind.Function;
		case vscode.CompletionItemKind.Keyword:
			return ReferenceItemKind.Keyword;
		case vscode.CompletionItemKind.Snippet:
			return ReferenceItemKind.Snippet;
		case vscode.CompletionItemKind.EnumMember:
			return ReferenceItemKind.Enum;
		default:
			return ReferenceItemKind.Undefined;
	}
}

export function convertReferenceItemKindToCompletionItemKind(refItemKind: ReferenceItemKind): vscode.CompletionItemKind | undefined {
	switch (refItemKind) {
		case ReferenceItemKind.Constant:
			return vscode.CompletionItemKind.Constant;
		case ReferenceItemKind.Variable:
			return vscode.CompletionItemKind.Variable;
		case ReferenceItemKind.Macro:
			return vscode.CompletionItemKind.Function;
		case ReferenceItemKind.Function:
			return vscode.CompletionItemKind.Method;
		case ReferenceItemKind.Keyword:
			return vscode.CompletionItemKind.Keyword;
		case ReferenceItemKind.Snippet:
			return vscode.CompletionItemKind.Snippet;
		case ReferenceItemKind.Enum:
			return vscode.CompletionItemKind.EnumMember;
		case ReferenceItemKind.Undefined:
			return undefined;
		default:
			return undefined;
	}
}

export function convertReferenceItemKindToSymbolKind(refItemKind: ReferenceItemKind): vscode.SymbolKind {
	switch (refItemKind) {
		case ReferenceItemKind.Constant:
			return vscode.SymbolKind.Constant;
		case ReferenceItemKind.Variable:
			return vscode.SymbolKind.Variable;
		case ReferenceItemKind.Macro:
			return vscode.SymbolKind.Function;
		case ReferenceItemKind.Function:
			return vscode.SymbolKind.Method;
		// case ReferenceItemKind.Keyword:
		// case ReferenceItemKind.Snippet:
		case ReferenceItemKind.Enum:
			return vscode.SymbolKind.EnumMember;
		case ReferenceItemKind.Undefined:
			return vscode.SymbolKind.Null;
		default:
			return vscode.SymbolKind.Null;
	}
}

function getShortDescription(refItem: ReferenceItem, refItemKind: ReferenceItemKind, refItemUriString: string, documentUriString: string, outputsMarkdown: boolean) {
	let symbolLabel: string;
	let relativePath: string | undefined;
	switch (refItemKind) {
		case ReferenceItemKind.Constant:
			symbolLabel = "constant"; break;
		case ReferenceItemKind.Variable:
			symbolLabel = "variable"; break;
		case ReferenceItemKind.Macro:
			symbolLabel = "macro"; break;
		case ReferenceItemKind.Function:
			symbolLabel = "function"; break;
		case ReferenceItemKind.Keyword:
			symbolLabel = "keyword"; break;
		case ReferenceItemKind.Snippet:
			symbolLabel = "snippet"; break;
		case ReferenceItemKind.Enum:
			symbolLabel = "member"; break;
		default:
			symbolLabel = "symbol"; break;
	}

	if (refItemUriString === BUILTIN_URI) {
		symbolLabel = 'built-in ' + symbolLabel;
	} else if (refItemUriString === MOTOR_URI) {
		symbolLabel = 'user-configured ' + symbolLabel;
	} else if (refItemUriString === documentUriString) {
		symbolLabel = symbolLabel + ' defined in this file';
	} else {
		relativePath = vscode.workspace.asRelativePath(vscode.Uri.parse(refItemUriString));
		symbolLabel = outputsMarkdown ? 'user-defined ' + symbolLabel : symbolLabel + ' defined in ' + relativePath;
	}

	let mainText = `${refItem.signature} # ${symbolLabel}`;
	if (refItem.overloads && refItem.overloads.length > 1) {
		mainText += `, ${refItem.overloads.length} overloads`;
	}

	if (outputsMarkdown) {
		let markdownString = new vscode.MarkdownString().appendCodeblock(mainText);
		if (relativePath) {
			markdownString = markdownString.appendMarkdown(`_defined in_ [${relativePath}](${refItemUriString}).\n\n`);
		}
		return markdownString;
	} else {
		return mainText;
	}
}

// 'overloads' parameter is for built-in macros and functions.
export interface ReferenceItem {
	signature: string;
	description?: string;
	snippet?: string;
	location?: PesRange;
	overloads?: Overload[];
}

export interface Overload {
	signature: string;
	description?: string;
}

export class ReferenceMap extends Map<string, ReferenceItem> { }

export class ReferenceStorage extends Map<ReferenceItemKind, ReferenceMap> { }


function truncateText(text: string, settingKey: string): string {
	const volume = vscode.workspace.getConfiguration('spec.helpDocumentVolume').get(settingKey);
	if (volume === 'full') {
		return text;
	} else if (volume === 'paragraph') {
		const endIndex = text.indexOf('\n\n');
		return (endIndex >= 0) ? text.substr(0, endIndex) + '\n\n...' : text;
	} else if (volume === 'sentence') {
		const endIndex = text.search(/\.\s/g);
		return (endIndex >= 0) ? text.substr(0, endIndex) + '. ...' : text;
	} else {
		return '';
	}
}

function getParameterInformation(signature: string): vscode.ParameterInformation[] | undefined {
	const parStart = signature.indexOf('(');
	const parEnd = signature.lastIndexOf(')');
	if (parStart < 0 || parEnd < 0) {
		return undefined;
	}
	// const selectorName = signature.substring(0, parStart).trim();
	const argumentList = signature.substring(parStart + 1, parEnd).replace(/[\[\]]/g, '').split(',');
	return argumentList.map((argStr) => {
		return new vscode.ParameterInformation(argStr.trim());
	});
}

function parseSignatureInEditing(line: string, position: number) {
	let substr = line.substring(0, position);

	// flatten paired parentheses:
	// from "parentfunc(sonfunc(a, b, c), daughterFunc(d, e"
	// to   "parentfunc(sonfunc_________, daughterFunc(d, e"
	while (1) {
		const newstr = substr.replace(/\([^()]*\)/g, (substr: string) => {
			return '_'.repeat(substr.length);
		});
		if (newstr === substr) {
			substr = newstr;
			break;
		}
		substr = newstr;
	}

	// find an incomplete function call.
	// If the function calls are nested, get the latter (i.e., nested) one.
	// currently I can not do in one-line regular expression.
	let match = substr.match(/^(.*?)([a-zA-Z_][a-zA-Z0-9_]*)\(/);
	if (match === null) {
		return undefined;
	} else {
		substr = substr.substring(match[0].length);
		let match2;
		while ((match2 = substr.match(/^(.*?)([a-zA-Z_][a-zA-Z0-9_]*)\(/)) !== null) {
			match = match2;
			substr = substr.substring(match[0].length);
		}
	}

	return { 'signature': match[2], 'argumentIndex': substr.split(',').length - 1 };
}

/**
 * provider
 */
export class SpecProvider implements vscode.CompletionItemProvider, vscode.HoverProvider, vscode.SignatureHelpProvider, vscode.DefinitionProvider {

	// vscode.Uri objects can not be used as a key for a Map object because 
	// these objects having the same string representation can be recognize to be different,
	// i.e., uriA.toString() === uriB.toString() but uriA !== uriB.
	// This is mainly caused by the difference in their minor properties, such as fsPath
	// (File System Path). Instead the string representation of a Uri object is used as a key.
	protected storageCollection: Map<string, ReferenceStorage> = new Map();
	protected completionItemCollection: Map<string, vscode.CompletionItem[]> = new Map();

	/**
	 * generate completion items from the registered storage and cache it in the map using `uri` as the key.
	 */
	protected updateCompletionItemsForUriString(uriString: string) {
		const refStorage = this.storageCollection.get(uriString);
		if (refStorage) {
			const completionItems: vscode.CompletionItem[] = [];
			for (const [refItemKind, refMap] of refStorage.entries()) {
				const completionItemKind = convertReferenceItemKindToCompletionItemKind(refItemKind);
				for (const [identifier, refItem] of refMap.entries()) {
					const completionItem = new vscode.CompletionItem(identifier, completionItemKind);
					// embed `uriString` into `detail` property in order to resolve it later efficiently.
					completionItem.detail = uriString;
					if (refItem.snippet) {
						completionItem.insertText = new vscode.SnippetString(refItem.snippet);
					}
					completionItems.push(completionItem);
				}
			}
			this.completionItemCollection.set(uriString, completionItems);
		} else {
			this.completionItemCollection.delete(uriString);
		}
	}

	/**
	 * required implementation of vscode.CompletionItemProvider
	 */
	public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.CompletionItem[] | undefined {
		const range = document.getWordRangeAtPosition(position);

		if (range) {
			const selectorName = document.getText(range);
			if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(selectorName)) {
				const aggregatedCompletionItems: vscode.CompletionItem[] = [];
				for (const [uriString, completionItems] of this.completionItemCollection.entries()) {
					aggregatedCompletionItems.push(...completionItems);
				}
				return aggregatedCompletionItems;
			}
		}
	}

	/**
	 * optional implementation of vscode.CompletionItemProvider
	 */
	public resolveCompletionItem(completionItem: vscode.CompletionItem, token: vscode.CancellationToken): vscode.CompletionItem | undefined {
		const refItemKind = convertCompletionItemKindToReferenceItemKind(completionItem.kind);

		// The URI is stored in `detail` property in unresolved completion item.
		const refUriString = completionItem.detail;
		let refStorage;
		if (refUriString && (refStorage = this.storageCollection.get(refUriString)) !== undefined) {
			const activeEditor = vscode.window.activeTextEditor;
			const documentUriString = (activeEditor) ? activeEditor.document.uri.toString() : '';
			let refMap = refStorage.get(refItemKind);
			if (refMap) {
				// find the symbol information about the symbol.
				const refItem = refMap.get(completionItem.label);
				if (refItem) {
					// copy completion item.
					const newCompletionItem = Object.assign({}, completionItem);

					// set the detail of the completion item
					newCompletionItem.detail = <string>getShortDescription(refItem, refItemKind, refUriString, documentUriString, false);

					// set the description of the completion item
					// if the main description exists, append it.
					let descriptionMarkdown =
						refItem.description ?
							new vscode.MarkdownString(truncateText(refItem.description, 'completionItem')) :
							new vscode.MarkdownString();

					// if overloaded signature exists, append them.
					if (refItem.overloads) {
						for (const overload of refItem.overloads) {
							// descriptionMarkdown.appendMarkdown('---');
							descriptionMarkdown.appendCodeblock(overload.signature);
							if (overload.description) {
								descriptionMarkdown.appendMarkdown(truncateText(overload.description, 'completionItem'));
								// descriptionMarkdown.appendMarkdown('\n\n');
							}
						}
					}
					// 
					newCompletionItem.documentation = descriptionMarkdown;
					return newCompletionItem;
				}
			}
		}
	}

	/**
	 * required implementation of vscode.HoverProvider
	 */
	public provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.Hover | undefined {
		const range = document.getWordRangeAtPosition(position);
		if (range) {
			const selectorName = document.getText(range);
			if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(selectorName)) {
				// start to seek if the selection is a proper identifier.
				let hover: vscode.Hover | undefined;

				for (const [refUriString, refStorage] of this.storageCollection.entries()) {
					for (const [refItemKind, refMap] of refStorage.entries()) {
						// find the symbol information about the symbol.
						const refItem = refMap.get(selectorName);
						if (refItem) {
							let mainMarkdown = <vscode.MarkdownString>getShortDescription(refItem, refItemKind, refUriString, document.uri.toString(), true);

							// prepare the second line: the description (if it exists)
							if (refItem.description) {
								mainMarkdown = mainMarkdown.appendMarkdown(truncateText(refItem.description, 'hover'));
							}

							if (!hover) {
								hover = new vscode.Hover(mainMarkdown);
							} else {
								hover.contents.push(mainMarkdown);
							}

							// for overloaded functions, prepare additional markdown blocks
							if (refItem.overloads) {
								for (const overload of refItem.overloads) {
									let overloadMarkdown = new vscode.MarkdownString().appendCodeblock(overload.signature);
									if (overload.description) {
										overloadMarkdown = overloadMarkdown.appendMarkdown(truncateText(overload.description, 'hover'));
									}
									hover.contents.push(overloadMarkdown);
								}
							}
							// return hover;
						}
					}
				}
				return hover;
			}
		}
	}

	/**
	 * required implementation of vscode.SignatureHelpProvider
	 */
	public provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.SignatureHelpContext): vscode.SignatureHelp | undefined {
		const signatureHint = parseSignatureInEditing(document.lineAt(position.line).text, position.character);
		if (signatureHint) {

			for (const [uriString, refStorage] of this.storageCollection.entries()) {
				let refMap = refStorage.get(ReferenceItemKind.Function);
				let refItem;
				if (refMap && (refItem = refMap.get(signatureHint.signature)) !== undefined) {
					const overloads = (refItem.overloads) ? refItem.overloads : [{ signature: refItem.signature, description: refItem.description }];
					const signatureHelp = new vscode.SignatureHelp();

					for (const overload of overloads) {
						// assume that usage.signature must exist.
						let signatureInformation = new vscode.SignatureInformation(overload.signature);
						if (overload.description) {
							signatureInformation.documentation = new vscode.MarkdownString(truncateText(overload.description, 'signatureHelp'));
						}
						let parameters;
						if ((parameters = getParameterInformation(overload.signature)) !== undefined) {
							signatureInformation.parameters = parameters;
						}
						signatureHelp.signatures.push(signatureInformation);
					}

					signatureHelp.activeParameter = signatureHint.argumentIndex;

					if ((context.activeSignatureHelp !== undefined) && (context.activeSignatureHelp.signatures[0].label === signatureHelp.signatures[0].label)) {
						signatureHelp.activeSignature = context.activeSignatureHelp.activeSignature;
					} else {
						signatureHelp.activeSignature = 0;
					}

					if (signatureHelp.activeSignature >= signatureHelp.signatures.length) {
						signatureHelp.activeSignature = signatureHelp.signatures.length;
					}
					return signatureHelp;
				}
			}
		}
	}

	/**
	 * required implementation of vscode.DefinitionProvider
	 */
	provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Definition | vscode.DefinitionLink[]> {
		const range = document.getWordRangeAtPosition(position);
		if (range) {
			const selectorName = document.getText(range);
			if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(selectorName)) {
				// start to seek if the selection is a proper identifier.
				const locations: vscode.Location[] = [];

				// sequentially seek the identifier through all storage aggregates
				for (const [uriString, refStorage] of this.storageCollection.entries()) {
					// skip the storage that does not have physical locations.
					// unnecessary because the owner of these storage is not registered as the definition provider.
					if (uriString === BUILTIN_URI || uriString === MOTOR_URI) {
						continue;
					}

					// seek through storages for all types of symbols
					for (const refMap of refStorage.values()) {
						const refItem = refMap.get(selectorName);
						if (refItem && refItem.location) {
							locations.push(new vscode.Location(vscode.Uri.parse(uriString), convertRange(refItem.location)));
						}
					}
				}

				if (locations.length > 0) {
					return locations;
				}
			}
		}
	}
}
