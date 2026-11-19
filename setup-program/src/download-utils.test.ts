jest.mock('@actions/tool-cache', () => ({
    downloadTool: jest.fn(),
    extractTar: jest.fn(),
    extractZip: jest.fn(),
    extract7z: jest.fn(),
    extractXar: jest.fn()
}));

jest.mock('@actions/io', () => ({
    mkdirP: jest.fn(),
    which: jest.fn(),
    cp: jest.fn(),
    rmRF: jest.fn(),
    mv: jest.fn()
}));

jest.mock('@actions/exec', () => ({
    getExecOutput: jest.fn()
}));

jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    readdirSync: jest.fn(),
    existsSync: jest.fn(),
    statSync: jest.fn()
}));

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn()),
    enabled: jest.fn()
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as tc from '@actions/tool-cache';
import * as io from '@actions/io';
import * as exec from '@actions/exec';
import * as traceCommands from 'trace-commands';
import { ExpectedError } from 'pretty-errors';

import { extractTar, downloadAndExtract, stripSingleDirectoryFromPath } from './download-utils';

const mockDownloadTool = tc.downloadTool as jest.MockedFunction<typeof tc.downloadTool>;
const mockTcExtractTar = tc.extractTar as jest.MockedFunction<typeof tc.extractTar>;
const mockExtractZip = tc.extractZip as jest.MockedFunction<typeof tc.extractZip>;
const mockExtract7z = tc.extract7z as jest.MockedFunction<typeof tc.extract7z>;
const mockExtractXar = tc.extractXar as jest.MockedFunction<typeof tc.extractXar>;
const mockMkdirP = io.mkdirP as jest.MockedFunction<typeof io.mkdirP>;
const mockWhich = io.which as jest.MockedFunction<typeof io.which>;
const mockCp = io.cp as jest.MockedFunction<typeof io.cp>;
const mockRmRF = io.rmRF as jest.MockedFunction<typeof io.rmRF>;
const mockMv = io.mv as jest.MockedFunction<typeof io.mv>;
const mockGetExecOutput = exec.getExecOutput as jest.MockedFunction<typeof exec.getExecOutput>;
const mockReaddirSync = fs.readdirSync as unknown as jest.Mock;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockStatSync = fs.statSync as unknown as jest.Mock;
const mockTraceEnabled = traceCommands.enabled as jest.MockedFunction<typeof traceCommands.enabled>;

const originalPlatform = process.platform;

/**
 * Overrides `process.platform` for the current test.
 *
 * @param platform - Platform value to report
 */
function setPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: platform });
}

/**
 * Makes the mocked `fs.readdirSync` return a fixed listing per directory.
 *
 * @param listing - Map from directory path to its entries
 */
function mockDirectories(listing: Record<string, string[]>): void {
    mockReaddirSync.mockImplementation((dir: string) => {
        if (!(dir in listing)) {
            throw new Error(`unexpected readdirSync(${dir})`);
        }
        return listing[dir];
    });
}

beforeEach(() => {
    jest.resetAllMocks();
    (traceCommands.scoped as jest.Mock).mockReturnValue(jest.fn());
    mockWhich.mockResolvedValue('7z');
    mockGetExecOutput.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
});

afterEach(() => {
    setPlatform(originalPlatform);
});

