import * as vscode from 'vscode';

export enum SymbolAffiliation {
	Builtin,
	Document,
	Workspace,
	Settings
}

// 'overloads' parameter is for built-in macros and functions.
export interface SymbolInformation {
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


/**
 * Symbol Storage: this instance stores symbol information of a specified type, such as variables or functions.
 */
export class SymbolStorage extends Map<string, SymbolInformation> {
	constructor(
		entries: Iterable<readonly [string, SymbolInformation]> | readonly (readonly [string, SymbolInformation])[],
		public affiliation: SymbolAffiliation,
		public itemKind: vscode.CompletionItemKind,
		public uri?: vscode.Uri) {
		super(entries);
	}

	/**
	 * findHover
	 */
	public findHover(selector: string): vscode.Hover | undefined {
		const symbolInfo = this.get(selector);
		if (symbolInfo) { // if the specified symbol is found
			// prepare the first line: the signature and short description.
			let mainText = symbolInfo.signature + ` # ${this.getShortDescription()}`;
			if (symbolInfo.overloads && symbolInfo.overloads.length > 1) {
				mainText += `, ${symbolInfo.overloads.length} overloads`;
			}
			let mainMarkdown = new vscode.MarkdownString().appendCodeblock(mainText);

			// prepare the second line: the description (if it exists)
			if (symbolInfo.description) {
				mainMarkdown = mainMarkdown.appendMarkdown(truncateText(symbolInfo.description, 'hover'));
			}
			const hover = new vscode.Hover(mainMarkdown);

			// for overloaded functions, prepare additional markdown blocks
			if (symbolInfo.overloads) {
				for (const overload of symbolInfo.overloads) {
					let overloadMarkdown = new vscode.MarkdownString().appendCodeblock(overload.signature);
					if (overload.description) {
						overloadMarkdown = overloadMarkdown.appendMarkdown(truncateText(overload.description, 'hover'));
					}
					hover.contents.push(overloadMarkdown);
				}
			}
			return hover;
		}
	}

	/**
	 * getUnresolvedCompletionItems
	 */
	public getUnresolvedCompletionItems() {
		const items: vscode.CompletionItem[] = [];
		for (const [key, symbolInfo] of this.entries()) {
			const item = new vscode.CompletionItem(key, this.itemKind);
			if (symbolInfo.snippet) {
				item.insertText = new vscode.SnippetString(symbolInfo.snippet);
			}
			items.push(item);
		}
		return items;
	}

	/**
	 * resolveCompletionItem
	 */
	public resolveCompletionItem(item: vscode.CompletionItem) {
		// find the symbol information about the symbol.
		const symbolInfo = this.get(item.label);
		if (symbolInfo) {
			// copy completion item.
			const newItem = Object.assign({}, item);

			// set the detail of the completion item
			newItem.detail = `(${this.getShortDescription()}) ${symbolInfo.signature}`;
			if (symbolInfo.overloads && symbolInfo.overloads.length > 1) {
				newItem.detail += `, ${symbolInfo.overloads.length} overloads`;
			}

			// set the description of the completion item
			// if the main description exists, append it.
			let descriptionMarkdown =
				symbolInfo.description ?
					new vscode.MarkdownString(truncateText(symbolInfo.description, 'completionItem')) :
					new vscode.MarkdownString();

			// if overloaded, append overload information.
			if (symbolInfo.overloads) {
				for (const overload of symbolInfo.overloads) {
					// descriptionMarkdown.appendMarkdown('---');
					descriptionMarkdown.appendCodeblock(overload.signature);
					if (overload.description) {
						descriptionMarkdown.appendMarkdown(truncateText(overload.description, 'completionItem'));
						// descriptionMarkdown.appendMarkdown('\n\n');
					}
				}
			}

			// 
			newItem.documentation = descriptionMarkdown;
			return newItem;
		}
	}

	public getSignatureHelp(signatureHint: { signature: string, argumentIndex: number }, activeSignatureHelp?: vscode.SignatureHelp) {
		const symbolInfo = this.get(signatureHint.signature);
		if (symbolInfo) {
			let overloads: Overload[];
			if (symbolInfo.overloads) {
				overloads = symbolInfo.overloads;
			} else {
				overloads = [{ signature: symbolInfo.signature, description: symbolInfo.description }];
			}
			const signatureHelp = new vscode.SignatureHelp();

			for (const overload of overloads) {
				// assume that usage.signature must exist.
				let signatureInformation = new vscode.SignatureInformation(overload.signature);
				if (overload.description !== undefined) {
					signatureInformation.documentation = new vscode.MarkdownString(truncateText(overload.description, 'signatureHelp'));
				}
				let parameters;
				if ((parameters = getParameterInformation(overload.signature)) !== undefined) {
					signatureInformation.parameters = parameters;
				}
				signatureHelp.signatures.push(signatureInformation);
			}
	
			signatureHelp.activeParameter = signatureHint.argumentIndex;
	
			// if ((activeSignatureHelp !== undefined) && (activeSignatureHelp.signatures === signatureHelp.signatures)) {
			if ((activeSignatureHelp !== undefined) && (activeSignatureHelp.signatures[0].label === signatureHelp.signatures[0].label)) {
				signatureHelp.activeSignature = activeSignatureHelp.activeSignature;
			} else {
				signatureHelp.activeSignature = 0;
			}
	
			if (signatureHelp.activeSignature >= signatureHelp.signatures.length) {
				signatureHelp.activeSignature = signatureHelp.signatures.length;
			}
			return signatureHelp;
		}
	}
	
