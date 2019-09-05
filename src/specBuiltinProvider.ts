import { SpecProvider } from "./specProvider";
import * as fs from 'fs';

export class SpecBuiltinProvider extends SpecProvider {
    constructor(apiReferencePath: string) {
        super();
        
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


}