describe('extractTar', () => {
    it('delegates to tc.extractTar outside Windows', async () => {
        setPlatform('linux');
        mockTcExtractTar.mockResolvedValue('/out');

        await expect(extractTar('/dl/a.tar.gz', '/out', '-xz')).resolves.toBe('/out');
        expect(mockTcExtractTar).toHaveBeenCalledWith('/dl/a.tar.gz', '/out', '-xz');
        expect(mockGetExecOutput).not.toHaveBeenCalled();
    });

    describe('on Windows', () => {
        const tmp = os.tmpdir();

        beforeEach(() => {
            setPlatform('win32');
        });

        it('extracts a plain .tar with one 7z pass into a temp directory named after the archive', async () => {
            const tarPath = path.join('dl', 'archive.tar');
            const first = path.join(tmp, 'archive_1st');
            const final = path.join(tmp, 'archive');
            mockDirectories({ [first]: ['bin', 'README'] });

            const result = await extractTar(tarPath, undefined);

            expect(result).toBe(final);
            expect(mockGetExecOutput).toHaveBeenCalledTimes(1);
            expect(mockGetExecOutput).toHaveBeenCalledWith('7z', ['x', tarPath, `-o${first}`]);
            expect(mockMkdirP).toHaveBeenCalledWith(final);
            expect(mockMkdirP).not.toHaveBeenCalledWith(path.join(tmp, 'archive_2nd'));
            expect(mockCp).toHaveBeenCalledWith(path.join(first, 'bin'), path.join(final, 'bin'), { recursive: true });
            expect(mockCp).toHaveBeenCalledWith(path.join(first, 'README'), path.join(final, 'README'), { recursive: true });
            expect(mockRmRF).toHaveBeenCalledWith(first);
        });

        it('adds -bb1 to 7z when the flags request verbose output', async () => {
            const first = path.join(tmp, 'v_1st');
            mockDirectories({ [first]: [] });

            await extractTar('v.tar', '/dest', '-vx');

            expect(mockGetExecOutput).toHaveBeenCalledWith('7z', ['x', 'v.tar', `-o${first}`, '-bb1']);
        });

        it('throws an ExpectedError when the first 7z pass fails', async () => {
            mockGetExecOutput.mockResolvedValue({ exitCode: 2, stdout: '', stderr: 'bad archive' });

            const promise = extractTar('bad.tar', '/dest');
            await expect(promise).rejects.toBeInstanceOf(ExpectedError);
            await expect(extractTar('bad.tar', '/dest')).rejects.toThrow(/exit code 2\)\.\nbad archive/);
        });

        it('extracts a compressed tarball in two 7z passes', async () => {
            const tarPath = path.join('dl', 'pkg.tar.gz');
            const dest = path.join('out', 'pkg');
            const first = path.join(tmp, 'pkg.tar_1st');
            const second = path.join(tmp, 'pkg.tar_2nd');
            const innerTar = path.join(first, 'pkg.tar');
            mockDirectories({
                [first]: ['pkg.tar'],
                [second]: ['pkg-1.0']
            });

            const result = await extractTar(tarPath, dest, '-xz');

            expect(result).toBe(dest);
            expect(mockMkdirP).toHaveBeenCalledWith(second);
            expect(mockGetExecOutput.mock.calls).toEqual([
                ['7z', ['x', tarPath, `-o${first}`]],
                ['7z', ['x', innerTar, `-o${second}`]]
            ]);
            expect(mockCp).toHaveBeenCalledTimes(1);
            expect(mockCp).toHaveBeenCalledWith(path.join(second, 'pkg-1.0'), path.join(dest, 'pkg-1.0'), { recursive: true });
            expect(mockRmRF).toHaveBeenCalledWith(second);
            expect(mockRmRF).toHaveBeenCalledWith(first);
        });

        it('passes -bb1 to both passes in verbose mode', async () => {
            const first = path.join(tmp, 'pkg.tar_1st');
            const second = path.join(tmp, 'pkg.tar_2nd');
            mockDirectories({ [first]: ['pkg.tar'], [second]: [] });

            await extractTar('pkg.tar.xz', '/dest', '-vxJ');

            expect(mockGetExecOutput.mock.calls[0][1]).toContain('-bb1');
            expect(mockGetExecOutput.mock.calls[1][1]).toContain('-bb1');
        });

        it('skips the second pass when the first one produced several files', async () => {
            const first = path.join(tmp, 'multi.tar_1st');
            mockDirectories({ [first]: ['a', 'b'] });

            await expect(extractTar('multi.tar.gz', '/dest')).resolves.toBe('/dest');
            expect(mockGetExecOutput).toHaveBeenCalledTimes(1);
            expect(mockCp).toHaveBeenCalledTimes(2);
        });

        it('skips the second pass when the single extracted file is not a tar', async () => {
            const first = path.join(tmp, 'one.tar_1st');
            mockDirectories({ [first]: ['one'] });

            await expect(extractTar('one.tar.gz', '/dest')).resolves.toBe('/dest');
            expect(mockGetExecOutput).toHaveBeenCalledTimes(1);
            expect(mockCp).toHaveBeenCalledWith(path.join(first, 'one'), path.join('/dest', 'one'), { recursive: true });
        });

        it('throws an ExpectedError when the second 7z pass fails', async () => {
            const first = path.join(tmp, 'pkg.tar_1st');
            mockDirectories({ [first]: ['pkg.tar'] });
            mockGetExecOutput
                .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
                .mockResolvedValueOnce({ exitCode: 7, stdout: '', stderr: 'corrupt' });

            await expect(extractTar('pkg.tar.bz2', '/dest')).rejects.toThrow(/Failed to extract .*pkg\.tar .*exit code 7\)\.\ncorrupt/);
        });

        it('does not move or remove directories that are the final destination', async () => {
            const first = path.join(tmp, 'same.tar_1st');
            const second = path.join(tmp, 'same.tar_2nd');
            mockDirectories({ [first]: ['same.tar'] });

            await expect(extractTar('same.tar.gz', second)).resolves.toBe(second);
            expect(mockCp).not.toHaveBeenCalled();
            expect(mockRmRF).toHaveBeenCalledTimes(1);
            expect(mockRmRF).toHaveBeenCalledWith(first);
        });
    });
});

