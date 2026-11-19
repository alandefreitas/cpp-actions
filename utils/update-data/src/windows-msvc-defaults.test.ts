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
    updateWindowsMsvcDefaults,
    parseChocolateyVersions,
    fetchChocolateyVersions,
    extractMingwVersion,
    extractLlvmVersion
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

/**
 * Creates a mock HTTPS response with the given status and raw text body.
 *
 * @param statusCode - HTTP status code
 * @param text - Response body as raw text
 * @returns Mock response stream
 */
function mockTextResponse(
    statusCode: number,
    text: string
): PassThrough {
    const stream = new PassThrough();
    Object.assign(stream, { statusCode, headers: {} });
    if (statusCode === 200) {
        process.nextTick(() => {
            stream.write(text);
            stream.end();
        });
    } else {
        process.nextTick(() => {
            stream.end();
        });
    }
    return stream;
}

// ── extractMingwVersion ─────────────────────────────────────────────────────

describe('extractMingwVersion', () => {
    it('extracts major version from mingw version pattern', () => {
        const toolset = {
            visualStudio: { version: '2022', subversion: '17', edition: 'Enterprise', channel: 'release', workloads: [] },
            mingw: { version: '14.*' }
        };
        expect(extractMingwVersion(toolset)).toBe('14');
    });

    it('extracts major from plain number string', () => {
        const toolset = {
            visualStudio: { version: '2022', subversion: '17', edition: 'Enterprise', channel: 'release', workloads: [] },
            mingw: { version: '15' }
        };
        expect(extractMingwVersion(toolset)).toBe('15');
    });

    it('returns null when mingw section is absent', () => {
        const toolset = {
            visualStudio: { version: '2022', subversion: '17', edition: 'Enterprise', channel: 'release', workloads: [] }
        };
        expect(extractMingwVersion(toolset)).toBeNull();
    });
});

// ── extractLlvmVersion ──────────────────────────────────────────────────────

describe('extractLlvmVersion', () => {
    it('extracts LLVM version string', () => {
        const toolset = {
            visualStudio: { version: '2022', subversion: '17', edition: 'Enterprise', channel: 'release', workloads: [] },
            llvm: { version: '20' }
        };
        expect(extractLlvmVersion(toolset)).toBe('20');
    });

    it('returns null when llvm section is absent', () => {
        const toolset = {
            visualStudio: { version: '2022', subversion: '17', edition: 'Enterprise', channel: 'release', workloads: [] }
        };
        expect(extractLlvmVersion(toolset)).toBeNull();
    });
});

// ── parseChocolateyVersions ─────────────────────────────────────────────────

