import * as fs from 'fs';
import * as unrar from 'node-unrar-js';

export const fromFile = async function (file: string) {
    // Read the archive file into a typedArray
    const buf = Uint8Array.from(fs.readFileSync(file)).buffer;
    const extractor = await unrar.createExtractorFromData({ data: buf });

    const list = extractor.getFileList();
    const listArcHeader = list.arcHeader; // archive header
    const fileHeaders = [...list.fileHeaders]; // load the file headers

    const extracted = extractor.extract({ files: ['1.txt'] });
    // extracted.arcHeader  : archive header
    const files = [...extracted.files]; //load the files
    files[0].fileHeader; // file header
    files[0].extraction; // Uint8Array content, createExtractorFromData only
};
