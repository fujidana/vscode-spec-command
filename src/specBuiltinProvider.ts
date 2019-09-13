import * as provider from "./specProvider";
import * as vscode from 'vscode';
import * as fs from 'fs';

interface APIReference {
	variables: any[];
	functions: any[];
	macros: any[];
	keywords: any[];
}

const SNIPPET_TEMPLATES: string[] = [
	'mv ${1|%s|} ${2:pos}',
	'mvr ${1|%s|} ${2:pos}',
	'ascan ${1|%s|} ${2:begin} ${3:end} ${4:steps} ${5:sec}',
	'dscan ${1|%s|} ${2:begin} ${3:end} ${4:steps} ${5:sec}',
	'a2scan ${1|%s|} ${2:begin1} ${3:end1} ${4|%s|} ${5:begin2} ${6:end2} ${7:steps} ${8:sec}',
	'd2scan ${1|%s|} ${2:begin1} ${3:end1} ${4|%s|} ${5:begin2} ${6:end2} ${7:steps} ${8:sec}',
	'mesh ${1|%s|} ${2:begin1} ${3:end1} ${4:step1} ${5|%s|} ${6:begin2} ${7:end2} ${8:steps2} ${9:sec}',
	'a3scan ${1|%s|} ${2:begin1} ${3:end1} ${4|%s|} ${5:begin2} ${6:end2} ${7|%s|} ${8:begin3} ${9:end3} ${10:steps} ${11:sec}',
	'd3scan ${1|%s|} ${2:begin1} ${3:end1} ${4|%s|} ${5:begin2} ${6:end2} ${7|%s|} ${8:begin3} ${9:end3} ${10:steps} ${11:sec}',
];

const SNIPPET_DESCRIPTIONS: string[] = [
	'absolute-position motor move',
	'relative-position motor move',
	'single-motor absolute-position scan',
	'single-motor relative-position scan',
	'two-motor absolute-position scan',
	'two-motor relative-position scan',
	'nested two-motor scan that scanned over a grid of points',
	'three-motor absolute-position scan',
	'three-motor relative-position scan',
];

export class SpecBuiltinProvider extends provider.SpecProvider {
	private mnemonicEnumRefMap = new provider.ReferenceMap();
	private mnemonicSnippetRefMap = new provider.ReferenceMap();

	constructor(apiReferencePath: string) {
		super();

		// register motor-mnemonic storage
		const motorStorage = new provider.ReferenceStorage();
		motorStorage.set(provider.ReferenceItemKind.Enum, this.mnemonicEnumRefMap);
		motorStorage.set(provider.ReferenceItemKind.Snippet, this.mnemonicSnippetRefMap);
		this.registeredStorages.set(provider.MOTOR_URI, motorStorage);

		// load the API reference file
		fs.readFile(apiReferencePath, 'utf-8', (err: any, data: string) => {
			if (err !== null) {
				throw err;
			}
			// convert JSON string to a javascript object.
			const apiReference: APIReference = JSON.parse(data);

			// store them in a ReferenceStorage object and register it.
			const builtinStorage = new provider.ReferenceStorage();
			builtinStorage.set(provider.ReferenceItemKind.Variable, new provider.ReferenceMap(Object.entries(apiReference.variables)));
			builtinStorage.set(provider.ReferenceItemKind.Macro, new provider.ReferenceMap(Object.entries(apiReference.macros)));
			builtinStorage.set(provider.ReferenceItemKind.Function, new provider.ReferenceMap(Object.entries(apiReference.functions)));
			builtinStorage.set(provider.ReferenceItemKind.Keyword, new provider.ReferenceMap(Object.entries(apiReference.keywords)));
			this.registeredStorages.set(provider.BUILTIN_URI, builtinStorage);

			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration('spec.mnemonics.motor')) {
					this.updateCompletionItems();
				}
			});

			this.updateCompletionItems();
		});
	}

	/**
	 * override the super class.
	 * Invoked when initialized and configuration is changed. 
	 * Update the contents of motor-mnemonic storage.
	 */
	protected updateCompletionItems() {
		const motorConfig = vscode.workspace.getConfiguration('spec.mnemonics.motor');
		const mneLabels: string[] = motorConfig.get('labels', []);
		const mneDescriptions: string[] = motorConfig.get('descriptions', []);

		// refresh storages related to motor mnemonic, which is configured in the settings.
		this.mnemonicEnumRefMap.clear();
		this.mnemonicSnippetRefMap.clear();

		if (mneLabels.length > 0) {
			// refresh storage for motor mnemonic label
			for (let index = 0; index < mneLabels.length; index++) {
				const mneLabel = mneLabels[index];
				const mneDescription = (mneDescriptions.length > index) ? mneDescriptions[index] : undefined;
				this.mnemonicEnumRefMap.set(mneLabel, { signature: mneLabel, description: mneDescription });
			}

			// refresh storage for motor mnemonic macro (snippet)
			for (let index = 0; index < SNIPPET_TEMPLATES.length; index++) {
				const snippetTemplate = SNIPPET_TEMPLATES[index];
				const snippetDesription = (SNIPPET_DESCRIPTIONS.length > index) ? SNIPPET_DESCRIPTIONS[index] : '';

				// treat the first word of the template as the snippet key.
				const offset = snippetTemplate.indexOf(' ');
				if (offset < 0) {
					console.log('Unexpected Snippet Format:', snippetTemplate);
					continue;
				}
				const snippetKey = snippetTemplate.substring(0, offset);

				// check the necessary number of motors. If not satisfied, skip the template.
				const minMotor = snippetTemplate.match(/%s/g);
				if (minMotor === null) {
					console.log('Unexpected Snippet Format:', snippetTemplate);
					continue;
				}
				if (minMotor.length > mneLabels.length) {
					continue;
				}

				// reformat the information.
				const snippetSignature = snippetTemplate.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\{\d+\|%s\|\}/g, mneLabels[0]);
				const snippetCode = snippetTemplate.replace(/%s/g, mneLabels.join(','));

				this.mnemonicSnippetRefMap.set(snippetKey, { signature: snippetSignature, description: snippetDesription, snippet: snippetCode });
			}
		}

		super.updateCompletionItems();
	}
}
