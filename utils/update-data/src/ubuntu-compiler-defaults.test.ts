jest.mock('https');

import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

import { updateUbuntuCompilerDefaults } from './ubuntu-compiler-defaults';

const mockedGet = https.get as jest.MockedFunction<typeof https.get>;

/** What the mocked server answers for a URL: a body (status 200), a status code, or a network error. */
type Reply = { body: Buffer } | { status: number } | { error: string };

/**
 * Routes `https.get` to fixed replies by URL. Unknown URLs answer 404.
 *
 * @param routes - Map from URL to the reply served for it
 */
function serve(routes: Record<string, Reply>): void {
    mockedGet.mockImplementation(((url: string, callback: (res: PassThrough) => void) => {
        const req = new EventEmitter();
        const reply: Reply = routes[url] ?? { status: 404 };
        process.nextTick(() => {
            if ('error' in reply) {
                req.emit('error', new Error(reply.error));
                return;
            }
            const res = new PassThrough();
            Object.assign(res, { statusCode: 'body' in reply ? 200 : reply.status });
            callback(res);
            if ('body' in reply) {
                res.write(reply.body);
            }
            res.end();
        });
        return req;
    }) as unknown as typeof https.get);
}

/**
 * Builds the archive URL of a Packages.gz file.
 *
 * @param host - Archive host prefix
 * @param codename - Release codename
 * @param component - APT component
 * @returns Full Packages.gz URL
 */
function pkgUrl(host: 'archive' | 'old-releases', codename: string, component: string): string {
    return `https://${host}.ubuntu.com/ubuntu/dists/${codename}/${component}/binary-amd64/Packages.gz`;
}

/**
 * Gzips a Packages file text, as served by the archive.
 *
 * @param text - Plain Packages file content
 * @returns Reply carrying the gzipped body
 */
function gz(text: string): Reply {
    return { body: zlib.gzipSync(Buffer.from(text, 'utf-8')) };
}

const JAMMY_MAIN = `Package: build-essential
Version: 12.9ubuntu3
Depends: libc6-dev | libc-dev, gcc (>= 4:11.2), g++ (>= 4:11.2), make

Package: gcc
Version: 4:11.2.0-1ubuntu1
Depends: cpp (>= 4:11.2.0-1ubuntu1), gcc-11 (>= 11.2.0-1~)

Package: gcc-11
Version: 11.4.0-1ubuntu1~22.04
`;

const JAMMY_UNIVERSE = `Package: gcc-12
Version: 12.3.0-1ubuntu1~22.04

Package: clang
Version: 1:14.0-55~exp2
Depends: clang-14 (>= 14~)

Package: clang-14
Version: 1:14.0.0-1ubuntu1.1

Package: clang-15
Version: 1:15.0.7-0ubuntu0.22.04.3
`;

let tmpDir: string;

/**
 * Writes setup-program/ubuntu-versions.json in the temporary root.
 *
 * @param versions - Version-to-codename map to write
 */
function writeVersions(versions: Record<string, string>): void {
    fs.mkdirSync(path.join(tmpDir, 'setup-program'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'setup-program', 'ubuntu-versions.json'), JSON.stringify(versions));
}

/**
 * Reads the generated ubuntu-compiler-defaults.json from the temporary root.
 *
 * @returns Parsed output file
 */
function readOutput(): { generated: string; source: string; releases: Record<string, unknown> } {
    return JSON.parse(fs.readFileSync(path.join(tmpDir, 'setup-program', 'ubuntu-compiler-defaults.json'), 'utf-8'));
}

