jest.mock('http');

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

import { fetchUbuntuVersions, generateUbuntuVersionsJson } from './ubuntu-versions';

const mockedGet = http.get as jest.MockedFunction<typeof http.get>;

/**
 * Makes `http.get` answer with the given body, then end the stream.
 *
 * @param body - Text served as the response body
 */
function serveText(body: string): void {
    mockedGet.mockImplementation(((_url: string, callback: (res: PassThrough) => void) => {
        const res = new PassThrough();
        process.nextTick(() => {
            callback(res);
            res.write(body);
            res.end();
        });
        return new EventEmitter();
    }) as unknown as typeof http.get);
}

/**
 * Makes `http.get` emit a request error instead of a response.
 *
 * @param message - Error message of the emitted error
 */
function serveError(message: string): void {
    mockedGet.mockImplementation((() => {
        const req = new EventEmitter();
        process.nextTick(() => req.emit('error', new Error(message)));
        return req;
    }) as unknown as typeof http.get);
}

const META_RELEASE = [
    'Dist: focal',
    'Name: Focal Fossa',
    'Version: 20.04.6 LTS',
    'Supported: 1',
    '',
    'Dist: mantic',
    'Name: Mantic Minotaur',
    'Version: 23.10',
    'Supported: 0',
    '',
    'Dist: noble',
    'Name: Noble Numbat',
    'Version: 24.04 LTS'
].join('\n');

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    jest.restoreAllMocks();
    mockedGet.mockReset();
});

describe('fetchUbuntuVersions', () => {
    it('maps each version to its codename, dropping the LTS suffix', async () => {
        serveText(META_RELEASE);
        await expect(fetchUbuntuVersions()).resolves.toEqual({
            '20.04.6': 'focal',
            '23.10': 'mantic',
            '24.04': 'noble'
        });
        expect(mockedGet.mock.calls[0][0]).toBe('http://changelogs.ubuntu.com/meta-release');
    });

    it('ignores blocks that lack a Dist or a Version', async () => {
        serveText('Dist: orphan\n\nVersion: 99.04\n\nDist: jammy\nVersion: 22.04 LTS\n');
        await expect(fetchUbuntuVersions()).resolves.toEqual({ '22.04': 'jammy' });
    });

    it('rejects when the request fails', async () => {
        serveError('ECONNREFUSED');
        await expect(fetchUbuntuVersions()).rejects.toThrow('ECONNREFUSED');
    });
});

describe('generateUbuntuVersionsJson', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubuntu-versions-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('writes setup-program/ubuntu-versions.json, creating the directory', async () => {
        serveText(META_RELEASE);
        await expect(generateUbuntuVersionsJson(tmpDir)).resolves.toBe(true);

        const outputPath = path.join(tmpDir, 'setup-program', 'ubuntu-versions.json');
        expect(JSON.parse(fs.readFileSync(outputPath, 'utf-8'))).toEqual({
            '20.04.6': 'focal',
            '23.10': 'mantic',
            '24.04': 'noble'
        });
    });

    it('overwrites the file when the directory already exists', async () => {
        const outputDir = path.join(tmpDir, 'setup-program');
        fs.mkdirSync(outputDir);
        fs.writeFileSync(path.join(outputDir, 'ubuntu-versions.json'), '{"old":"data"}');

        serveText('Dist: noble\nVersion: 24.04 LTS\n');
        await expect(generateUbuntuVersionsJson(tmpDir)).resolves.toBe(true);
        expect(JSON.parse(fs.readFileSync(path.join(outputDir, 'ubuntu-versions.json'), 'utf-8')))
            .toEqual({ '24.04': 'noble' });
    });

    it('returns false and writes nothing when the fetch fails', async () => {
        serveError('ENOTFOUND');
        await expect(generateUbuntuVersionsJson(tmpDir)).resolves.toBe(false);
        expect(fs.existsSync(path.join(tmpDir, 'setup-program'))).toBe(false);
    });
});