describe('parseChocolateyVersions', () => {
    it('extracts approved non-prerelease versions from Atom XML', () => {
        const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <m:properties>
      <d:Version>14.2.0</d:Version>
      <d:IsApproved m:type="Edm.Boolean">true</d:IsApproved>
      <d:IsPrerelease m:type="Edm.Boolean">false</d:IsPrerelease>
    </m:properties>
  </entry>
  <entry>
    <m:properties>
      <d:Version>15.2.0</d:Version>
      <d:IsApproved m:type="Edm.Boolean">true</d:IsApproved>
      <d:IsPrerelease m:type="Edm.Boolean">false</d:IsPrerelease>
    </m:properties>
  </entry>
</feed>`;
        expect(parseChocolateyVersions(xml)).toEqual(['14.2.0', '15.2.0']);
    });

    it('filters out unapproved versions', () => {
        const xml = `<feed>
  <entry>
    <m:properties>
      <d:Version>14.2.0</d:Version>
      <d:IsApproved m:type="Edm.Boolean">false</d:IsApproved>
      <d:IsPrerelease m:type="Edm.Boolean">false</d:IsPrerelease>
    </m:properties>
  </entry>
  <entry>
    <m:properties>
      <d:Version>15.2.0</d:Version>
      <d:IsApproved m:type="Edm.Boolean">true</d:IsApproved>
      <d:IsPrerelease m:type="Edm.Boolean">false</d:IsPrerelease>
    </m:properties>
  </entry>
</feed>`;
        expect(parseChocolateyVersions(xml)).toEqual(['15.2.0']);
    });

    it('filters out prerelease versions', () => {
        const xml = `<feed>
  <entry>
    <m:properties>
      <d:Version>16.0.0-alpha1</d:Version>
      <d:IsApproved m:type="Edm.Boolean">true</d:IsApproved>
      <d:IsPrerelease m:type="Edm.Boolean">true</d:IsPrerelease>
    </m:properties>
  </entry>
</feed>`;
        expect(parseChocolateyVersions(xml)).toEqual([]);
    });

    it('returns empty array for XML with no entries', () => {
        const xml = `<?xml version="1.0"?><feed></feed>`;
        expect(parseChocolateyVersions(xml)).toEqual([]);
    });
});

// ── fetchChocolateyVersions ─────────────────────────────────────────────────

describe('fetchChocolateyVersions', () => {
    beforeEach(() => {
        mockedGet.mockReset();
    });

    it('fetches and parses Chocolatey package versions', async () => {
        const xml = `<feed>
  <entry>
    <m:properties>
      <d:Version>14.2.0</d:Version>
      <d:IsApproved m:type="Edm.Boolean">true</d:IsApproved>
      <d:IsPrerelease m:type="Edm.Boolean">false</d:IsPrerelease>
    </m:properties>
  </entry>
  <entry>
    <m:properties>
      <d:Version>15.2.0</d:Version>
      <d:IsApproved m:type="Edm.Boolean">true</d:IsApproved>
      <d:IsPrerelease m:type="Edm.Boolean">false</d:IsPrerelease>
    </m:properties>
  </entry>
</feed>`;

        mockedGet.mockImplementation((_urlOrOpts: unknown, cb: unknown) => {
            const callback = cb as (res: PassThrough) => void;
            callback(mockTextResponse(200, xml));
            return { on: jest.fn().mockReturnThis() } as unknown as ReturnType<typeof https.get>;
        });

        const versions = await fetchChocolateyVersions('mingw');
        expect(versions).toEqual(['14.2.0', '15.2.0']);
    });

    it('returns empty array on network failure', async () => {
        mockedGet.mockImplementation((_urlOrOpts: unknown, _cb: unknown) => {
            const mockReq = new PassThrough();
            process.nextTick(() => {
                mockReq.emit('error', new Error('network error'));
            });
            return mockReq as unknown as ReturnType<typeof https.get>;
        });

        const versions = await fetchChocolateyVersions('mingw');
        expect(versions).toEqual([]);
    });
});

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

        // 3 entries: windows-2022, windows-2025, windows-2025-vs2026
        expect(result.size).toBe(3);
        expect(result.get('windows-2022')).toHaveLength(1);
        expect(result.get('windows-2022')![0].isPrimary).toBe(true);
        expect(result.get('windows-2025')).toHaveLength(1);
        expect(result.get('windows-2025')![0].isPrimary).toBe(true);
        expect(result.get('windows-2025-vs2026')).toHaveLength(1);
        expect(result.get('windows-2025-vs2026')![0].isPrimary).toBe(false);
        expect(result.get('windows-2025-vs2026')![0].runnerName).toBe('windows-2025-vs2026');
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
        // Set up runner-images.json; windows-2022-vs2019 is not a supported label
        const runnerImages = {
            generated: '2026-01-01T00:00:00.000Z',
            source: 'test',
            supported_labels: ['windows-2022'],
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
            },
            mingw: { version: '14.*' },
            llvm: { version: '20' }
        };

        // Directory listing for toolset files
        const dirListing = [
            { name: 'toolset-2022.json', download_url: 'https://example.com/toolset-2022.json' },
            { name: 'toolset-2022-vs2019.json', download_url: 'https://example.com/toolset-2022-vs2019.json' }
        ];

        // Channel manifest
        const channelManifest = {
            info: { productDisplayVersion: '17.14.29 (March 2026)' }
        };

        // Chocolatey Atom XML responses
        const chocoMingwXml = `<feed>
  <entry><m:properties>
    <d:Version>14.2.0</d:Version>
    <d:IsApproved m:type="Edm.Boolean">true</d:IsApproved>
    <d:IsPrerelease m:type="Edm.Boolean">false</d:IsPrerelease>
  </m:properties></entry>
  <entry><m:properties>
    <d:Version>15.2.0</d:Version>
    <d:IsApproved m:type="Edm.Boolean">true</d:IsApproved>
    <d:IsPrerelease m:type="Edm.Boolean">false</d:IsPrerelease>
  </m:properties></entry>
</feed>`;

        const chocoLlvmXml = `<feed>
  <entry><m:properties>
    <d:Version>18.1.8</d:Version>
    <d:IsApproved m:type="Edm.Boolean">true</d:IsApproved>
    <d:IsPrerelease m:type="Edm.Boolean">false</d:IsPrerelease>
  </m:properties></entry>
  <entry><m:properties>
    <d:Version>20.1.8</d:Version>
    <d:IsApproved m:type="Edm.Boolean">true</d:IsApproved>
    <d:IsPrerelease m:type="Edm.Boolean">false</d:IsPrerelease>
  </m:properties></entry>
</feed>`;

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
            } else if (url.includes('chocolatey.org') && url.includes('mingw')) {
                callback(mockTextResponse(200, chocoMingwXml));
            } else if (url.includes('chocolatey.org') && url.includes('llvm')) {
                callback(mockTextResponse(200, chocoLlvmXml));
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
        // The suffixed runner outside the supported labels is left out
        expect(Object.keys(data.runners)).toEqual(['windows-2022']);
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

        // Check MinGW and LLVM per-runner data
        expect(data.runners['windows-2022'].mingw_version).toBe('14');
        expect(data.runners['windows-2022'].llvm_version).toBe('20');

        // Check Chocolatey installable versions
        expect(data.installable_mingw).toEqual(['14.2.0', '15.2.0']);
        expect(data.installable_llvm).toEqual(['18.1.8', '20.1.8']);
    });
});

// ── Branch coverage: routing helper ─────────────────────────────────────────

/** A mocked reply: JSON (status 200 unless given), raw text, or a network error. */
interface Reply {
    status?: number;
    json?: unknown;
    text?: string;
    location?: string;
    error?: string;
}

/** Request seen by the routing mock: the URL and the headers it was sent with. */
interface SeenRequest {
    url: string;
    headers: Record<string, string>;
}

/**
 * Routes `https.get` by exact URL (string or request options). Unknown URLs answer 404.
 *
 * @param routes - Map from URL to reply
 * @returns The list of requests seen, filled as requests arrive
 */
function route(routes: Record<string, Reply>): SeenRequest[] {
    const seen: SeenRequest[] = [];
    mockedGet.mockImplementation(((target: string | { hostname: string; path: string; headers?: Record<string, string> },
        callback: (res: PassThrough) => void) => {
        const url = typeof target === 'string' ? target : `https://${target.hostname}${target.path}`;
        seen.push({ url, headers: typeof target === 'string' ? {} : target.headers ?? {} });
        const reply: Reply = routes[url] ?? { status: 404 };
        const req = new PassThrough();
        process.nextTick(() => {
            if (reply.error) {
                req.emit('error', new Error(reply.error));
                return;
            }
            const res = new PassThrough();
            Object.assign(res, {
                statusCode: reply.status ?? 200,
                headers: reply.location !== undefined ? { location: reply.location } : {}
            });
            callback(res);
            if (reply.text !== undefined) {
                res.write(reply.text);
            } else if (reply.json !== undefined) {
                res.write(JSON.stringify(reply.json));
            }
            res.end();
        });
        return req;
    }) as unknown as typeof https.get);
    return seen;
}

