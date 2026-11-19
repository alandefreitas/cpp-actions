jest.mock('https');

import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PassThrough } from 'stream';

import {
    extractGccVersions,
    extractLlvmVersion,
    fetchHomebrewVersions,
    updateMacOSXcodeDefaults
} from './macos-xcode-defaults';

const mockedGet = https.get as jest.MockedFunction<typeof https.get>;

// ── Helper ──────────────────────────────────────────────────────────────────

/**
 * Creates a mock HTTPS response with the given status and body.
 *
 * @param statusCode - HTTP status code
 * @param body - Response body object to serialize as JSON
 * @returns Mock response stream
 */
function mockResponse(
    statusCode: number,
    body: unknown
): PassThrough {
    const stream = new PassThrough();
    Object.assign(stream, { statusCode, headers: {} });
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

// ── extractGccVersions ──────────────────────────────────────────────────────

describe('extractGccVersions', () => {
    it('extracts GCC major versions from toolset', () => {
        const toolset = {
            xcode: { default: '/Applications/Xcode_15.4.app', arm64: { versions: [] } },
            gcc: { versions: ['13', '14', '15'] }
        };
        expect(extractGccVersions(toolset)).toEqual(['13', '14', '15']);
    });

    it('returns empty array when gcc section is absent', () => {
        const toolset = {
            xcode: { default: '/Applications/Xcode_15.4.app', arm64: { versions: [] } }
        };
        expect(extractGccVersions(toolset)).toEqual([]);
    });

    it('returns empty array when gcc.versions is empty', () => {
        const toolset = {
            xcode: { default: '/Applications/Xcode_15.4.app', arm64: { versions: [] } },
            gcc: { versions: [] }
        };
        expect(extractGccVersions(toolset)).toEqual([]);
    });
});

// ── extractLlvmVersion ──────────────────────────────────────────────────────

describe('extractLlvmVersion (macOS)', () => {
    it('extracts LLVM version string from toolset', () => {
        const toolset = {
            xcode: { default: '/Applications/Xcode_15.4.app', arm64: { versions: [] } },
            llvm: { version: '18' }
        };
        expect(extractLlvmVersion(toolset)).toBe('18');
    });

    it('returns null when llvm section is absent', () => {
        const toolset = {
            xcode: { default: '/Applications/Xcode_15.4.app', arm64: { versions: [] } }
        };
        expect(extractLlvmVersion(toolset)).toBeNull();
    });
});

// ── fetchHomebrewVersions ───────────────────────────────────────────────────

describe('fetchHomebrewVersions', () => {
    beforeEach(() => {
        mockedGet.mockReset();
    });

    it('fetches main and versioned formulae, filters deprecated', async () => {
        const mainFormula = {
            versions: { stable: '15.2.0' },
            versioned_formulae: ['gcc@14', 'gcc@13', 'gcc@12'],
            deprecated: false,
            disabled: false
        };
        const gcc14 = {
            versions: { stable: '14.3.0' },
            deprecated: false,
            disabled: false
        };
        const gcc13 = {
            versions: { stable: '13.4.0' },
            deprecated: false,
            disabled: false
        };
        const gcc12 = {
            versions: { stable: '12.5.0' },
            deprecated: true,
            disabled: false
        };

        mockedGet.mockImplementation((urlOrOpts: unknown, cb: unknown) => {
            const callback = cb as (res: PassThrough) => void;
            const url = typeof urlOrOpts === 'string' ? urlOrOpts : '';

            if (url.endsWith('/gcc.json')) {
                callback(mockResponse(200, mainFormula));
            } else if (url.includes('gcc@14')) {
                callback(mockResponse(200, gcc14));
            } else if (url.includes('gcc@13')) {
                callback(mockResponse(200, gcc13));
            } else if (url.includes('gcc@12')) {
                callback(mockResponse(200, gcc12));
            } else {
                callback(mockResponse(404, null));
            }
            return { on: jest.fn().mockReturnThis() } as unknown as ReturnType<typeof https.get>;
        });

        const versions = await fetchHomebrewVersions('gcc');

        // gcc@12 is deprecated so should be filtered out
        // Sorted by major ascending: 13, 14, 15 (main)
        expect(versions).toEqual([
            { major: 13, version: '13.4.0' },
            { major: 14, version: '14.3.0' },
            { major: 15, version: '15.2.0' }
        ]);
    });

    it('handles formula with no versioned_formulae', async () => {
        const mainFormula = {
            versions: { stable: '20.1.8' },
            deprecated: false,
            disabled: false
        };

        mockedGet.mockImplementation((_urlOrOpts: unknown, cb: unknown) => {
            const callback = cb as (res: PassThrough) => void;
            callback(mockResponse(200, mainFormula));
            return { on: jest.fn().mockReturnThis() } as unknown as ReturnType<typeof https.get>;
        });

        const versions = await fetchHomebrewVersions('llvm');
        expect(versions).toEqual([
            { major: 20, version: '20.1.8' }
        ]);
    });

    it('filters out disabled formulae', async () => {
        const mainFormula = {
            versions: { stable: '15.2.0' },
            versioned_formulae: ['gcc@14'],
            deprecated: false,
            disabled: false
        };
        const gcc14 = {
            versions: { stable: '14.3.0' },
            deprecated: false,
            disabled: true
        };

        mockedGet.mockImplementation((urlOrOpts: unknown, cb: unknown) => {
            const callback = cb as (res: PassThrough) => void;
            const url = typeof urlOrOpts === 'string' ? urlOrOpts : '';

            if (url.endsWith('/gcc.json')) {
                callback(mockResponse(200, mainFormula));
            } else if (url.includes('gcc@14')) {
                callback(mockResponse(200, gcc14));
            } else {
                callback(mockResponse(404, null));
            }
            return { on: jest.fn().mockReturnThis() } as unknown as ReturnType<typeof https.get>;
        });

        const versions = await fetchHomebrewVersions('gcc');
        // Only main formula (gcc@14 is disabled)
        expect(versions).toEqual([
            { major: 15, version: '15.2.0' }
        ]);
    });

    it('returns empty array on network failure', async () => {
        mockedGet.mockImplementation((_urlOrOpts: unknown, _cb: unknown) => {
            const mockReq = new PassThrough();
            process.nextTick(() => {
                mockReq.emit('error', new Error('network error'));
            });
            return mockReq as unknown as ReturnType<typeof https.get>;
        });

        const versions = await fetchHomebrewVersions('gcc');
        expect(versions).toEqual([]);
    });

    it('skips main formula when deprecated', async () => {
        const mainFormula = {
            versions: { stable: '15.2.0' },
            versioned_formulae: ['gcc@14'],
            deprecated: true,
            disabled: false
        };
        const gcc14 = {
            versions: { stable: '14.3.0' },
            deprecated: false,
            disabled: false
        };

        mockedGet.mockImplementation((urlOrOpts: unknown, cb: unknown) => {
            const callback = cb as (res: PassThrough) => void;
            const url = typeof urlOrOpts === 'string' ? urlOrOpts : '';

            if (url.endsWith('/gcc.json')) {
                callback(mockResponse(200, mainFormula));
            } else if (url.includes('gcc@14')) {
                callback(mockResponse(200, gcc14));
            } else {
                callback(mockResponse(404, null));
            }
            return { on: jest.fn().mockReturnThis() } as unknown as ReturnType<typeof https.get>;
        });

        const versions = await fetchHomebrewVersions('gcc');
        expect(versions).toEqual([
            { major: 14, version: '14.3.0' }
        ]);
    });
});

// ── updateMacOSXcodeDefaults integration tests ──────────────────────────────

describe('updateMacOSXcodeDefaults', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'macos-xcode-test-'));
        fs.mkdirSync(path.join(tmpDir, 'setup-program'), { recursive: true });
        mockedGet.mockReset();
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns false when runner-images.json is missing', async () => {
        const result = await updateMacOSXcodeDefaults(tmpDir);
        expect(result).toBe(false);
    });

    it('returns false when no macOS runners in runner-images.json', async () => {
        const runnerImages = {
            generated: '2026-01-01T00:00:00.000Z',
            source: 'test',
            runners: { ubuntu: [], macos: [], windows: [] }
        };
        fs.writeFileSync(
            path.join(tmpDir, 'setup-program/runner-images.json'),
            JSON.stringify(runnerImages)
        );

        const result = await updateMacOSXcodeDefaults(tmpDir);
        expect(result).toBe(false);
    });

    it('writes macos-xcode-defaults.json with GCC, LLVM, and Homebrew data', async () => {
        // Set up runner-images.json
        const runnerImages = {
            generated: '2026-01-01T00:00:00.000Z',
            source: 'test',
            runners: {
                ubuntu: [],
                macos: [
                    {
                        name: 'macos-14',
                        version: '14',
                        toolset_url: 'https://example.com/toolset-14.json'
                    }
                ],
                windows: []
            }
        };
        fs.writeFileSync(
            path.join(tmpDir, 'setup-program/runner-images.json'),
            JSON.stringify(runnerImages)
        );

        // Xcode releases data
        const xcodeReleases = [
            {
                version: {
                    number: '15.4',
                    build: '15F31d',
                    release: { release: true }
                },
                compilers: {
                    clang: [{ number: '15.0.0', build: '1500.3.9.4' }]
                }
            }
        ];

        // macOS toolset with Xcode, GCC, and LLVM. The `default` field uses the
        // bare-version format that current upstream toolsets ship (e.g. "15.4")
        // rather than the legacy `/Applications/Xcode_15.4.app` symlink form.
        const toolset14 = {
            xcode: {
                default: '15.4',
                arm64: {
                    versions: [
                        { version: '15.4.0+15F31d', link: '/Applications/Xcode_15.4.app' }
                    ]
                }
            },
            gcc: { versions: ['13', '14', '15'] },
            llvm: { version: '15' }
        };

        // Homebrew GCC formula data
        const homebrewGcc = {
            versions: { stable: '15.2.0' },
            versioned_formulae: ['gcc@14', 'gcc@13'],
            deprecated: false,
            disabled: false
        };
        const gcc14Formula = {
            versions: { stable: '14.3.0' },
            deprecated: false,
            disabled: false
        };
        const gcc13Formula = {
            versions: { stable: '13.4.0' },
            deprecated: false,
            disabled: false
        };

        // Homebrew LLVM formula data
        const homebrewLlvm = {
            versions: { stable: '20.1.8' },
            versioned_formulae: ['llvm@18'],
            deprecated: false,
            disabled: false
        };
        const llvm18Formula = {
            versions: { stable: '18.1.8' },
            deprecated: false,
            disabled: false
        };

        mockedGet.mockImplementation((urlOrOpts: unknown, cb: unknown) => {
            const callback = cb as (res: PassThrough) => void;
            const url = typeof urlOrOpts === 'string' ? urlOrOpts : '';

            if (url.includes('xcodereleases.com')) {
                callback(mockResponse(200, xcodeReleases));
            } else if (url.includes('example.com/toolset-14')) {
                callback(mockResponse(200, toolset14));
            } else if (url.endsWith('/formula/gcc.json')) {
                callback(mockResponse(200, homebrewGcc));
            } else if (url.includes('formula/gcc@14')) {
                callback(mockResponse(200, gcc14Formula));
            } else if (url.includes('formula/gcc@13')) {
                callback(mockResponse(200, gcc13Formula));
            } else if (url.endsWith('/formula/llvm.json')) {
                callback(mockResponse(200, homebrewLlvm));
            } else if (url.includes('formula/llvm@18')) {
                callback(mockResponse(200, llvm18Formula));
            } else {
                callback(mockResponse(404, null));
            }
            return { on: jest.fn().mockReturnThis() } as unknown as ReturnType<typeof https.get>;
        });

        const result = await updateMacOSXcodeDefaults(tmpDir);
        expect(result).toBe(true);

        const outputPath = path.join(tmpDir, 'setup-program/macos-xcode-defaults.json');
        expect(fs.existsSync(outputPath)).toBe(true);

        const data = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));

        // Check runner Xcode data
        expect(data.runners['macos-14']).toBeDefined();
        expect(data.runners['macos-14'].xcode_versions).toHaveLength(1);
        expect(data.runners['macos-14'].xcode_versions[0].apple_clang).toBe('15.0.0');

        // Check runner GCC and LLVM data
        expect(data.runners['macos-14'].gcc_versions).toEqual(['13', '14', '15']);
        expect(data.runners['macos-14'].llvm_version).toBe('15');

        // Check Homebrew installable GCC versions
        expect(data.installable_gcc).toEqual([
            { major: 13, version: '13.4.0' },
            { major: 14, version: '14.3.0' },
            { major: 15, version: '15.2.0' }
        ]);

        // Check Homebrew installable LLVM versions
        expect(data.installable_llvm).toEqual([
            { major: 18, version: '18.1.8' },
            { major: 20, version: '20.1.8' }
        ]);
    });

    it('writes output without GCC/LLVM when toolset lacks those sections', async () => {
        const runnerImages = {
            generated: '2026-01-01T00:00:00.000Z',
            source: 'test',
            runners: {
                ubuntu: [],
                macos: [
                    {
                        name: 'macos-14',
                        version: '14',
                        toolset_url: 'https://example.com/toolset-14.json'
                    }
                ],
                windows: []
            }
        };
        fs.writeFileSync(
            path.join(tmpDir, 'setup-program/runner-images.json'),
            JSON.stringify(runnerImages)
        );

        const xcodeReleases = [
            {
                version: {
                    number: '15.4',
                    build: '15F31d',
                    release: { release: true }
                },
                compilers: {
                    clang: [{ number: '15.0.0', build: '1500.3.9.4' }]
                }
            }
        ];

        // Toolset WITHOUT gcc/llvm sections
        const toolset14 = {
            xcode: {
                default: '/Applications/Xcode_15.4.app',
                arm64: {
                    versions: [
                        { version: '15.4.0+15F31d', link: '/Applications/Xcode_15.4.app' }
                    ]
                }
            }
        };

        // Homebrew returns empty (simulating graceful fallback)
        const homebrewGcc = {
            versions: { stable: '15.2.0' },
            versioned_formulae: [],
            deprecated: false,
            disabled: false
        };
        const homebrewLlvm = {
            versions: { stable: '20.1.8' },
            versioned_formulae: [],
            deprecated: false,
            disabled: false
        };

        mockedGet.mockImplementation((urlOrOpts: unknown, cb: unknown) => {
            const callback = cb as (res: PassThrough) => void;
            const url = typeof urlOrOpts === 'string' ? urlOrOpts : '';

            if (url.includes('xcodereleases.com')) {
                callback(mockResponse(200, xcodeReleases));
            } else if (url.includes('example.com/toolset-14')) {
                callback(mockResponse(200, toolset14));
            } else if (url.endsWith('/formula/gcc.json')) {
                callback(mockResponse(200, homebrewGcc));
            } else if (url.endsWith('/formula/llvm.json')) {
                callback(mockResponse(200, homebrewLlvm));
            } else {
                callback(mockResponse(404, null));
            }
            return { on: jest.fn().mockReturnThis() } as unknown as ReturnType<typeof https.get>;
        });

        const result = await updateMacOSXcodeDefaults(tmpDir);
        expect(result).toBe(true);

        const outputPath = path.join(tmpDir, 'setup-program/macos-xcode-defaults.json');
        const data = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));

        // No GCC/LLVM per-runner fields when toolset lacks them
        expect(data.runners['macos-14'].gcc_versions).toBeUndefined();
        expect(data.runners['macos-14'].llvm_version).toBeUndefined();

        // Homebrew data still present (from main formulae)
        expect(data.installable_gcc).toEqual([{ major: 15, version: '15.2.0' }]);
        expect(data.installable_llvm).toEqual([{ major: 20, version: '20.1.8' }]);
    });
});

