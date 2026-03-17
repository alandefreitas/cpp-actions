jest.mock('https');

import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PassThrough } from 'stream';

import { deriveRunnerInfo, updateRunnerImages } from './runner-images';

const mockedGet = https.get as jest.MockedFunction<typeof https.get>;

// ── deriveRunnerInfo unit tests ─────────────────────────────────────────────

describe('deriveRunnerInfo', () => {
    describe('macOS', () => {
        it('derives runner name from toolset-14.json', () => {
            expect(deriveRunnerInfo('macos', 'toolset-14.json')).toEqual({
                name: 'macos-14',
                version: '14'
            });
        });

        it('derives runner name from toolset-26.json', () => {
            expect(deriveRunnerInfo('macos', 'toolset-26.json')).toEqual({
                name: 'macos-26',
                version: '26'
            });
        });
    });

    describe('Windows', () => {
        it('derives runner name from toolset-2022.json', () => {
            expect(deriveRunnerInfo('windows', 'toolset-2022.json')).toEqual({
                name: 'windows-2022',
                version: '2022'
            });
        });

        it('derives runner name from toolset-2025.json', () => {
            expect(deriveRunnerInfo('windows', 'toolset-2025.json')).toEqual({
                name: 'windows-2025',
                version: '2025'
            });
        });

        it('skips multi-suffix variants like toolset-2025-vs2026.json', () => {
            expect(deriveRunnerInfo('windows', 'toolset-2025-vs2026.json')).toBeNull();
        });
    });

    describe('Ubuntu', () => {
        it('derives runner name from toolset-2204.json', () => {
            expect(deriveRunnerInfo('ubuntu', 'toolset-2204.json')).toEqual({
                name: 'ubuntu-22.04',
                version: '22.04'
            });
        });

        it('derives runner name from toolset-2404.json', () => {
            expect(deriveRunnerInfo('ubuntu', 'toolset-2404.json')).toEqual({
                name: 'ubuntu-24.04',
                version: '24.04'
            });
        });

        it('skips toolset files with non-4-digit versions', () => {
            expect(deriveRunnerInfo('ubuntu', 'toolset-22.json')).toBeNull();
        });
    });

    describe('edge cases', () => {
        it('returns null for non-toolset files', () => {
            expect(deriveRunnerInfo('macos', 'README.md')).toBeNull();
        });

        it('returns null for unknown platforms', () => {
            expect(deriveRunnerInfo('freebsd', 'toolset-14.json')).toBeNull();
        });

        it('returns null for files with extra suffixes', () => {
            expect(deriveRunnerInfo('macos', 'toolset-14-beta.json')).toBeNull();
        });

        it('returns null for non-numeric toolset files', () => {
            expect(deriveRunnerInfo('macos', 'toolset-abc.json')).toBeNull();
        });
    });
});

// ── updateRunnerImages integration tests (mocked HTTP) ──────────────────────

/**
 * Creates a mock HTTPS response with the given status and body.
 *
 * @param statusCode - HTTP status code
 * @param body - Response body object to serialize as JSON
 * @returns Mock response stream
 */
function mockResponse(statusCode: number, body: unknown): PassThrough {
    const stream = new PassThrough();
    Object.assign(stream, { statusCode });
    if (statusCode === 200) {
        process.nextTick(() => {
            stream.write(JSON.stringify(body));
            stream.end();
        });
    } else {
        process.nextTick(() => {
            stream.end();
        });
    }
    return stream;
}

describe('updateRunnerImages', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-images-test-'));
        fs.mkdirSync(path.join(tmpDir, 'setup-program'), { recursive: true });
        mockedGet.mockReset();
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('writes runner-images.json with discovered runners', async () => {
        const macosEntries = [
            { name: 'toolset-14.json', download_url: 'https://example.com/toolset-14.json' },
            { name: 'toolset-15.json', download_url: 'https://example.com/toolset-15.json' }
        ];
        const ubuntuEntries = [
            { name: 'toolset-2204.json', download_url: 'https://example.com/toolset-2204.json' }
        ];
        const windowsEntries = [
            { name: 'toolset-2022.json', download_url: 'https://example.com/toolset-2022.json' },
            { name: 'toolset-2025-vs2026.json', download_url: 'https://example.com/skip.json' }
        ];

        mockedGet.mockImplementation((_opts: unknown, cb: unknown) => {
            const callback = cb as (res: PassThrough) => void;
            const url = typeof _opts === 'string' ? _opts : (_opts as { path: string }).path;
            if (url.includes('ubuntu/toolsets')) {
                callback(mockResponse(200, ubuntuEntries));
            } else if (url.includes('macos/toolsets')) {
                callback(mockResponse(200, macosEntries));
            } else if (url.includes('windows/toolsets')) {
                callback(mockResponse(200, windowsEntries));
            } else {
                callback(mockResponse(404, null));
            }
            return { on: jest.fn().mockReturnThis() } as unknown as ReturnType<typeof https.get>;
        });

        const result = await updateRunnerImages(tmpDir);
        expect(result).toBe(true);

        const outputPath = path.join(tmpDir, 'setup-program/runner-images.json');
        expect(fs.existsSync(outputPath)).toBe(true);

        const data = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
        expect(data.runners.macos).toHaveLength(2);
        expect(data.runners.macos[0].name).toBe('macos-14');
        expect(data.runners.macos[1].name).toBe('macos-15');
        expect(data.runners.ubuntu).toHaveLength(1);
        expect(data.runners.ubuntu[0].name).toBe('ubuntu-22.04');
        expect(data.runners.windows).toHaveLength(1);
        expect(data.runners.windows[0].name).toBe('windows-2022');
    });

    it('returns false when all platforms fail', async () => {
        mockedGet.mockImplementation((_opts: unknown, cb: unknown) => {
            const callback = cb as (res: PassThrough) => void;
            callback(mockResponse(500, null));
            return { on: jest.fn().mockReturnThis() } as unknown as ReturnType<typeof https.get>;
        });

        const result = await updateRunnerImages(tmpDir);
        expect(result).toBe(false);
    });

    it('skips non-array responses gracefully', async () => {
        let callCount = 0;
        mockedGet.mockImplementation((_opts: unknown, cb: unknown) => {
            const callback = cb as (res: PassThrough) => void;
            callCount++;
            if (callCount === 1) {
                callback(mockResponse(200, { message: 'not an array' }));
            } else {
                callback(mockResponse(200, [
                    { name: 'toolset-14.json', download_url: 'https://example.com/toolset-14.json' }
                ]));
            }
            return { on: jest.fn().mockReturnThis() } as unknown as ReturnType<typeof https.get>;
        });

        const result = await updateRunnerImages(tmpDir);
        expect(result).toBe(true);
    });
});
