import * as vscode from 'vscode';

interface ReferenceItem {
	signature: string;
	description?: string;
	overloads?: Overload[];
}

interface Overload {
	signature: string;
	description?: string;
}

function truncateDocument(rawDocument: string, settingKey: string): string {
	const volume = vscode.workspace.getConfiguration('spec.helpDocumentVolume').get(settingKey);
	if (volume === 'full') {
		return rawDocument;
	} else if (volume === 'paragraph') {
		const endIndex = rawDocument.indexOf('\n\n');
		return (endIndex >= 0) ? rawDocument.substr(0, endIndex) + '\n\n...' : rawDocument;
	} else if (volume === 'sentence') {
		const endIndex = rawDocument.indexOf('.');
		return (endIndex >= 0) ? rawDocument.substr(0, endIndex) + '. ...' : rawDocument;
	} else {
		return '';
	}
}

function getUnresolvedCompletionItems(reference: Map<string, ReferenceItem>, kind: vscode.CompletionItemKind): vscode.CompletionItem[] {
	const cItems: vscode.CompletionItem[] = [];
	//  vscode.CompletionItem(identifier, kind);
	for (const key of reference.keys()) {
		cItems.push(new vscode.CompletionItem(key, kind));
	}
	return cItems;
}

function getResolvedCompletionItem(reference: Map<string, ReferenceItem>, cItem: vscode.CompletionItem, label: string): vscode.CompletionItem | undefined {
	const rItem = reference.get(cItem.label);
	if (rItem !== undefined) {
		const newCitem = Object.assign({}, cItem);
		newCitem.detail = `(${label}) ${rItem.signature}`;
		if (rItem.overloads !== undefined && rItem.overloads.length > 1) {
			newCitem.detail += `, ${rItem.overloads.length} overloads`;
		}
		let descriptionMarkdown = new vscode.MarkdownString();
		if (rItem.description !== undefined) {
			descriptionMarkdown = descriptionMarkdown.appendMarkdown(truncateDocument(rItem.description, 'completionItem'));
		}
		if (rItem.overloads !== undefined) {
			rItem.overloads.forEach((overload: Overload) => {
				// descriptionMarkdown.appendMarkdown('---');
				descriptionMarkdown.appendCodeblock(overload.signature);
				if (overload.description) {
					descriptionMarkdown.appendMarkdown(truncateDocument(overload.description, 'completionItem'));
					// descriptionMarkdown.appendMarkdown('\n\n');
				}
			});
		}
		newCitem.documentation = descriptionMarkdown;
		return newCitem;
	}
}