const TOOLSETS_API = 'https://api.github.com/repos/actions/runner-images/contents/images/windows/toolsets';
const CDN = 'https://download.visualstudio.microsoft.com/channel.json';

/**
 * Builds the aka.ms channel URL for a VS major version.
 *
 * @param vs - VS IDE major version
 * @returns Channel manifest URL
 */
const akaMs = (vs: string): string => `https://aka.ms/vs/${vs}/release/channel`;

/**
 * Builds a channel manifest reply with the given display version.
 *
 * @param display - productDisplayVersion value
 * @returns JSON reply
 */
const manifest = (display: string): Reply => ({ json: { info: { productDisplayVersion: display } } });

/**
 * Builds a minimal Windows toolset JSON.
 *
 * @param subversion - VS IDE major version
 * @param workloads - Workload component IDs
 * @returns Toolset object
 */
function toolset(subversion: string, workloads: string[]): { visualStudio: { version: string; subversion: string; edition: string; channel: string; workloads: string[] } } {
    return { visualStudio: { version: '2022', subversion, edition: 'Enterprise', channel: 'release', workloads } };
}

/**
 * Builds a component ID that pins an explicit MSVC version.
 *
 * @param msvc - MSVC version (e.g. "14.44")
 * @returns Component ID
 */
const pin = (msvc: string): string => `Microsoft.VisualStudio.Component.VC.${msvc}.17.14.x86.x64`;

