import type { Inputs } from './schema';

// Shared across module registries: the CLI is re-required in jest.isolateModules,
// which re-runs the mock factories, so the factories forward to these functions.
const mockMain = jest.fn<Promise<void>, [Inputs]>();
const mockSetTraceCommands = jest.fn();

jest.mock('./index', () => ({
    main: (inputs: Inputs) => mockMain(inputs)
}));

jest.mock('trace-commands', () => ({
    setTraceCommands: (value: boolean) => mockSetTraceCommands(value)
}));

const savedArgv = process.argv;
const savedEnv = { ...process.env };
const savedPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;

/**
 * Loads the CLI module with the given arguments, as `node create-changelog.js ...args`.
 *
 * @param args - Command line arguments after the script name
 * @returns The inputs passed to main
 */
async function runCli(...args: string[]): Promise<Inputs> {
    process.argv = ['node', 'create-changelog.js', ...args];
    jest.isolateModules(() => {
        require('./create-changelog');
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(mockMain).toHaveBeenCalledTimes(1);
    return mockMain.mock.calls[0][0];
}

beforeEach(() => {
    mockMain.mockReset();
    mockMain.mockResolvedValue(undefined);
});

afterEach(() => {
    process.argv = savedArgv;
    process.env = { ...savedEnv };
    Object.defineProperty(process, 'platform', savedPlatform);
});

describe('create-changelog CLI', () => {
    it('runs main with the defaults and trace commands on', async () => {
        process.env.GITHUB_TOKEN = 'env-token';
        const inputs = await runCli();
        expect(inputs).toMatchObject({
            sourceDir: process.cwd().replace(/\\/g, '/'),
            outputPath: 'CHANGELOG.md',
            limit: 0,
            thankNonRegular: true,
            checkUnconventional: 'warn',
            linkCommits: true,
            githubToken: 'env-token',
            updateSummary: false,
            traceCommands: true,
            sortBy: 'most-changes-first'
        });
        expect(inputs.versionPattern.test('v1.2.3')).toBe(true);
        expect(inputs.tagPattern.test('1.2.3')).toBe(false);
        expect(Array.from(inputs.includeTypes)).toEqual([]);
        expect(Array.from(inputs.excludeTypes)).toEqual(['chore', 'style']);
        expect(mockSetTraceCommands).toHaveBeenCalledWith(true);
    });

    it('parses every option', async () => {
        process.env.HOME = '/home/tester';
        const inputs = await runCli(
            '--sourceDir', '~/proj',
            '--versionPattern', '^release',
            '--tagPattern', '^r\\d+',
            '-o', 'out\\CHANGES.md',
            '--limit', '5',
            '--thankNonRegular', 'false',
            '--checkUnconventional', 'error',
            '--linkCommits', 'false',
            '--githubToken', 'tok',
            '--updateSummary', 'true',
            '--traceCommands', 'false',
            '--includeTypes', ' feat, fix ,',
            '--excludeTypes', 'docs',
            '--sortBy', 'latest-first'
        );
        expect(inputs).toMatchObject({
            sourceDir: '/home/tester/proj',
            outputPath: 'out/CHANGES.md',
            limit: 5,
            thankNonRegular: false,
            checkUnconventional: 'error',
            linkCommits: false,
            githubToken: 'tok',
            updateSummary: true,
            traceCommands: false,
            sortBy: 'latest-first'
        });
        expect(inputs.versionPattern.source).toBe('^release');
        expect(inputs.tagPattern.test('r12')).toBe(true);
        expect(Array.from(inputs.includeTypes)).toEqual(['feat', 'fix']);
        expect(Array.from(inputs.excludeTypes)).toEqual(['docs']);
    });

    it('accepts --outputPath and ignores a non-numeric --limit', async () => {
        const inputs = await runCli('--outputPath', 'NOTES.md', '--limit', 'many');
        expect(inputs.outputPath).toBe('NOTES.md');
        expect(inputs.limit).toBe(0);
    });

    it('expands ~\\ with USERPROFILE on Windows when HOME is not set', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        delete process.env.HOME;
        process.env.USERPROFILE = 'C:\\Users\\tester';
        const inputs = await runCli('--sourceDir', '~\\proj');
        expect(inputs.sourceDir).toBe('C:/Users/tester/proj');
    });

    it('prefers HOME on Windows and falls back to an empty home', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        process.env.HOME = 'D:\\home';
        expect((await runCli('--sourceDir', '~/proj')).sourceDir).toBe('D:/home/proj');

        mockMain.mockClear();
        delete process.env.HOME;
        delete process.env.USERPROFILE;
        expect((await runCli('--sourceDir', '~/proj')).sourceDir).toBe('/proj');
    });

    it('expands ~ to an empty home when no home variable is set', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        delete process.env.HOME;
        const inputs = await runCli('--sourceDir', '~/proj');
        expect(inputs.sourceDir).toBe('/proj');
    });

    it('uses a positional argument as sourceDir only when it is an existing file', async () => {
        const fileInputs = await runCli(__filename);
        expect(fileInputs.sourceDir).toBe(__filename.replace(/\\/g, '/'));

        mockMain.mockClear();
        const dirInputs = await runCli(__dirname);
        expect(dirInputs.sourceDir).toBe(process.cwd().replace(/\\/g, '/'));

        mockMain.mockClear();
        const missingInputs = await runCli('does-not-exist-anywhere');
        expect(missingInputs.sourceDir).toBe(process.cwd().replace(/\\/g, '/'));
    });

    it('prints the error when main fails', async () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const error = new Error('boom');
        mockMain.mockRejectedValue(error);
        await runCli();
        expect(consoleError).toHaveBeenCalledWith('Error:', error);
        consoleError.mockRestore();
    });
});