const outputPath = (): string => path.join(tmpDir, 'setup-program', 'ubuntu-compiler-defaults.json');

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubuntu-compiler-defaults-'));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    jest.restoreAllMocks();
    mockedGet.mockReset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('updateUbuntuCompilerDefaults', () => {
    it('returns false when ubuntu-versions.json is missing', async () => {
        await expect(updateUbuntuCompilerDefaults(tmpDir)).resolves.toBe(false);
        expect(mockedGet).not.toHaveBeenCalled();
    });

    it('merges main and universe, marks defaults and writes the JSON file', async () => {
        writeVersions({ '22.04': 'jammy' });
        serve({
            [pkgUrl('archive', 'jammy', 'main')]: gz(JAMMY_MAIN),
            [pkgUrl('archive', 'jammy', 'universe')]: gz(JAMMY_UNIVERSE)
        });

        await expect(updateUbuntuCompilerDefaults(tmpDir)).resolves.toBe(true);

        const out = readOutput();
        expect(out.source).toBe('archive.ubuntu.com apt metadata');
        expect(Number.isNaN(Date.parse(out.generated))).toBe(false);
        expect(out.releases).toEqual({
            '22.04': {
                codename: 'jammy',
                gcc: {
                    default_version: '11',
                    available_versions: [
                        { major: 11, package_version: '11.4.0-1ubuntu1~22.04', is_default: true },
                        { major: 12, package_version: '12.3.0-1ubuntu1~22.04', is_default: false }
                    ]
                },
                clang: {
                    default_version: '14',
                    available_versions: [
                        { major: 14, package_version: '1:14.0.0-1ubuntu1.1', is_default: true },
                        { major: 15, package_version: '1:15.0.7-0ubuntu0.22.04.3', is_default: false }
                    ]
                }
            }
        });
    });

    it('skips releases older than 16.04 and sorts releases by version', async () => {
        writeVersions({ '24.04': 'noble', '14.04': 'trusty', '16.04': 'xenial' });
        const minimal = gz('Package: gcc-9\nVersion: 9.4.0\n');
        serve({
            [pkgUrl('archive', 'noble', 'main')]: minimal,
            [pkgUrl('archive', 'xenial', 'main')]: minimal
        });

        await expect(updateUbuntuCompilerDefaults(tmpDir)).resolves.toBe(true);

        const urls = mockedGet.mock.calls.map(c => c[0] as unknown as string);
        expect(urls.some(u => u.includes('trusty'))).toBe(false);
        expect(urls.findIndex(u => u.includes('xenial'))).toBeLessThan(urls.findIndex(u => u.includes('noble')));
        expect(Object.keys(readOutput().releases)).toEqual(['16.04', '24.04']);
    });

    it('leaves the default empty when the dependency chain cannot be resolved', async () => {
        writeVersions({ '20.04': 'focal' });
        serve({ [pkgUrl('archive', 'focal', 'main')]: gz('Package: gcc-9\nVersion: 9.4.0\n') });

        await expect(updateUbuntuCompilerDefaults(tmpDir)).resolves.toBe(true);
        expect(readOutput().releases['20.04']).toEqual({
            codename: 'focal',
            gcc: { default_version: '', available_versions: [{ major: 9, package_version: '9.4.0', is_default: false }] },
            clang: { default_version: '', available_versions: [] }
        });
    });

    it('falls back to old-releases.ubuntu.com for EOL releases', async () => {
        writeVersions({ '23.04': 'lunar' });
        serve({
            [pkgUrl('archive', 'lunar', 'main')]: { status: 404 },
            [pkgUrl('old-releases', 'lunar', 'main')]: gz('Package: gcc-13\nVersion: 13.1.0\n'),
            [pkgUrl('archive', 'lunar', 'universe')]: { error: 'ECONNRESET' },
            [pkgUrl('old-releases', 'lunar', 'universe')]: { body: Buffer.from('not gzip') }
        });

        await expect(updateUbuntuCompilerDefaults(tmpDir)).resolves.toBe(true);
        expect(readOutput().releases['23.04']).toMatchObject({
            codename: 'lunar',
            gcc: { available_versions: [{ major: 13, package_version: '13.1.0' }] }
        });
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('failed to fetch universe Packages.gz for lunar'));
    });

    it('skips a release whose archives are all unreachable', async () => {
        writeVersions({ '22.04': 'jammy', '24.04': 'noble' });
        serve({ [pkgUrl('archive', 'noble', 'main')]: gz('Package: gcc-13\nVersion: 13.2.0\n') });

        await expect(updateUbuntuCompilerDefaults(tmpDir)).resolves.toBe(true);
        expect(Object.keys(readOutput().releases)).toEqual(['24.04']);
    });

    it('returns false and writes nothing when no release could be fetched', async () => {
        writeVersions({ '22.04': 'jammy' });
        serve({});

        await expect(updateUbuntuCompilerDefaults(tmpDir)).resolves.toBe(false);
        expect(fs.existsSync(outputPath())).toBe(false);
    });
});