/**
 * Builds a component group ID for an MSVC generation.
 *
 * @param gen - Generation (e.g. "142")
 * @returns Component group ID
 */
const group = (gen: string): string => `Microsoft.VisualStudio.ComponentGroup.VC.Tools.${gen}.x86.x64`;

describe('deriveMsvcFromChannelManifest edge cases', () => {
    beforeEach(() => mockedGet.mockReset());

    it('reads a manifest served directly without a redirect', async () => {
        route({ [akaMs('18')]: manifest('18.0.1 (November 2025)') });
        await expect(deriveMsvcFromChannelManifest('18')).resolves.toBe('14.50');
    });

    it.each<[string, Record<string, Reply>]>([
        ['a redirect without Location', { [akaMs('17')]: { status: 302, location: '' } }],
        ['an unparseable redirect Location', { [akaMs('17')]: { status: 301, location: 'not a url' } }],
        ['a redirect target that answers 404', { [akaMs('17')]: { status: 301, location: CDN }, [CDN]: { status: 404 } }],
        ['a redirect target that is not JSON', { [akaMs('17')]: { status: 301, location: CDN }, [CDN]: { text: '<html>' } }],
        ['a redirect target that fails at the network level', { [akaMs('17')]: { status: 301, location: CDN }, [CDN]: { error: 'ECONNRESET' } }],
        ['a direct 500 response', { [akaMs('17')]: { status: 500 } }],
        ['a direct non-JSON response', { [akaMs('17')]: { text: 'oops' } }],
        ['a non-numeric productDisplayVersion', { [akaMs('17')]: manifest('Preview 3') }],
        ['a VS major without a known MSVC offset', { [akaMs('17')]: manifest('15.9.60') }]
    ])('returns null for %s', async (_label, routes) => {
        route(routes);
        await expect(deriveMsvcFromChannelManifest('17')).resolves.toBeNull();
    });
});

