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

export class SpecBuiltinProvider implements vscode.HoverProvider {
	variableReference: Map<string, ReferenceItem> = new Map();
	macroReference: Map<string, ReferenceItem> = new Map();
	functionReference: Map<string, ReferenceItem> = new Map();
	keywordReference: Map<string, ReferenceItem> = new Map();
	
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
		});
	}

	public provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.Hover | undefined {
		const range = document.getWordRangeAtPosition(position);
		if (range !== undefined) {
			const selectorName = document.getText(range);
			let hover: vscode.Hover | undefined;
			let item: any;
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