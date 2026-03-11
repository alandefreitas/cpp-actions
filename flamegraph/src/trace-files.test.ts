import * as path from 'path';
import { createReadmeFile } from './trace-files';

describe('trace-files', () => {
    describe('createReadmeFile', () => {
        it('should create a readme file at the specified path', async () => {
            const readmePath = path.join(__dirname, '../testOutput', 'README.md');
            await createReadmeFile(readmePath);
        });
    });
});