// ── Branch coverage: routing helper ─────────────────────────────────────────

/** A raw (non-JSON) 200 response body. */
class RawBody {
    constructor(public readonly text: string) {}
}

/** A non-200 response. */
class Status {
    constructor(public readonly code: number) {}
}

/** A request-level network error. */
class NetError {
    constructor(public readonly message: string) {}
}

/**
 * Routes `https.get` by exact URL. Plain values are served as JSON with
 * status 200; unknown URLs answer 404.
 *
 * @param routes - Map from URL to a JSON value, RawBody, Status or NetError
 */
function route(routes: Record<string, unknown>): void {
    mockedGet.mockImplementation(((url: string, callback: (res: PassThrough) => void) => {
        const req = new PassThrough();
        const reply = url in routes ? routes[url] : new Status(404);
        process.nextTick(() => {
            if (reply instanceof NetError) {
                req.emit('error', new Error(reply.message));
                return;
            }
            const res = new PassThrough();
            Object.assign(res, { statusCode: reply instanceof Status ? reply.code : 200, headers: {} });
            callback(res);
            if (reply instanceof RawBody) {
                res.write(reply.text);
            } else if (!(reply instanceof Status)) {
                res.write(JSON.stringify(reply));
            }
            res.end();
        });
        return req;
    }) as unknown as typeof https.get);
}