	/**
	 * findLocation
	 */
	public findLocation(selector: string): vscode.Location | undefined{
		const symbolInfo = this.get(selector);
		if (symbolInfo) { // if the specified symbol is found
			if (this.uri && symbolInfo.location) {
				return new vscode.Location(this.uri, convertRange(symbolInfo.location));
			}
		}
	}

	/**
	 * getSymbolInformation
	 */
	public getSymbolInformation() {
		const symbols = [];
		for (const [key, value] of this.entries()) {
			let kind;
			if (this.uri && value.location) {
				switch (this.itemKind) {
					case vscode.CompletionItemKind.Method:
						kind = vscode.SymbolKind.Method; break;
					case vscode.CompletionItemKind.Function:
						kind = vscode.SymbolKind.Function; break;
					default:
						kind = vscode.SymbolKind.Null;
				}
				const location = new vscode.Location(this.uri, convertRange(value.location));
				symbols.push(new vscode.SymbolInformation(key, kind, '', location));
				// symbols.push(new vscode.DocumentSymbol(key, '', kind, convertRange(value.location), convertRange(value.location)));
			}
		}
		return symbols;
	}

	private getShortDescription() {
		let symbolLabel: string;
		switch (this.itemKind) {
			case vscode.CompletionItemKind.Variable:
				symbolLabel = "variable"; break;
			case vscode.CompletionItemKind.Constant:
				symbolLabel = "constant"; break;
			case vscode.CompletionItemKind.Method:
				symbolLabel = "function"; break;
			case vscode.CompletionItemKind.Function:
				symbolLabel = "macro"; break;
			case vscode.CompletionItemKind.Keyword:
				symbolLabel = "keyword"; break;
			case vscode.CompletionItemKind.EnumMember:
				symbolLabel = "member"; break;
			case vscode.CompletionItemKind.Snippet:
				symbolLabel = "snippet"; break;
			default:
				symbolLabel = "symbol"; break;
		}
		if (this.affiliation === SymbolAffiliation.Builtin) {
			return 'built-in ' + symbolLabel;
		} else if (this.affiliation === SymbolAffiliation.Settings) {
			return 'spec language support, dynamic ' + symbolLabel;
		} else {
			return symbolLabel;
		}
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
		const endIndex = text.indexOf('.');
		return (endIndex >= 0 && endIndex !== text.length - 1) ? text.substr(0, endIndex) + '. ...' : text;
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
 * abstract provider
 */
export class SpecProvider implements vscode.CompletionItemProvider, vscode.HoverProvider, vscode.SignatureHelpProvider, vscode.DefinitionProvider, vscode.DocumentSymbolProvider {
	protected symbolStorages: SymbolStorage[] = [];
	protected completionItems: vscode.CompletionItem[] = [];

	/**
	 * generate completion item cache from all symbols in all storages.
	 */
	protected updateCompletionItems() {
		const items: vscode.CompletionItem[] = [];
		for (const symbolStorage of this.symbolStorages) {
			items.push(...symbolStorage.getUnresolvedCompletionItems());
		}
		this.completionItems = items;
	}

	/**
	 * filter
	 */
	protected getFilteredSymbolStoragesByItemKind(itemKind: vscode.CompletionItemKind) {
		return this.symbolStorages.filter((storage) => storage.itemKind === itemKind);
	}

	/**
	 * required implementation of vscode.CompletionItemProvider
	 */
	public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.CompletionItem[] | undefined {
		const range = document.getWordRangeAtPosition(position);
		if (range) {
			const selectorName = document.getText(range);
			if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(selectorName)) {
				return this.completionItems;
			}
		}
	}

	/**
	 * optional implementation of vscode.CompletionItemProvider
	 */
	public resolveCompletionItem(item: vscode.CompletionItem, token: vscode.CancellationToken): vscode.CompletionItem | undefined {
		const symbolStorages = this.symbolStorages.filter((symbolStorage) => symbolStorage.itemKind === item.kind);
		if (symbolStorages.length > 0) {
			return symbolStorages[0].resolveCompletionItem(item);
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
				for (const SymbolStorage of this.symbolStorages) {
					let hover = SymbolStorage.findHover(selectorName);
					if (hover) {
						return hover;
					}
				}
			}
		}
	}

	/**
	 * required implementation of vscode.SignatureHelpProvider
	 */
	public provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.SignatureHelpContext): vscode.SignatureHelp | undefined {
		const signatureHint = parseSignatureInEditing(document.lineAt(position.line).text, position.character);
		if (signatureHint !== undefined) {
			const symbolStorages = this.symbolStorages.filter((symbolStorage) => symbolStorage.itemKind === vscode.CompletionItemKind.Method);
			for (const symbolStorage of symbolStorages) {
				if (symbolStorage.has(signatureHint.signature)) {
					return symbolStorage.getSignatureHelp(signatureHint, context.activeSignatureHelp);
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
				const locations: vscode.Location[] = [];
                for (const storage of this.symbolStorages) {
					const location = storage.findLocation(selectorName);
					if (location) {
						locations.push(location);
					}
				}
				if (locations.length > 0) {
					return locations;
				}
			}
        }
	}
	
	/**
	 * required implementation of vscode.DocumentSymbolProvider
	 */
	provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.SymbolInformation[] | vscode.DocumentSymbol[]>
	{
		const filteredStorages = this.symbolStorages.filter((storage) => storage.uri === document.uri);
		const symbols = [];
		for (const storage of filteredStorages) {
			symbols.push(...storage.getSymbolInformation());
		}
		return symbols;
	}
}
