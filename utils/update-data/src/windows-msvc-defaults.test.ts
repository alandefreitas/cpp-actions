jest.mock('https');

import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PassThrough } from 'stream';

import {
    extractExplicitPins,
    extractGenerationGroups,
    deriveMsvcFromChannelManifest,
    discoverMsvcVersions,
    fetchToolsetDirectory,
    updateWindowsMsvcDefaults
} from './windows-msvc-defaults';

const mockedGet = https.get as jest.MockedFunction<typeof https.get>;

// ── Helper ──────────────────────────────────────────────────────────────────

/**
 * Creates a mock HTTPS response with the given status and body.
 *
 * @param statusCode - HTTP status code
 * @param body - Response body object to serialize as JSON
 * @param headers - Optional response headers
 * @returns Mock response stream
 */
function mockResponse(
    statusCode: number,
    body: unknown,
    headers?: Record<string, string>
): PassThrough {
    const stream = new PassThrough();
    Object.assign(stream, { statusCode, headers: headers || {} });
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

// ── extractExplicitPins ─────────────────────────────────────────────────────

describe('extractExplicitPins', () => {
    it('extracts MSVC version from explicit pin component IDs', () => {
        const workloads = [
            'Microsoft.VisualStudio.Component.VC.14.44.17.14.x86.x64',
            'Microsoft.VisualStudio.Component.VC.14.38.17.8.x86.x64',
            'Microsoft.VisualStudio.Component.VC.Tools.x86.x64'
        ];
        expect(extractExplicitPins(workloads)).toEqual(['14.44', '14.38']);
    });

    it('returns empty array when no explicit pins exist', () => {
        const workloads = [
            'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
            'Microsoft.VisualStudio.Workload.NativeDesktop'
        ];
        expect(extractExplicitPins(workloads)).toEqual([]);
    });
});

// ── extractGenerationGroups ─────────────────────────────────────────────────

describe('extractGenerationGroups', () => {
    it('extracts generation from component group IDs', () => {
        const workloads = [
            'Microsoft.VisualStudio.ComponentGroup.VC.Tools.142.x86.x64',
            'Microsoft.VisualStudio.Component.VC.Tools.x86.x64'
        ];
        expect(extractGenerationGroups(workloads)).toEqual(['142']);
    });

    it('returns empty array when no generation groups exist', () => {
        const workloads = [
            'Microsoft.VisualStudio.Component.VC.Tools.x86.x64'
        ];
        expect(extractGenerationGroups(workloads)).toEqual([]);
    });
});

// ── deriveMsvcFromChannelManifest ───────────────────────────────────────────

describe('deriveMsvcFromChannelManifest', () => {
    beforeEach(() => {
        mockedGet.mockReset();
    });

    it('derives MSVC version from channel manifest via redirect', async () => {
        const manifest = {
            info: { productDisplayVersion: '17.14.29 (March 2026)' }
        };

        mockedGet.mockImplementation((urlOrOpts: unknown, cb: unknown) => {
            const callback = cb as (res: PassThrough) => void;
            const url = typeof urlOrOpts === 'string' ? urlOrOpts : '';

            if (url.includes('aka.ms')) {
                callback(mockResponse(301, null, {
                    location: 'https://download.visualstudio.microsoft.com/channel.json'
                }));
            } else {
                callback(mockResponse(200, manifest));
            }
            return { on: jest.fn().mockReturnThis() } as unknown as ReturnType<typeof https.get>;
        });

        const result = await deriveMsvcFromChannelManifest('17');
        expect(result).toBe('14.44');
    });

    it('returns null when redirect goes to unexpected host', async () => {
        mockedGet.mockImplementation((_urlOrOpts: unknown, cb: unknown) => {
            const callback = cb as (res: PassThrough) => void;
            callback(mockResponse(302, null, {
                location: 'https://www.bing.com/'
            }));
            return { on: jest.fn().mockReturnThis() } as unknown as ReturnType<typeof https.get>;
        });

        const result = await deriveMsvcFromChannelManifest('18');
        expect(result).toBeNull();
    });

    it('returns null when fetch fails', async () => {
        mockedGet.mockImplementation((_urlOrOpts: unknown, _cb: unknown) => {
            const mockReq = new PassThrough();
            process.nextTick(() => {
                mockReq.emit('error', new Error('network error'));
            });
            return mockReq as unknown as ReturnType<typeof https.get>;
        });

        // Even with error, deriveMsvcFromChannelManifest catches and returns null
        const result = await deriveMsvcFromChannelManifest('17');
        expect(result).toBeNull();
    });

    it('returns null when manifest has no productDisplayVersion', async () => {
        const manifest = { info: {} };

        mockedGet.mockImplementation((urlOrOpts: unknown, cb: unknown) => {
            const callback = cb as (res: PassThrough) => void;
            const url = typeof urlOrOpts === 'string' ? urlOrOpts : '';

            if (url.includes('aka.ms')) {
                callback(mockResponse(301, null, {
                    location: 'https://download.visualstudio.microsoft.com/channel.json'
                }));
            } else {
                callback(mockResponse(200, manifest));
            }
            return { on: jest.fn().mockReturnThis() } as unknown as ReturnType<typeof https.get>;
        });

        const result = await deriveMsvcFromChannelManifest('17');
        expect(result).toBeNull();
    });
});

// ── discoverMsvcVersions ───────────────────────────────────────────────────

describe('discoverMsvcVersions', () => {
    beforeEach(() => {
        mockedGet.mockReset();
    });

    it('discovers explicit pins and frozen generations', async () => {
        // Mock channel manifest to return null (redirect to bing)
        mockedGet.mockImplementation((_urlOrOpts: unknown, cb: unknown) => {
            const callback = cb as (res: PassThrough) => void;
            callback(mockResponse(302, null, {
                location: 'https://www.bing.com/'
            }));
            return { on: jest.fn().mockReturnThis() } as unknown as ReturnType<typeof https.get>;
        });

        const toolset = {
            visualStudio: {
                version: '2022',
                subversion: '17',
                edition: 'Enterprise',
                channel: 'release',
                workloads: [
                    'Microsoft.VisualStudio.Component.VC.14.44.17.14.x86.x64',
                    'Microsoft.VisualStudio.Component.VC.14.38.17.8.x86.x64',
                    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
                    'Microsoft.VisualStudio.ComponentGroup.VC.Tools.142.x86.x64'
                ]
            }
        };

        const versions = await discoverMsvcVersions(toolset, true);

        // Should have: 14.44 (default from formula fallback using highest pin),
        // 14.38 (explicit pin), 14.29 (frozen v142)
        const versionStrings = versions.map(v => v.version).sort();
        expect(versionStrings).toContain('14.44');
        expect(versionStrings).toContain('14.38');
        expect(versionStrings).toContain('14.29');

        // 14.44 should be default (highest pin in primary toolset)
        const defaultVersion = versions.find(v => v.is_default);
        expect(defaultVersion?.version).toBe('14.44');
    });

    it('does not mark default for non-primary toolset files', async () => {
        const toolset = {
            visualStudio: {
                version: '2026',
                subversion: '18',
                edition: 'Enterprise',
                channel: 'release',
                workloads: [
                    'Microsoft.VisualStudio.Component.VC.14.50.18.0.x86.x64',
                    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64'
                ]
            }
        };

        const versions = await discoverMsvcVersions(toolset, false);
        expect(versions).toHaveLength(1);
        expect(versions[0].version).toBe('14.50');
        expect(versions[0].is_default).toBe(false);
    });
});

// ── fetchToolsetDirectory ───────────────────────────────────────────────────

describe('fetchToolsetDirectory', () => {
    beforeEach(() => {
        mockedGet.mockReset();
    });

    it('groups toolset files by runner version', async () => {
        const entries = [
            { name: 'toolset-2022.json', download_url: 'https://example.com/toolset-2022.json' },
            { name: 'toolset-2025.json', download_url: 'https://example.com/toolset-2025.json' },
            { name: 'toolset-2025-vs2026.json', download_url: 'https://example.com/toolset-2025-vs2026.json' },
            { name: 'README.md', download_url: null }
        ];

        mockedGet.mockImplementation((_opts: unknown, cb: unknown) => {
            const callback = cb as (res: PassThrough) => void;
            callback(mockResponse(200, entries));
            return { on: jest.fn().mockReturnThis() } as unknown as ReturnType<typeof https.get>;
        });

        const result = await fetchToolsetDirectory();

        expect(result.size).toBe(2);
        expect(result.get('2022')).toHaveLength(1);
        expect(result.get('2022')![0].isPrimary).toBe(true);
        expect(result.get('2025')).toHaveLength(2);

        const primary = result.get('2025')!.find(f => f.isPrimary);
        const extra = result.get('2025')!.find(f => !f.isPrimary);
        expect(primary).toBeDefined();
        expect(extra).toBeDefined();
    });

    it('throws on non-array response', async () => {
        mockedGet.mockImplementation((_opts: unknown, cb: unknown) => {
            const callback = cb as (res: PassThrough) => void;
            callback(mockResponse(200, { message: 'not an array' }));
            return { on: jest.fn().mockReturnThis() } as unknown as ReturnType<typeof https.get>;
        });

        await expect(fetchToolsetDirectory()).rejects.toThrow('not an array');
    });
});

// ── updateWindowsMsvcDefaults integration tests ─────────────────────────────

describe('updateWindowsMsvcDefaults', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msvc-defaults-test-'));
        fs.mkdirSync(path.join(tmpDir, 'setup-program'), { recursive: true });
        mockedGet.mockReset();
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns false when runner-images.json is missing', async () => {
        const result = await updateWindowsMsvcDefaults(tmpDir);
        expect(result).toBe(false);
    });

    it('returns false when no Windows runners in runner-images.json', async () => {
        const runnerImages = {
            generated: '2026-01-01T00:00:00.000Z',
            source: 'test',
            runners: { ubuntu: [], macos: [], windows: [] }
        };
        fs.writeFileSync(
            path.join(tmpDir, 'setup-program/runner-images.json'),
            JSON.stringify(runnerImages)
        );

        const result = await updateWindowsMsvcDefaults(tmpDir);
        expect(result).toBe(false);
    });

    it('writes windows-msvc-defaults.json with discovered versions', async () => {
        // Set up runner-images.json
        const runnerImages = {
            generated: '2026-01-01T00:00:00.000Z',
            source: 'test',
            runners: {
                ubuntu: [],
                macos: [],
                windows: [
                    {
                        name: 'windows-2022',
                        version: '2022',
                        toolset_url: 'https://example.com/toolset-2022.json'
                    }
                ]
            }
        };
        fs.writeFileSync(
            path.join(tmpDir, 'setup-program/runner-images.json'),
            JSON.stringify(runnerImages)
        );

        const toolset2022 = {
            visualStudio: {
                version: '2022',
                subversion: '17',
                edition: 'Enterprise',
                channel: 'release',
                workloads: [
                    'Microsoft.VisualStudio.Component.VC.14.44.17.14.x86.x64',
                    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
                    'Microsoft.VisualStudio.ComponentGroup.VC.Tools.142.x86.x64'
                ]
            }
        };

        // Directory listing for toolset files
        const dirListing = [
            { name: 'toolset-2022.json', download_url: 'https://example.com/toolset-2022.json' }
        ];

        // Channel manifest
        const channelManifest = {
            info: { productDisplayVersion: '17.14.29 (March 2026)' }
        };

        mockedGet.mockImplementation((urlOrOpts: unknown, cb: unknown) => {
            const callback = cb as (res: PassThrough) => void;
            const url = typeof urlOrOpts === 'string'
                ? urlOrOpts
                : (urlOrOpts as { path?: string; hostname?: string }).hostname
                    ? `https://${(urlOrOpts as { hostname: string; path: string }).hostname}${(urlOrOpts as { path: string }).path}`
                    : '';

            if (url.includes('api.github.com') && url.includes('windows/toolsets')) {
                callback(mockResponse(200, dirListing));
            } else if (url.includes('example.com/toolset-2022')) {
                callback(mockResponse(200, toolset2022));
            } else if (url.includes('aka.ms')) {
                callback(mockResponse(301, null, {
                    location: 'https://download.visualstudio.microsoft.com/channel.json'
                }));
            } else if (url.includes('download.visualstudio.microsoft.com')) {
                callback(mockResponse(200, channelManifest));
            } else {
                callback(mockResponse(404, null));
            }
            return { on: jest.fn().mockReturnThis() } as unknown as ReturnType<typeof https.get>;
        });

        const result = await updateWindowsMsvcDefaults(tmpDir);
        expect(result).toBe(true);

        const outputPath = path.join(tmpDir, 'setup-program/windows-msvc-defaults.json');
        expect(fs.existsSync(outputPath)).toBe(true);

        const data = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
        expect(data.runners['windows-2022']).toBeDefined();
        expect(data.runners['windows-2022'].msvc_versions.length).toBeGreaterThan(0);

        // Check that 14.44 is marked as default
        const defaultVersion = data.runners['windows-2022'].msvc_versions.find(
            (v: { is_default: boolean }) => v.is_default
        );
        expect(defaultVersion).toBeDefined();
        expect(defaultVersion.version).toBe('14.44');

        // Check that 14.29 (frozen v142) is present
        const v142 = data.runners['windows-2022'].msvc_versions.find(
            (v: { version: string }) => v.version === '14.29'
        );
        expect(v142).toBeDefined();
        expect(v142.vs_year).toBe('2019');
    });
});
