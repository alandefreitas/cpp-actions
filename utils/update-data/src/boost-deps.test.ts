jest.mock('./runner');

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { runCommand } from './runner';
import { generateBoostDeps } from './boost-deps';

const mockedRun = runCommand as jest.MockedFunction<typeof runCommand>;

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boost-deps-'));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    jest.restoreAllMocks();
    mockedRun.mockReset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Creates an empty boost-clone/scripts/generate-deps.ts in the temporary root.
 *
 * @returns Path of the created generator script
 */
function createGenerator(): string {
    const generatorPath = path.join(tmpDir, 'boost-clone', 'scripts', 'generate-deps.ts');
    fs.mkdirSync(path.dirname(generatorPath), { recursive: true });
    fs.writeFileSync(generatorPath, '');
    return generatorPath;
}

describe('generateBoostDeps', () => {
    it('skips with success when the generator script does not exist', async () => {
        await expect(generateBoostDeps(tmpDir)).resolves.toBe(true);
        expect(mockedRun).not.toHaveBeenCalled();
    });

    it('runs the generator with ts-node, the output path and a timeout', async () => {
        const generatorPath = createGenerator();
        mockedRun.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', success: true });

        await expect(generateBoostDeps(tmpDir)).resolves.toBe(true);

        expect(mockedRun).toHaveBeenCalledWith('npx', [
            'ts-node',
            generatorPath,
            '--latest', '1',
            '--output', path.join(tmpDir, 'boost-clone', 'boost-deps.json'),
            '--skip-existing'
        ], { cwd: tmpDir, timeout: 300000 });
    });

    it('returns false and prints stderr when the generator fails', async () => {
        createGenerator();
        mockedRun.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'rate limited', success: false });

        await expect(generateBoostDeps(tmpDir)).resolves.toBe(false);
        expect(console.error).toHaveBeenCalledWith('rate limited');
    });
});
