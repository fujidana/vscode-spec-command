import { SpecProvider } from "./specProvider";
import * as vscode from 'vscode';
import * as fs from 'fs';

interface MotorMacro {
	label: string;
	minMotors: number;
	snippetTemplate: string;
	description: string;
}

const MOTOR_MACROS: MotorMacro[] = [
	{ label: 'mv',     minMotors: 1, snippetTemplate: 'mv ${1|%s|} ${2:pos}', description: 'absolute-position motor move' },
	{ label: 'mvr',    minMotors: 1, snippetTemplate: 'mvr ${1|%s|} ${2:pos}', description: 'relative-position motor move' },
	{ label: 'ascan',  minMotors: 1, snippetTemplate: 'ascan ${1|%s|} ${2:begin} ${3:end} ${4:steps} ${5:time}', description: 'single-motor absolute-position scan' },
	{ label: 'dscan',  minMotors: 1, snippetTemplate: 'dscan ${1|%s|} ${2:begin} ${3:end} ${4:steps} ${5:time}', description: 'single-motor relative-position scan' },
	{ label: 'a2scan', minMotors: 2, snippetTemplate: 'a2scan ${1|%s|} ${2:begin1} ${3:end1} ${4|%s|} ${5:begin2} ${6:end2} ${7:steps} ${8:time}', description: 'two-motor absolute-position scan' },
	{ label: 'd2scan', minMotors: 2, snippetTemplate: 'd2scan ${1|%s|} ${2:begin1} ${3:end1} ${4|%s|} ${5:begin2} ${6:end2} ${7:steps} ${8:time}', description: 'two-motor relative-position scan' },
	{ label: 'mesh',   minMotors: 2, snippetTemplate: 'mesh ${1|%s|} ${2:begin1} ${3:end1} ${4:time1} ${5|%s|} ${6:begin2} ${7:end2} ${8:steps2} ${9:time}', description: 'nested two-motor scan that scanned over a grid of points' },
	{ label: 'a3scan', minMotors: 3, snippetTemplate: 'a3scan ${1|%s|} ${2:begin1} ${3:end1} ${4|%s|} ${5:begin2} ${6:end2} ${7|%s|} ${8:begin3} ${9:end3} ${10:steps} ${11:time}', description: 'three-motor absolute-position scan' },
	{ label: 'd3scan', minMotors: 3, snippetTemplate: 'd3scan ${1|%s|} ${2:begin1} ${3:end1} ${4|%s|} ${5:begin2} ${6:end2} ${7|%s|} ${8:begin3} ${9:end3} ${10:steps} ${11:time}', description: 'three-motor relative-position scan' }
];

export class SpecBuiltinProvider extends SpecProvider {
	mnemonicCompletionItems: vscode.CompletionItem[] = [];

	constructor(apiReferencePath: string) {
		super();

		this.updateMnemonicCompletionItems();

		vscode.workspace.onDidChangeConfiguration((event) => {
			this.updateMnemonicCompletionItems();
		});

		fs.readFile(apiReferencePath, 'utf-8', (err: any, data: string) => {
			if (err !== null) {
				throw err;
			}
			const jsonObject = JSON.parse(data);
			this.variableReference = new Map(Object.entries(jsonObject.variables));
			this.macroReference = new Map(Object.entries(jsonObject.macros));
			this.functionReference = new Map(Object.entries(jsonObject.functions));
			this.keywordReference = new Map(Object.entries(jsonObject.keywords));

			this.updateCompletionItems();
		});
	}

	public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.CompletionItem[] | undefined {
		const items = super.provideCompletionItems(document, position, token, context);
		if (items) {
			return items.concat(this.mnemonicCompletionItems);
		} else {
			return this.mnemonicCompletionItems;
		}
	}

	public provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.Hover | undefined {
		const hover = super.provideHover(document, position, token);
		if (hover) {
			return hover;
		}

		const range = document.getWordRangeAtPosition(position);
		if (range !== undefined) {
			const motorConfig = vscode.workspace.getConfiguration('spec.mnemonics.motor');
			const mneLabels: string[] = motorConfig.get('labels', []);
			const mneDescriptions: string[] = motorConfig.get('descriptions', []);
			if (mneLabels.length > 0) {
				const selectorName = document.getText(range);

				// check if the selectext is found in moter mnemonics array
				const index = mneLabels.indexOf(selectorName);
				if (index >= 0) {
					const mneDescription = (mneDescriptions.length > index) ? mneDescriptions[index] : undefined;
					const markdownString = new vscode.MarkdownString();
					markdownString.appendCodeblock(selectorName + ' # motor mnemonics');
					if (mneDescription) {
						markdownString.appendMarkdown(mneDescription);
					}
					return new vscode.Hover(markdownString);
				}

				// check if the selectext is found in motor-macro array
				const motorMacros = MOTOR_MACROS.filter((motorMacro) => motorMacro.label === selectorName);
				if (motorMacros.length > 0) {
					const motorMacro = motorMacros[0];
					const markdownString = new vscode.MarkdownString();
					markdownString.appendCodeblock(convertSnippetExample(motorMacro.snippetTemplate, mneLabels[0]) + ' # common macro');
					markdownString.appendMarkdown(motorMacro.description);
					return new vscode.Hover(markdownString);
				}
			}
		}
	}

	private updateMnemonicCompletionItems() {
		const motorConfig = vscode.workspace.getConfiguration('spec.mnemonics.motor');
		const mneLabels: string[] = motorConfig.get('labels', []);
		const mneDescriptions: string[] = motorConfig.get('descriptions', []);

		if (mneLabels.length > 0) {
			const completionItems: vscode.CompletionItem[] = [];
			let commpaSeparatedList = "";
			for (let index = 0; index < mneLabels.length; index++) {
				const mneLabel = mneLabels[index];
				const mneDescription = (mneDescriptions.length > index) ? mneDescriptions[index] : undefined;
				const item = new vscode.CompletionItem(mneLabel, vscode.CompletionItemKind.EnumMember);
				item.detail = '(motor mnemonic name) ' + mneLabel;
				item.documentation = mneDescription;
				completionItems.push(item);

				commpaSeparatedList += mneLabel + ',';
			}

			commpaSeparatedList = commpaSeparatedList.substring(0, commpaSeparatedList.length - 1);
			const motorMacros = MOTOR_MACROS.filter((object): boolean =>  mneLabels.length >= object.minMotors);
			
			for (const motorMacro of motorMacros) {
				const item = new vscode.CompletionItem(motorMacro.label, vscode.CompletionItemKind.Snippet);
				const snippetCode = motorMacro.snippetTemplate.replace(/%s/g, commpaSeparatedList);
				item.insertText = new vscode.SnippetString(snippetCode);
				item.detail = `${motorMacro.description} (spec Language Support, dynamic)`;
				item.documentation = new vscode.MarkdownString().appendCodeblock(convertSnippetExample(motorMacro.snippetTemplate, mneLabels[0]));
				completionItems.push(item);
			}

			this.mnemonicCompletionItems = completionItems;
		}
	}
}

function convertSnippetExample(snippetTemplete: string, mne: string): string {
	return snippetTemplete.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\{\d+\|%s\|\}/g, mne);
}