import * as vscode from 'vscode';
import * as fs from 'fs';
import { join } from 'path';


interface ReferenceItem {
	usages: Usage[];
}

interface Usage {
	signature?: string;
	description?: string;
}

function getCompletionItems(reference:Map<string, ReferenceItem>, kind: vscode.CompletionItemKind): vscode.CompletionItem[] {
	const completionItems: vscode.CompletionItem[] = [];
	
	const cItems: vscode.CompletionItem[] = [];
	//  vscode.CompletionItem(identifier, kind);
	for (const key of reference.keys()) {

		cItems.push(new vscode.CompletionItem(key, kind));
	}
	return cItems;
}

function getResolvedCompletionItem(reference:Map<string, ReferenceItem>, cItem: vscode.CompletionItem, label: string): vscode.CompletionItem | undefined {
	const rItem = reference.get(cItem.label);
	if (rItem !== undefined) {
		const usage = rItem.usages[0];
		const usageNum = rItem.usages.length;
		const newCitem = Object.assign({}, cItem);
		if (usageNum === 1) {
			newCitem.detail = `(${label}) ${(usage.signature) ? usage.signature : cItem.label}`;
		} else {
			newCitem.detail = `(${label}) ${(usage.signature) ? usage.signature : cItem.label} (+${usageNum - 1} overload${(usageNum > 2)? 's': ''})`;
		}
		if (usage.description) {
			const search = usage.description.search('\n');
			newCitem.documentation = new vscode.MarkdownString((search >= 0) ? usage.description.substr(0, search) + ' ...': usage.description);
		}
		return newCitem;
	}
}

function getHover(reference:Map<string, ReferenceItem>, selectorName: string, label: string): vscode.Hover | undefined {
	const refItem = reference.get(selectorName);
	if (refItem !== undefined) {
		const hover = new vscode.Hover([]);
		
		refItem.usages.forEach((currentUsage: any) => {
			hover.contents.push(new vscode.MarkdownString(`**(${label})** \`${currentUsage.signature ? currentUsage.signature : selectorName}\``));
			if (currentUsage.description) {
				hover.contents.push(new vscode.MarkdownString(currentUsage.description));
			}
		});
		return hover;
	}
}

export class SpecBuiltinProvider implements vscode.HoverProvider, vscode.CompletionItemProvider {
	private variableReference: Map<string, ReferenceItem> = new Map();
	private macroReference: Map<string, ReferenceItem> = new Map();
	private functionReference: Map<string, ReferenceItem> = new Map();
	private keywordReference: Map<string, ReferenceItem> = new Map();
	
	completionItems: vscode.CompletionItem[] = [];

	constructor() {
		fs.readFile(join(__dirname, '../syntaxes/spec.apiReference.json'), 'utf-8', (err: any, data: string) => {
			if (err !== null) {
				throw err;
			}
			const jsonObject = JSON.parse(data);
			this.variableReference = new Map(Object.entries(jsonObject.variables));
			this.macroReference = new Map(Object.entries(jsonObject.macros));
			this.functionReference = new Map(Object.entries(jsonObject.functions));
			this.keywordReference = new Map(Object.entries(jsonObject.keywords));

			const referenceArray = [this.variableReference, this.macroReference, this.functionReference, this.keywordReference];

			this.completionItems = this.completionItems.concat(
				getCompletionItems(this.variableReference, vscode.CompletionItemKind.Variable),
				getCompletionItems(this.macroReference, vscode.CompletionItemKind.Function),
				getCompletionItems(this.functionReference, vscode.CompletionItemKind.Function),
				getCompletionItems(this.keywordReference, vscode.CompletionItemKind.Keyword)
            );
		});
	}

	public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.CompletionItem[] | undefined {
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
}