describe('downloadAndExtract', () => {
    const dlDir = path.join(os.tmpdir(), 'dl');
    const tmpFile = path.join(dlDir, '3f2a-uuid');

    beforeEach(() => {
        setPlatform('linux');
        mockDownloadTool.mockResolvedValue(tmpFile);
        mockTraceEnabled.mockReturnValue(false);
    });

    it('renames the download to the URL filename and extracts a zip', async () => {
        mockExtractZip.mockResolvedValue('/extracted');

        const result = await downloadAndExtract('https://example.com/tool-1.0.zip');

        expect(result).toBe('/extracted');
        expect(mockDownloadTool).toHaveBeenCalledWith('https://example.com/tool-1.0.zip');
        const renamed = path.join(dlDir, 'tool-1.0.zip');
        expect(mockMv).toHaveBeenCalledWith(tmpFile, renamed);
        expect(mockExtractZip).toHaveBeenCalledWith(renamed, undefined);
    });

    it('keeps the temporary name when the URL filename has unusual characters', async () => {
        mockExtractZip.mockResolvedValue('/extracted');

        await downloadAndExtract('https://example.com/my%20tool.zip');

        expect(mockMv).not.toHaveBeenCalled();
        expect(mockExtractZip).toHaveBeenCalledWith(tmpFile, undefined);
    });

    it.each([
        ['.tar', false, '-x'],
        ['.tar', true, '-vx'],
        ['.tar.gz', false, '-xz'],
        ['.tar.gz', true, '-vxz'],
        ['.tar.xz', false, '-xJ'],
        ['.tar.xz', true, '-vxJ'],
        ['.tar.bz2', false, '-xj'],
        ['.tar.bz2', true, '-vxj']
    ])('extracts %s archives with tar flags (trace=%s -> %s)', async (ext, trace, flags) => {
        mockTraceEnabled.mockReturnValue(trace);
        mockTcExtractTar.mockResolvedValue('/extracted');

        const result = await downloadAndExtract(`https://example.com/tool${ext}`);

        expect(result).toBe('/extracted');
        expect(mockTcExtractTar).toHaveBeenCalledWith(path.join(dlDir, `tool${ext}`), undefined, flags);
    });

    it('extracts .7z archives with tc.extract7z', async () => {
        mockExtract7z.mockResolvedValue('/extracted');

        await expect(downloadAndExtract('https://example.com/tool.7z')).resolves.toBe('/extracted');
        expect(mockExtract7z).toHaveBeenCalledWith(path.join(dlDir, 'tool.7z'), undefined);
    });

    it('extracts .pkg archives with tc.extractXar on macOS', async () => {
        setPlatform('darwin');
        mockExtractXar.mockResolvedValue('/extracted');

        await expect(downloadAndExtract('https://example.com/tool.pkg')).resolves.toBe('/extracted');
        expect(mockExtractXar).toHaveBeenCalledWith(path.join(dlDir, 'tool.pkg'), undefined);
    });

    it('returns undefined for .pkg archives outside macOS', async () => {
        await expect(downloadAndExtract('https://example.com/tool.pkg')).resolves.toBeUndefined();
        expect(mockExtractXar).not.toHaveBeenCalled();
    });

    it('returns undefined for unsupported formats', async () => {
        await expect(downloadAndExtract('https://example.com/tool.rar')).resolves.toBeUndefined();
    });

    it('resolves a relative destination and creates it when missing', async () => {
        mockExistsSync.mockReturnValue(false);
        mockExtractZip.mockResolvedValue('/extracted');
        const resolved = path.resolve('relative-dest');

        await downloadAndExtract('https://example.com/tool.zip', 'relative-dest');

        expect(mockMkdirP).toHaveBeenCalledWith(resolved);
        expect(mockExtractZip).toHaveBeenCalledWith(path.join(dlDir, 'tool.zip'), resolved);
    });

    it('does not create an absolute destination that already exists', async () => {
        const dest = path.resolve('existing-dest');
        mockExistsSync.mockReturnValue(true);
        mockExtractZip.mockResolvedValue(dest);

        await expect(downloadAndExtract('https://example.com/tool.zip', dest)).resolves.toBe(dest);
        expect(mockMkdirP).not.toHaveBeenCalled();
        expect(mockExtractZip).toHaveBeenCalledWith(path.join(dlDir, 'tool.zip'), dest);
    });

    it('uses forward slashes for the archive and destination paths on Windows', async () => {
        setPlatform('win32');
        const dest = path.resolve('win-dest');
        mockExistsSync.mockReturnValue(true);
        mockExtractZip.mockResolvedValue('/extracted');

        await downloadAndExtract('https://example.com/tool.zip', dest);

        const [archiveArg, destArg] = mockExtractZip.mock.calls[0];
        expect(archiveArg).toBe(path.join(dlDir, 'tool.zip').replace(/\\/g, '/'));
        expect(destArg).toBe(dest.replace(/\\/g, '/'));
        expect(archiveArg).not.toContain('\\');
        expect(destArg).not.toContain('\\');
    });

    it('returns undefined when the download fails', async () => {
        mockDownloadTool.mockRejectedValue(new Error('404'));

        await expect(downloadAndExtract('https://example.com/tool.zip')).resolves.toBeUndefined();
    });

    it('returns undefined when extraction throws a non-Error value', async () => {
        mockExtractZip.mockRejectedValue('corrupt zip');

        await expect(downloadAndExtract('https://example.com/tool.zip')).resolves.toBeUndefined();
    });
});