function getHover(reference: Map<string, ReferenceItem>, selectorName: string, label: string): vscode.Hover | undefined {
	const rItem = reference.get(selectorName);
	if (rItem !== undefined) {
		let mainMarkdown = new vscode.MarkdownString();
		let mainText = rItem.signature + ` # ${label}`;
		if (rItem.overloads !== undefined && rItem.overloads.length > 1) {
			mainText += `, ${rItem.overloads.length} overloads`;
		}
		mainMarkdown.appendCodeblock(mainText);
		if (rItem.description !== undefined) {
			mainMarkdown = mainMarkdown.appendMarkdown(truncateDocument(rItem.description, 'hover'));
		}

		const hover = new vscode.Hover(mainMarkdown);

		if (rItem.overloads !== undefined) {
			rItem.overloads.forEach((overload: Overload) => {
				let overloadMarkdown = new vscode.MarkdownString();
				overloadMarkdown = overloadMarkdown.appendCodeblock(overload.signature);
				if (overload.description) {
					overloadMarkdown = overloadMarkdown.appendMarkdown(truncateDocument(overload.description, 'hover'));
				}
				hover.contents.push(overloadMarkdown);
			});
		}
		return hover;
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

function getSignatureHelp(reference: Map<string, ReferenceItem>, signatureHint: { signature: string, argumentIndex: number }, activeSignatureHelp?: vscode.SignatureHelp): vscode.SignatureHelp | undefined {	
	const rItem = reference.get(signatureHint.signature);
	if (rItem !== undefined) {
		let overloads: Overload[];
		if (rItem.overloads === undefined) {
			overloads = [{signature: rItem.signature, description: rItem.description}];
		} else {
			overloads = rItem.overloads;
		}
		const signatureHelp = new vscode.SignatureHelp();

		overloads.forEach((overload) => {
			// assume that usage.signature must exist.
			let signatureInformation = new vscode.SignatureInformation(overload.signature);
			if (overload.description !== undefined) {
				signatureInformation.documentation = new vscode.MarkdownString(truncateDocument(overload.description, 'signatureHelp'));
			}
			let parameters;
			if ((parameters = getParameterInformation(overload.signature)) !== undefined) {
				signatureInformation.parameters = parameters;
			}
			signatureHelp.signatures.push(signatureInformation);
		});

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

export class SpecProvider implements vscode.CompletionItemProvider, vscode.HoverProvider, vscode.SignatureHelpProvider {
	protected variableReference: Map<string, ReferenceItem> = new Map();
	protected macroReference: Map<string, ReferenceItem> = new Map();
	protected functionReference: Map<string, ReferenceItem> = new Map();
	protected keywordReference: Map<string, ReferenceItem> = new Map();
	protected completionItems: vscode.CompletionItem[] = [];

	protected updateCompletionItems() {
		this.completionItems = this.completionItems.concat(
			getUnresolvedCompletionItems(this.variableReference, vscode.CompletionItemKind.Variable),
			getUnresolvedCompletionItems(this.macroReference, vscode.CompletionItemKind.Function),
			getUnresolvedCompletionItems(this.functionReference, vscode.CompletionItemKind.Function),
			getUnresolvedCompletionItems(this.keywordReference, vscode.CompletionItemKind.Keyword)
		);
	}

	public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.CompletionItem[] | undefined {
		const range = document.getWordRangeAtPosition(position);
		if (range !== undefined) {
			const selectorName = document.getText(range);
			if (/^[A-Za-z][[A-Za-z0-9_]*$/.test(selectorName)) {
				return this.completionItems;
			}
		}
	}

	public resolveCompletionItem(item: vscode.CompletionItem, token: vscode.CancellationToken): vscode.CompletionItem | undefined {
		if (item.kind === vscode.CompletionItemKind.Variable) {
			return getResolvedCompletionItem(this.variableReference, item, 'built-in variable');
		} else if (item.kind === vscode.CompletionItemKind.Keyword) {
			return getResolvedCompletionItem(this.keywordReference, item, 'keyword');
		} else if (item.kind === vscode.CompletionItemKind.Function) {
			let newItem: vscode.CompletionItem | undefined;
			if ((newItem = getResolvedCompletionItem(this.macroReference, item, 'built-in macro')) !== undefined) {
				return newItem;
			} else if ((newItem = getResolvedCompletionItem(this.functionReference, item, 'built-in function')) !== undefined) {
				return newItem;
			}
		}
	}

	public provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.Hover | undefined {
		const range = document.getWordRangeAtPosition(position);
		if (range !== undefined) {
			const selectorName = document.getText(range);
			let hover: vscode.Hover | undefined;

			if (/^[A-Z][[A-Z0-9_]*$/.test(selectorName)) { // all capitals, global variables
				return getHover(this.variableReference, selectorName, 'built-in variable');
			} else if (/^[A-Za-z][[A-Za-z0-9_]*$/.test(selectorName)) {
				if ((hover = getHover(this.macroReference, selectorName, 'built-in macro')) !== undefined) {
					return hover;
				} else if ((hover = getHover(this.functionReference, selectorName, 'built-in function')) !== undefined) {
					return hover;
				} else if ((hover = getHover(this.keywordReference, selectorName, 'keyword')) !== undefined) {
					return hover;
				}
			}
		}
	}

	public provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.SignatureHelpContext): vscode.SignatureHelp | undefined {
		const signatureHint = parseSignatureInEditing(document.lineAt(position.line).text, position.character);
		if (signatureHint !== undefined) {
			return getSignatureHelp(this.functionReference, signatureHint, context.activeSignatureHelp);
		}
	}
}

