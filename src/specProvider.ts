import * as vscode from 'vscode';
import * as fs from 'fs';

interface ReferenceItem {
	signature?: string;
	description?: string;
	usages: Usage[];
}

interface Usage {
	signature?: string;
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
		const usage = rItem.usages[0];
		const usageNum = rItem.usages.length;
		const newCitem = Object.assign({}, cItem);
		if (usageNum === 1) {
			newCitem.detail = `(${label}) ${(usage.signature) ? usage.signature : cItem.label}`;
		} else {
			newCitem.detail = `(${label}) ${(usage.signature) ? usage.signature : cItem.label} (+${usageNum - 1} overload${(usageNum > 2) ? 's' : ''})`;
		}
		let descriptionMarkdown = new vscode.MarkdownString();
		if (rItem.description) {
			descriptionMarkdown = descriptionMarkdown.appendMarkdown(truncateDocument(rItem.description, 'completionItem'));
		}

		if (usage.description) {
			newCitem.documentation = new vscode.MarkdownString(truncateDocument(usage.description, 'completionItem'));
		}
		return newCitem;
	}
}

function getHover(reference: Map<string, ReferenceItem>, selectorName: string, label: string): vscode.Hover | undefined {
	const rItem = reference.get(selectorName);
	if (rItem !== undefined) {
		let mainMarkdown = new vscode.MarkdownString();
		const usageNum = rItem.usages.length;
		if (usageNum === 1) {
			const usage = rItem.usages[0];
			mainMarkdown = mainMarkdown.appendCodeblock(`${usage.signature ? usage.signature : selectorName} # ${label}`);
		} else {
			mainMarkdown = mainMarkdown.appendCodeblock(`${rItem.signature ? rItem.signature : selectorName + '(...)'} # ${label}, ${usageNum} overloads`);
		}
		if (rItem.description) {
			mainMarkdown = mainMarkdown.appendMarkdown(truncateDocument(rItem.description, 'hover'));
		}
		const hover = new vscode.Hover(mainMarkdown);

		rItem.usages.forEach((usage: Usage) => {
			let usageMarkdown = new vscode.MarkdownString();
			if (rItem.usages.length !== 1) {
				usageMarkdown = usageMarkdown.appendCodeblock(usage.signature ? usage.signature : selectorName);
			} 
			if (usage.description) {
				usageMarkdown = usageMarkdown.appendMarkdown(truncateDocument(usage.description, 'hover'));
			}
			hover.contents.push(usageMarkdown);
		});
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

function getSignatureHelp(
	reference: Map<string, ReferenceItem>,
	signatureHint: { signature: string, argumentIndex: number },
	activeSignatureHelp?: vscode.SignatureHelp):
	vscode.SignatureHelp | undefined {
	
	const rItem = reference.get(signatureHint.signature);
	if (rItem !== undefined) {
		const signatureHelp = new vscode.SignatureHelp();

		rItem.usages.forEach((usage) => {
			// assume that usage.signature must exist.
			let signatureInformation;
			if (usage.signature) {
				signatureInformation = new vscode.SignatureInformation(usage.signature);
				let parameters;
				if ((parameters = getParameterInformation(usage.signature)) !== undefined) {
					signatureInformation.parameters = parameters;
				}
			} else {
				signatureInformation = new vscode.SignatureInformation(signatureHint.signature);
			}
			if (usage.description) {
				
				signatureInformation.documentation = new vscode.MarkdownString(truncateDocument(usage.description, 'signatureHelp'));
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

export class SpecBuiltinProvider implements vscode.CompletionItemProvider, vscode.HoverProvider, vscode.SignatureHelpProvider {
	private variableReference: Map<string, ReferenceItem> = new Map();
	private macroReference: Map<string, ReferenceItem> = new Map();
	private functionReference: Map<string, ReferenceItem> = new Map();
	private keywordReference: Map<string, ReferenceItem> = new Map();
	private completionItems: vscode.CompletionItem[] = [];

	constructor(apiReferencePath: string) {
		fs.readFile(apiReferencePath, 'utf-8', (err: any, data: string) => {
			if (err !== null) {
				throw err;
			}
			const jsonObject = JSON.parse(data);
			this.variableReference = new Map(Object.entries(jsonObject.variables));
			this.macroReference = new Map(Object.entries(jsonObject.macros));
			this.functionReference = new Map(Object.entries(jsonObject.functions));
			this.keywordReference = new Map(Object.entries(jsonObject.keywords));

			this.completionItems = this.completionItems.concat(
				getUnresolvedCompletionItems(this.variableReference, vscode.CompletionItemKind.Variable),
				getUnresolvedCompletionItems(this.macroReference, vscode.CompletionItemKind.Function),
				getUnresolvedCompletionItems(this.functionReference, vscode.CompletionItemKind.Function),
				getUnresolvedCompletionItems(this.keywordReference, vscode.CompletionItemKind.Keyword)
			);
		});
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
		console.log(context);
		if (signatureHint !== undefined) {
			return getSignatureHelp(this.functionReference, signatureHint, context.activeSignatureHelp);
		}
	}
}