describe('discoverMsvcVersions default selection', () => {
    beforeEach(() => mockedGet.mockReset());

    it('falls back to the highest explicit pin of the same VS generation when the manifest is unavailable', async () => {
        route({ [akaMs('17')]: { error: 'ENOTFOUND' } });
        const versions = await discoverMsvcVersions(
            toolset('17', [pin('14.29'), pin('14.38'), pin('14.44'), pin('14.50')]),
            true
        );
        expect(versions.filter(v => v.is_default).map(v => v.version)).toEqual(['14.44']);
        expect(versions.map(v => v.version)).toEqual(['14.29', '14.38', '14.44', '14.50']);
    });

    it('treats the newest VS generation as unbounded above', async () => {
        route({});
        const versions = await discoverMsvcVersions(toolset('18', [pin('14.50'), pin('14.51')]), true);
        expect(versions.find(v => v.is_default)?.version).toBe('14.51');
    });

    it('leaves no default when no pin belongs to the generation', async () => {
        route({});
        const versions = await discoverMsvcVersions(toolset('17', [pin('14.29')]), true);
        expect(versions).toEqual([{ version: '14.29', vs_year: '2022', is_default: false }]);
    });

    it('leaves no default for a VS major without a known offset', async () => {
        route({});
        const versions = await discoverMsvcVersions(toolset('15', [pin('14.16')]), true);
        expect(versions.some(v => v.is_default)).toBe(false);
    });

    it('adds the manifest version as default when no pin matches it', async () => {
        route({ [akaMs('17')]: manifest('17.14.29 (March 2026)') });
        const versions = await discoverMsvcVersions(toolset('17', [pin('14.38'), group('142'), group('143')]), true);
        expect(versions).toEqual([
            { version: '14.38', vs_year: '2022', is_default: false },
            { version: '14.44', vs_year: '2022', is_default: true },
            { version: '14.29', vs_year: '2019', is_default: false }
        ]);
    });
});

describe('fetchToolsetDirectory edge cases', () => {
    beforeEach(() => mockedGet.mockReset());

    it('sends the token as an Authorization header and skips unrelated entries', async () => {
        const seen = route({
            [TOOLSETS_API]: {
                json: [
                    { name: 'toolset-2025.json', download_url: 'https://example.com/2025.json' },
                    { name: 'toolset-2025-vs2026.json', download_url: 'https://example.com/2025-vs2026.json' },
                    { name: 'toolset-2019.json', download_url: null },
                    { name: 'README.md', download_url: 'https://example.com/README.md' }
                ]
            }
        });

        const dir = await fetchToolsetDirectory('secret-token');

        expect(seen[0].headers['Authorization']).toBe('token secret-token');
        expect([...dir.keys()]).toEqual(['windows-2025', 'windows-2025-vs2026']);
        expect(dir.get('windows-2025-vs2026')).toEqual([{
            runnerVersion: '2025',
            runnerName: 'windows-2025-vs2026',
            isPrimary: false,
            downloadUrl: 'https://example.com/2025-vs2026.json'
        }]);
    });

    it('rejects on a non-200 response', async () => {
        route({ [TOOLSETS_API]: { status: 403 } });
        await expect(fetchToolsetDirectory()).rejects.toThrow('HTTP 403');
    });

    it('rejects on a non-JSON body', async () => {
        route({ [TOOLSETS_API]: { text: 'rate limit exceeded' } });
        await expect(fetchToolsetDirectory()).rejects.toThrow('JSON parse error');
    });
});