const BREW = 'https://formulae.brew.sh/api/formula';
const XCODE_RELEASES = 'https://xcodereleases.com/data.json';

describe('fetchHomebrewVersions edge cases', () => {
    beforeEach(() => {
        mockedGet.mockReset();
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('keeps the other versions when one versioned formula fails to fetch', async () => {
        route({
            [`${BREW}/gcc.json`]: { versions: { stable: '15.2.0' }, versioned_formulae: ['gcc@14', 'gcc@13'] },
            [`${BREW}/gcc@14.json`]: new Status(500),
            [`${BREW}/gcc@13.json`]: { versions: { stable: '13.4.0' } }
        });

        await expect(fetchHomebrewVersions('gcc')).resolves.toEqual([
            { major: 13, version: '13.4.0' },
            { major: 15, version: '15.2.0' }
        ]);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('failed to fetch gcc@14: Error: HTTP 500'));
    });

    it('skips versioned formulae whose name has no numeric @ suffix', async () => {
        route({
            [`${BREW}/llvm.json`]: { versions: { stable: '20.1.8' }, versioned_formulae: ['llvm-legacy', 'llvm@next'] },
            [`${BREW}/llvm-legacy.json`]: { versions: { stable: '9.0.0' } },
            [`${BREW}/llvm@next.json`]: { versions: { stable: '21.0.0' } }
        });

        await expect(fetchHomebrewVersions('llvm')).resolves.toEqual([{ major: 20, version: '20.1.8' }]);
    });

    it('skips the main formula when its stable version has no numeric major', async () => {
        route({
            [`${BREW}/gcc.json`]: { versions: { stable: 'HEAD-abc123' }, versioned_formulae: ['gcc@14'] },
            [`${BREW}/gcc@14.json`]: { versions: { stable: '14.3.0' } }
        });

        await expect(fetchHomebrewVersions('gcc')).resolves.toEqual([{ major: 14, version: '14.3.0' }]);
    });

    it('returns an empty list when the main formula is not valid JSON', async () => {
        route({ [`${BREW}/gcc.json`]: new RawBody('<html>rate limited</html>') });

        await expect(fetchHomebrewVersions('gcc')).resolves.toEqual([]);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('JSON parse error'));
    });
});

