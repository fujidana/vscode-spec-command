import * as vscode from 'vscode';
import * as spec from './spec';


function getShortDescription(item: spec.ReferenceItem, itemKind: spec.ReferenceItemKind, itemUriString: string, documentUriString: string, outputsMarkdown: boolean) {
	let symbolLabel: string;
	let relativePath: string | undefined;

	symbolLabel = spec.getStringFromReferenceItemKind(itemKind);

	if (itemUriString === spec.BUILTIN_URI) {
		symbolLabel = 'built-in ' + symbolLabel;
	} else if (itemUriString === spec.MOTOR_URI) {
		symbolLabel = 'user-configured ' + symbolLabel;
	} else if (itemUriString === documentUriString) {
		symbolLabel = symbolLabel + ' defined in this file';
	} else {
		relativePath = vscode.workspace.asRelativePath(vscode.Uri.parse(itemUriString));
		symbolLabel = outputsMarkdown ? 'user-defined ' + symbolLabel : symbolLabel + ' defined in ' + relativePath;
	}

	let mainText = `${item.signature} # ${symbolLabel}`;
	if (item.overloads && item.overloads.length > 1) {
		mainText += `, ${item.overloads.length} overloads`;
	}

	if (outputsMarkdown) {
		let markdownString = new vscode.MarkdownString().appendCodeblock(mainText);
		if (relativePath) {
			markdownString = markdownString.appendMarkdown(`_defined in_ [${relativePath}](${itemUriString}).\n\n`);
		}
		return markdownString;
	} else {
		return mainText;
	}
}

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
	return argumentList.map(argStr => new vscode.ParameterInformation(argStr.trim()));
}

function parseSignatureInEditing(line: string, position: number) {
	let substr = line.substring(0, position);

	// flatten paired parentheses:
	// from "parentfunc(sonfunc(a, b, c), daughterFunc(d, e"
	// to   "parentfunc(sonfunc_________, daughterFunc(d, e"
	while (1) {
		const newstr = substr.replace(/\([^()]*\)/g, substr => '_'.repeat(substr.length));
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
export class Provider implements vscode.CompletionItemProvider, vscode.HoverProvider, vscode.SignatureHelpProvider, vscode.DefinitionProvider {

	// vscode.Uri objects can not be used as a key for a Map object because these 
	// objects having the same string representation can be recognized different,
	// i.e., uriA.toString() === uriB.toString() but uriA !== uriB.
	// This is mainly caused by the difference in their minor properties, such as fsPath
	// (File System Path). To avoid this problem, the string representation of a Uri 
	// object is used as a key.

	protected storageCollection: Map<string, spec.ReferenceStorage> = new Map();
	protected completionItemCollection: Map<string, vscode.CompletionItem[]> = new Map();

	/**
	 * generate completion items from the registered storage and cache it in the map using `uri` as the key.
	 * subclass must invoke it when the storage contents are changed. 
	 */
	protected updateCompletionItemsForUriString(uriString: string) {
		const storage = this.storageCollection.get(uriString);
		if (storage) {
			const completionItems: vscode.CompletionItem[] = [];
			for (const [itemKind, map] of storage.entries()) {
				const completionItemKind = spec.getCompletionItemKindFromReferenceItemKind(itemKind);
				for (const [identifier, item] of map.entries()) {
					const completionItem = new vscode.CompletionItem(identifier, completionItemKind);
					// embed `uriString` into `detail` property in order to resolve it later efficiently.
					completionItem.detail = uriString;
					if (item.snippet) {
						completionItem.insertText = new vscode.SnippetString(item.snippet);
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
		const itemKind = spec.getReferenceItemKindFromCompletionItemKind(completionItem.kind);

		// The URI is stored in `detail` property in unresolved completion item.
		const refUriString = completionItem.detail;
		let storage;
		if (refUriString && (storage = this.storageCollection.get(refUriString)) !== undefined) {
			const activeEditor = vscode.window.activeTextEditor;
			const documentUriString = (activeEditor) ? activeEditor.document.uri.toString() : '';
			let map = storage.get(itemKind);
			if (map) {
				// find the symbol information about the symbol.
				const item = map.get(completionItem.label);
				if (item) {
					// copy completion item.
					const newCompletionItem = Object.assign({}, completionItem);

					// set the detail of the completion item
					newCompletionItem.detail = <string>getShortDescription(item, itemKind, refUriString, documentUriString, false);

					// set the description of the completion item
					// if the main description exists, append it.
					let descriptionMarkdown =
						item.description ?
							new vscode.MarkdownString(truncateText(item.description, 'completionItem')) :
							new vscode.MarkdownString();

					// if overloaded signature exists, append them.
					if (item.overloads) {
						for (const overload of item.overloads) {
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

				for (const [refUriString, storage] of this.storageCollection.entries()) {
					for (const [itemKind, map] of storage.entries()) {
						// find the symbol information about the symbol.
						const item = map.get(selectorName);
						if (item) {
							let mainMarkdown = <vscode.MarkdownString>getShortDescription(item, itemKind, refUriString, document.uri.toString(), true);

							// prepare the second line: the description (if it exists)
							if (item.description) {
								mainMarkdown = mainMarkdown.appendMarkdown(truncateText(item.description, 'hover'));
							}

							if (!hover) {
								hover = new vscode.Hover(mainMarkdown);
							} else {
								hover.contents.push(mainMarkdown);
							}

							// for overloaded functions, prepare additional markdown blocks
							if (item.overloads) {
								for (const overload of item.overloads) {
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

			for (const [uriString, storage] of this.storageCollection.entries()) {
				let map = storage.get(spec.ReferenceItemKind.Function);
				let item;
				if (map && (item = map.get(signatureHint.signature)) !== undefined) {
					const overloads = (item.overloads) ? item.overloads : [{ signature: item.signature, description: item.description }];
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
				for (const [uriString, storage] of this.storageCollection.entries()) {
					// skip the storage that does not have physical locations.
					// unnecessary because the owner of these storage is not registered as the definition provider.
					if (uriString === spec.BUILTIN_URI || uriString === spec.MOTOR_URI) {
						continue;
					}

					// seek through storages for all types of symbols
					for (const map of storage.values()) {
						const item = map.get(selectorName);
						if (item && item.location) {
							locations.push(new vscode.Location(vscode.Uri.parse(uriString), spec.convertRange(item.location)));
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
