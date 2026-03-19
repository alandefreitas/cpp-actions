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

        // macOS toolset with Xcode, GCC, and LLVM
        const toolset14 = {
            xcode: {
                default: '/Applications/Xcode_15.4.app',
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