describe('fetchChocolateyVersions edge cases', () => {
    beforeEach(() => {
        mockedGet.mockReset();
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => jest.restoreAllMocks());

    it('returns an empty list on a non-200 response', async () => {
        route({ "https://community.chocolatey.org/api/v2/FindPackagesById()?id='mingw'": { status: 406 } });
        await expect(fetchChocolateyVersions('mingw')).resolves.toEqual([]);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 406'));
    });
});

describe('updateWindowsMsvcDefaults edge cases', () => {
    let tmpDir: string;
    let savedToken: string | undefined;

    /**
     * Writes setup-program/runner-images.json.
     *
     * @param windows - Windows runner entries, or undefined to omit the list
     * @param supportedLabels - Optional supported_labels list
     */
    function writeRunners(windows?: Array<{ name: string; version: string; toolset_url: string | null }>, supportedLabels?: string[]): void {
        fs.writeFileSync(path.join(tmpDir, 'setup-program', 'runner-images.json'), JSON.stringify({
            ...(supportedLabels ? { supported_labels: supportedLabels } : {}),
            runners: { ubuntu: [], macos: [], ...(windows ? { windows } : {}) }
        }));
    }

    const outputPath = (): string => path.join(tmpDir, 'setup-program', 'windows-msvc-defaults.json');

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msvc-edge-'));
        fs.mkdirSync(path.join(tmpDir, 'setup-program'));
        mockedGet.mockReset();
        savedToken = process.env.GITHUB_TOKEN;
        delete process.env.GITHUB_TOKEN;
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        if (savedToken === undefined) {
            delete process.env.GITHUB_TOKEN;
        } else {
            process.env.GITHUB_TOKEN = savedToken;
        }
        jest.restoreAllMocks();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns false when runner-images.json has no windows list', async () => {
        writeRunners();
        await expect(updateWindowsMsvcDefaults(tmpDir)).resolves.toBe(false);
    });

    it('adds suffixed runners from the directory listing when there is no supported-label list', async () => {
        process.env.GITHUB_TOKEN = 'env-token';
        writeRunners([{ name: 'windows-2025', version: '2025', toolset_url: 'https://example.com/2025.json' }]);
        const seen = route({
            [TOOLSETS_API]: {
                json: [
                    { name: 'toolset-2025.json', download_url: 'https://example.com/2025.json' },
                    { name: 'toolset-2025-vs2026.json', download_url: 'https://example.com/2025-vs2026.json' }
                ]
            },
            'https://example.com/2025.json': { json: toolset('17', [pin('14.44'), group('142')]) },
            'https://example.com/2025-vs2026.json': { json: toolset('18', [pin('14.50'), pin('14.44')]) },
            [akaMs('17')]: manifest('17.14.29 (March 2026)')
        });

        await expect(updateWindowsMsvcDefaults(tmpDir)).resolves.toBe(true);

        expect(seen.find(r => r.url === TOOLSETS_API)?.headers['Authorization']).toBe('token env-token');
        const data = JSON.parse(fs.readFileSync(outputPath(), 'utf-8'));
        expect(data.runners).toEqual({
            'windows-2025': {
                msvc_versions: [
                    { version: '14.44', vs_year: '2022', is_default: true },
                    { version: '14.29', vs_year: '2019', is_default: false }
                ]
            },
            'windows-2025-vs2026': {
                msvc_versions: [
                    { version: '14.50', vs_year: '2022', is_default: false },
                    { version: '14.44', vs_year: '2022', is_default: false }
                ]
            }
        });
        expect(data.installable_mingw).toEqual([]);
        expect(data.installable_llvm).toEqual([]);
    });

    it('takes the toolset of a runner without toolset_url from the directory listing', async () => {
        writeRunners([{ name: 'windows-2025', version: '2025', toolset_url: null }]);
        route({
            [TOOLSETS_API]: {
                json: [
                    { name: 'toolset-2025-vs2026.json', download_url: 'https://example.com/a.json' },
                    { name: 'toolset-2025.json', download_url: 'https://example.com/b.json' }
                ]
            },
            'https://example.com/a.json': { json: toolset('18', [pin('14.44')]) },
            'https://example.com/b.json': { json: toolset('17', [pin('14.44')]) }
        });

        await expect(updateWindowsMsvcDefaults(tmpDir)).resolves.toBe(true);

        const data = JSON.parse(fs.readFileSync(outputPath(), 'utf-8'));
        expect(data.runners).toEqual({
            'windows-2025': { msvc_versions: [{ version: '14.44', vs_year: '2022', is_default: true }] },
            'windows-2025-vs2026': { msvc_versions: [{ version: '14.44', vs_year: '2022', is_default: false }] }
        });
    });

    it('falls back to runner-images.json when the directory listing fails, and returns false if no toolset loads', async () => {
        writeRunners([
            { name: 'windows-2022', version: '2022', toolset_url: 'https://example.com/2022.json' },
            { name: 'windows-2019', version: '2019', toolset_url: null }
        ]);
        route({
            [TOOLSETS_API]: { error: 'ENOTFOUND' },
            'https://example.com/2022.json': { status: 500 }
        });

        await expect(updateWindowsMsvcDefaults(tmpDir)).resolves.toBe(false);

        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('failed to fetch toolset directory'));
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('failed to process https://example.com/2022.json'));
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('no MSVC versions discovered for windows-2022'));
        expect(fs.existsSync(outputPath())).toBe(false);
    });
});
