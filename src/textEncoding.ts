import { TextDecoder } from 'util';
import * as vscode from 'vscode';

/**
 * @param uri URI
 * @returns TextDecoder object
 * 
 * Create a TextDecoder object referring to a text encoding defined in the configuration properties 'files.encoding'.
 * Since the encoding string in VS Code and TextDecoder are not identical, the property value is converted internally.
 * https://encoding.spec.whatwg.org/#names-and-labels.
 */
export function getTextDecorder(scope?: vscode.ConfigurationScope): TextDecoder {
    // get 'files.encoding' property value
    const encoding = vscode.workspace.getConfiguration('files', scope).get<string>('encoding');

    // convert encoding value in VS Code to that in TextDecoder/TextEncoder
    let encoding2: string | undefined;
    let bom: boolean | undefined;
    switch (encoding) {
        case 'utf8':
            encoding2 = 'utf-8';
            break;
        case 'utf8bom':
            encoding2 = 'utf-8';
            bom = false;
            break;
        case 'utf16le':
            encoding2 = 'utf-16le';
            break;
        case 'utf16be':
            encoding2 = 'utf-16be';
            break;
        case 'windows1252':
            encoding2 = 'windows-1252';
            break;
        case 'iso88591':
            encoding2 = 'iso-8859-1';
            break;
        case 'iso88593':
            encoding2 = 'iso-8859-3';
            break;
        case 'iso885915':
            encoding2 = 'iso-8859-15';
            break;
        case 'macroman':
            encoding2 = 'x-mac-roman';
            break;
        // case 'cp437':
        case 'windows1256':
            encoding2 = 'windows-1256';
            break;
        case 'iso88596':
            encoding2 = 'iso-8859-6';
            break;
        case 'windows1257':
            encoding2 = 'windows-1257';
            break;
        case 'iso88594':
            encoding2 = 'iso-8859-4';
            break;
        case 'iso885914':
            encoding2 = 'iso-8859-14';
            break;
        case 'windows1250':
            encoding2 = 'windows-1250';
            break;
        case 'iso88592':
            encoding2 = 'iso-8859-2';
            break;
        // case 'cp852':
        case 'windows1251':
            encoding2 = 'windows-1251';
            break;
        case 'cp866':
            encoding2 = 'cp866';
            break;
        case 'iso88595':
            encoding2 = 'iso-8859-5';
            break;
        case 'koi8r':
            encoding2 = 'koi8-r';
            break;
        case 'koi8u':
            encoding2 = 'koi8-u';
            break;
        case 'iso885913':
            encoding2 = 'iso-8859-13';
            break;
        case 'windows1253':
            encoding2 = 'windows-1253';
            break;
        case 'iso88597':
            encoding2 = 'iso-8859-7';
            break;
        case 'windows1255':
            encoding2 = 'windows-1255';
            break;
        case 'iso88598':
            encoding2 = 'iso-8859-8';
            break;
        case 'iso885910':
            encoding2 = 'iso-8859-10';
            break;
        case 'iso885916':
            encoding2 = 'iso-8859-16';
            break;
        case 'windows1254':
            encoding2 = 'windows-1254';
            break;
        case 'iso88599':
            encoding2 = 'iso-8859-9';
            break;
        case 'windows1258':
            encoding2 = 'windows-1258';
            break;
        case 'gbk':
            encoding2 = 'x-gbk';
            break;
        case 'gb18030':
            encoding2 = 'gb18030';
            break;
        // case 'cp950':
        case 'big5hkscs':
            encoding2 = 'big5-hkscs';
            break;
        case 'shiftjis':
            encoding2 = 'shift-jis';
            break;
        case 'eucjp':
            encoding2 = 'euc-jp';
            break;
        case 'euckr':
            encoding2 = 'euc-kr';
            break;
        case 'windows874':
            encoding2 = 'windows-874';
            break;
        case 'iso885911':
            encoding2 = 'iso-8859-11';
            break;
        case 'koi8ru':
            encoding2 = 'koi8-ru';
            break;
        // case 'koi8t':
        case 'gb2312':
            encoding2 = 'gb2312';
            break;
        // case 'cp865':
        // case 'cp850':
        default:
            break;
    }

    if (bom !== undefined) {
        return new TextDecoder(encoding2, { ignoreBOM: bom });
    } else {
        return new TextDecoder(encoding2);
    }
}