describe('stripSingleDirectoryFromPath', () => {
    const root = path.join('extract', 'root');

    it('moves the contents of a single top-level directory up one level', async () => {
        const inner = path.join(root, 'tool-1.0');
        mockDirectories({ [root]: ['tool-1.0'], [inner]: ['bin', 'lib'] });
        mockStatSync.mockReturnValue({ isDirectory: () => true });

        await expect(stripSingleDirectoryFromPath(root)).resolves.toBe(true);
        expect(mockStatSync).toHaveBeenCalledWith(inner);
        expect(mockMv.mock.calls).toEqual([
            [path.join(inner, 'bin'), path.join(root, 'bin')],
            [path.join(inner, 'lib'), path.join(root, 'lib')]
        ]);
    });

    it('leaves a single regular file in place', async () => {
        mockDirectories({ [root]: ['tool.exe'] });
        mockStatSync.mockReturnValue({ isDirectory: () => false });

        await expect(stripSingleDirectoryFromPath(root)).resolves.toBe(false);
        expect(mockMv).not.toHaveBeenCalled();
    });

    it('does nothing when there are several entries', async () => {
        mockDirectories({ [root]: ['bin', 'lib'] });

        await expect(stripSingleDirectoryFromPath(root)).resolves.toBe(false);
        expect(mockStatSync).not.toHaveBeenCalled();
        expect(mockMv).not.toHaveBeenCalled();
    });
});