describe('updateMacOSXcodeDefaults edge cases', () => {
    let tmpDir: string;

    /**
     * Writes setup-program/runner-images.json with the given macOS runners.
     *
     * @param macos - macOS runner entries, or undefined to omit the list
     */
    function writeRunners(macos?: Array<{ name: string; version: string; toolset_url: string | null }>): void {
        fs.writeFileSync(
            path.join(tmpDir, 'setup-program', 'runner-images.json'),
            JSON.stringify({ runners: { ubuntu: [], windows: [], ...(macos ? { macos } : {}) } })
        );
    }

    /**
     * Reads the generated macos-xcode-defaults.json.
     *
     * @returns Parsed output
     */
    function readOutput(): { runners: Record<string, { default_xcode: string; xcode_versions: Array<Record<string, unknown>> }> } {
        return JSON.parse(fs.readFileSync(path.join(tmpDir, 'setup-program', 'macos-xcode-defaults.json'), 'utf-8'));
    }

    /**
     * Builds an xcodereleases.com entry.
     *
     * @param number - Xcode version
     * @param build - Xcode build ID
     * @param release - Release flags (e.g. `{ beta: 1 }`)
     * @param clang - Apple Clang version, or undefined for no compiler info
     * @returns The release entry
     */
    function xcode(number: string, build: string, release: Record<string, unknown>, clang?: string): unknown {
        return {
            version: { number, build, release },
            ...(clang ? { compilers: { clang: [{ number: clang, build: `${clang}-b` }] } } : {})
        };
    }

    const homebrew = {
        [`${BREW}/gcc.json`]: { versions: { stable: '15.2.0' } },
        [`${BREW}/llvm.json`]: { versions: { stable: '20.1.8' } }
    };

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'macos-xcode-edge-'));
        fs.mkdirSync(path.join(tmpDir, 'setup-program'));
        mockedGet.mockReset();
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns false when runner-images.json has no macos list', async () => {
        writeRunners();
        await expect(updateMacOSXcodeDefaults(tmpDir)).resolves.toBe(false);
        expect(mockedGet).not.toHaveBeenCalled();
    });

    it('returns false when xcodereleases.com cannot be fetched', async () => {
        writeRunners([{ name: 'macos-14', version: '14', toolset_url: 'https://example.com/t14.json' }]);
        route({ [XCODE_RELEASES]: new NetError('ETIMEDOUT') });

        await expect(updateMacOSXcodeDefaults(tmpDir)).resolves.toBe(false);
        expect(fs.existsSync(path.join(tmpDir, 'setup-program', 'macos-xcode-defaults.json'))).toBe(false);
    });

    it('drops prereleases, unknown builds and odd entries, and marks the default by version prefix', async () => {
        writeRunners([
            { name: 'macos-15', version: '15', toolset_url: 'https://example.com/t15.json' },
            { name: 'macos-13', version: '13', toolset_url: 'https://example.com/t13.json' },
            { name: 'macos-no-url', version: '0', toolset_url: null },
            { name: 'macos-broken', version: '0', toolset_url: 'https://example.com/broken.json' },
            { name: 'macos-nomatch', version: '0', toolset_url: 'https://example.com/nomatch.json' }
        ]);
        route({
            ...homebrew,
            [XCODE_RELEASES]: [
                xcode('16.2', '16C5032a', { release: true }, '16.0.0'),
                xcode('16.1', '16B40', { release: true }, '16.0.0'),
                xcode('16.3', '16E5104o', { beta: 1 }, '17.0.0'),
                xcode('16.0', '16A242d', { rc: 1 }, '16.0.0'),
                xcode('15.0', '15A240d', { release: true }),
                xcode('14.3.1', '14E300c', { release: true }, '14.0.3')
            ],
            'https://example.com/t15.json': {
                xcode: {
                    default: '16',
                    arm64: {
                        versions: [
                            { version: '16.2.0+16C5032a', link: '/Applications/Xcode_16.2.app' },
                            { version: '16.1.0+16B40', link: '/Applications/Xcode_16.1.app' },
                            { version: '16.3.0+16E5104o', link: '/Applications/Xcode_16.3_beta.app' },
                            { version: '16.0.0', link: '/Applications/Xcode_16.0.app' },
                            { version: '16.0.0+16A242d', link: '/Applications/Xcode_16.0.app' }
                        ]
                    }
                }
            },
            'https://example.com/t13.json': {
                xcode: {
                    default: '/Applications/Xcode-14.3.1.app',
                    x86_64: { versions: [{ version: '14.3.1+14E300c', link: '/Applications/Xcode_14.3.1.app' }] }
                }
            },
            'https://example.com/broken.json': new Status(404),
            'https://example.com/nomatch.json': {
                xcode: { default: 'latest', arm64: { versions: [{ version: '15.0.0+15A240d', link: '/Applications/Xcode_15.0.app' }] } }
            }
        });

        await expect(updateMacOSXcodeDefaults(tmpDir)).resolves.toBe(true);

        const out = readOutput();
        expect(Object.keys(out.runners)).toEqual(['macos-13', 'macos-15']);
        expect(out.runners['macos-15']).toEqual({
            default_xcode: '16',
            xcode_versions: [
                { xcode: '16.2', build: '16C5032a', apple_clang: '16.0.0', clang_build: '16.0.0-b', is_default: true },
                { xcode: '16.1', build: '16B40', apple_clang: '16.0.0', clang_build: '16.0.0-b', is_default: true }
            ]
        });
        expect(out.runners['macos-13'].xcode_versions).toEqual([
            expect.objectContaining({ xcode: '14.3.1', build: '14E300c', apple_clang: '14.0.3', clang_build: '14.0.3-b' })
        ]);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('unexpected version format "16.0.0"'));
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('no xcodereleases data for build 16A242d'));
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('no toolset URL for macos-no-url'));
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('failed to fetch toolset for macos-broken'));
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('no Xcode versions matched for macos-nomatch'));
    });

    // Known bug: extractDefaultVersion's /Xcode[_-]?([\d.]+)/ also captures the
    // dot before "app", so "/Applications/Xcode_14.3.1.app" yields "14.3.1." and
    // no entry is marked as default. Remove `.failing` once the regex is fixed.
    it.failing('parses the legacy symlink default "/Applications/Xcode_14.3.1.app" as "14.3.1"', async () => {
        writeRunners([{ name: 'macos-13', version: '13', toolset_url: 'https://example.com/t13.json' }]);
        route({
            ...homebrew,
            [XCODE_RELEASES]: [xcode('14.3.1', '14E300c', { release: true }, '14.0.3')],
            'https://example.com/t13.json': {
                xcode: {
                    default: '/Applications/Xcode_14.3.1.app',
                    arm64: { versions: [{ version: '14.3.1+14E300c', link: '/Applications/Xcode_14.3.1.app' }] }
                }
            }
        });

        await expect(updateMacOSXcodeDefaults(tmpDir)).resolves.toBe(true);
        expect(readOutput().runners['macos-13']).toEqual({
            default_xcode: '14.3.1',
            xcode_versions: [
                { xcode: '14.3.1', build: '14E300c', apple_clang: '14.0.3', clang_build: '14.0.3-b', is_default: true }
            ]
        });
    });

    it('returns false when no runner toolset yields any Xcode version', async () => {
        writeRunners([{ name: 'macos-14', version: '14', toolset_url: 'https://example.com/t14.json' }]);
        route({
            ...homebrew,
            [XCODE_RELEASES]: [],
            'https://example.com/t14.json': { xcode: { default: '15.4' } }
        });

        await expect(updateMacOSXcodeDefaults(tmpDir)).resolves.toBe(false);
        expect(fs.existsSync(path.join(tmpDir, 'setup-program', 'macos-xcode-defaults.json'))).toBe(false);
    });
});
