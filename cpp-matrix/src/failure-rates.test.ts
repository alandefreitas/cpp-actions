jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn()),
    setTraceCommands: jest.fn()
}));

jest.mock('@actions/http-client', () => ({
    HttpClient: jest.fn()
}));

import * as httpClient from '@actions/http-client';
import { fetchFailureRates, sortByFailureRate, type FailureRates } from './failure-rates';
import type { MatrixEntry } from './types';

const MockHttpClient = httpClient.HttpClient as jest.MockedClass<typeof httpClient.HttpClient>;

/**
 * Creates a minimal MatrixEntry for testing.
 *
 * @param name - Display name for the entry
 * @param overrides - Additional fields to set
 * @returns A MatrixEntry with required defaults
 */
function makeEntry(name: string, overrides: Partial<MatrixEntry> = {}): MatrixEntry {
    return {
        name,
        compiler: 'gcc',
        version: '13',
        env: {},
        'is-latest': false,
        'is-main': false,
        'is-earliest': false,
        'is-intermediary': false,
        'has-major': false,
        'has-minor': false,
        'has-patch': false,
        'subrange-policy': 'one-per-major',
        ...overrides
    };
}

/**
 * Creates a mock HTTP client with configurable GET responses.
 *
 * @param responses - Map of URL substrings to response objects
 * @returns Mocked HttpClient instance
 */
function setupMockClient(responses: { [urlMatch: string]: { statusCode: number; body: string } }): void {
    const mockGet = jest.fn().mockImplementation(async (url: string) => {
        for (const [match, response] of Object.entries(responses)) {
            if (url.includes(match)) {
                return {
                    message: { statusCode: response.statusCode },
                    readBody: async () => response.body
                };
            }
        }
        return { message: { statusCode: 404 }, readBody: async () => '{}' };
    });
    MockHttpClient.mockImplementation(() => ({ get: mockGet }) as unknown as httpClient.HttpClient);
}

describe('fetchFailureRates', () => {
    const origEnv = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.GITHUB_TOKEN = 'test-token';
        process.env.GITHUB_REPOSITORY = 'owner/repo';
        process.env.GITHUB_WORKFLOW_REF = 'owner/repo/.github/workflows/ci.yml@refs/heads/main';
    });

    afterEach(() => {
        process.env = { ...origEnv };
    });

    it('returns null when no token is provided and GITHUB_TOKEN is unset', async () => {
        delete process.env.GITHUB_TOKEN;
        const result = await fetchFailureRates(10, '');
        expect(result).toBeNull();
    });

    it('returns null when GITHUB_REPOSITORY is not set', async () => {
        delete process.env.GITHUB_REPOSITORY;
        const result = await fetchFailureRates(10, 'my-token');
        expect(result).toBeNull();
    });

    it('returns null when GITHUB_WORKFLOW_REF is not set', async () => {
        delete process.env.GITHUB_WORKFLOW_REF;
        const result = await fetchFailureRates(10, 'my-token');
        expect(result).toBeNull();
    });

    it('returns null when GITHUB_WORKFLOW_REF has invalid format', async () => {
        process.env.GITHUB_WORKFLOW_REF = 'invalid-format';
        const result = await fetchFailureRates(10, 'my-token');
        expect(result).toBeNull();
    });

    it('uses explicit token over GITHUB_TOKEN env var', async () => {
        setupMockClient({
            '/actions/workflows/': {
                statusCode: 200,
                body: JSON.stringify({ workflow_runs: [] })
            }
        });
        const result = await fetchFailureRates(10, 'explicit-token');
        expect(result).toBeNull(); // null because no runs
        expect(MockHttpClient).toHaveBeenCalledWith('cpp-matrix', [], expect.objectContaining({
            headers: expect.objectContaining({
                'Authorization': 'token explicit-token'
            })
        }));
    });

    it('falls back to GITHUB_TOKEN when token param is empty', async () => {
        setupMockClient({
            '/actions/workflows/': {
                statusCode: 200,
                body: JSON.stringify({ workflow_runs: [] })
            }
        });
        await fetchFailureRates(10, '');
        expect(MockHttpClient).toHaveBeenCalledWith('cpp-matrix', [], expect.objectContaining({
            headers: expect.objectContaining({
                'Authorization': 'token test-token'
            })
        }));
    });

    it('returns null when runs API returns non-200', async () => {
        setupMockClient({
            '/actions/workflows/': { statusCode: 403, body: '{}' }
        });
        const result = await fetchFailureRates(10, 'my-token');
        expect(result).toBeNull();
    });

    it('returns null when no completed runs found', async () => {
        setupMockClient({
            '/actions/workflows/': {
                statusCode: 200,
                body: JSON.stringify({ workflow_runs: [] })
            }
        });
        const result = await fetchFailureRates(10, 'my-token');
        expect(result).toBeNull();
    });

    it('calculates failure rates from workflow runs', async () => {
        const mockGet = jest.fn()
            .mockResolvedValueOnce({
                message: { statusCode: 200 },
                readBody: async () => JSON.stringify({
                    workflow_runs: [{ id: 1, status: 'completed', conclusion: 'failure' }, { id: 2, status: 'completed', conclusion: 'success' }]
                })
            })
            .mockResolvedValueOnce({
                message: { statusCode: 200 },
                readBody: async () => JSON.stringify({
                    jobs: [
                        { name: 'build-gcc', conclusion: 'failure' },
                        { name: 'build-clang', conclusion: 'success' }
                    ]
                })
            })
            .mockResolvedValueOnce({
                message: { statusCode: 200 },
                readBody: async () => JSON.stringify({
                    jobs: [
                        { name: 'build-gcc', conclusion: 'success' },
                        { name: 'build-clang', conclusion: 'success' }
                    ]
                })
            });

        MockHttpClient.mockImplementation(() => ({ get: mockGet }) as unknown as httpClient.HttpClient);

        const result = await fetchFailureRates(10, 'my-token');
        expect(result).not.toBeNull();
        expect(result!['build-gcc']).toBe(0.5); // 1 failure out of 2
        expect(result!['build-clang']).toBe(0); // 0 failures out of 2
    });

    it('skips jobs with null conclusion', async () => {
        const mockGet = jest.fn()
            .mockResolvedValueOnce({
                message: { statusCode: 200 },
                readBody: async () => JSON.stringify({
                    workflow_runs: [{ id: 1, status: 'completed', conclusion: 'success' }]
                })
            })
            .mockResolvedValueOnce({
                message: { statusCode: 200 },
                readBody: async () => JSON.stringify({
                    jobs: [
                        { name: 'build-gcc', conclusion: null },
                        { name: 'build-clang', conclusion: 'success' }
                    ]
                })
            });

        MockHttpClient.mockImplementation(() => ({ get: mockGet }) as unknown as httpClient.HttpClient);

        const result = await fetchFailureRates(10, 'my-token');
        expect(result).not.toBeNull();
        expect(result!['build-gcc']).toBeUndefined();
        expect(result!['build-clang']).toBe(0);
    });

    it('skips jobs with empty name', async () => {
        const mockGet = jest.fn()
            .mockResolvedValueOnce({
                message: { statusCode: 200 },
                readBody: async () => JSON.stringify({
                    workflow_runs: [{ id: 1, status: 'completed', conclusion: 'success' }]
                })
            })
            .mockResolvedValueOnce({
                message: { statusCode: 200 },
                readBody: async () => JSON.stringify({
                    jobs: [
                        { name: '', conclusion: 'success' },
                        { name: 'valid', conclusion: 'success' }
                    ]
                })
            });

        MockHttpClient.mockImplementation(() => ({ get: mockGet }) as unknown as httpClient.HttpClient);

        const result = await fetchFailureRates(10, 'my-token');
        expect(result).not.toBeNull();
        expect(result!['']).toBeUndefined();
        expect(result!['valid']).toBe(0);
    });

    it('handles job fetch failure for individual runs', async () => {
        const mockGet = jest.fn()
            .mockResolvedValueOnce({
                message: { statusCode: 200 },
                readBody: async () => JSON.stringify({
                    workflow_runs: [{ id: 1, status: 'completed', conclusion: 'success' }, { id: 2, status: 'completed', conclusion: 'success' }]
                })
            })
            .mockResolvedValueOnce({
                message: { statusCode: 500 },
                readBody: async () => '{}'
            })
            .mockResolvedValueOnce({
                message: { statusCode: 200 },
                readBody: async () => JSON.stringify({
                    jobs: [{ name: 'build', conclusion: 'success' }]
                })
            });

        MockHttpClient.mockImplementation(() => ({ get: mockGet }) as unknown as httpClient.HttpClient);

        const result = await fetchFailureRates(10, 'my-token');
        expect(result).not.toBeNull();
        expect(result!['build']).toBe(0);
    });

    it('handles job fetch exception for individual runs', async () => {
        const mockGet = jest.fn()
            .mockResolvedValueOnce({
                message: { statusCode: 200 },
                readBody: async () => JSON.stringify({
                    workflow_runs: [{ id: 1, status: 'completed', conclusion: 'success' }]
                })
            })
            .mockRejectedValueOnce(new Error('network error'));

        MockHttpClient.mockImplementation(() => ({ get: mockGet }) as unknown as httpClient.HttpClient);

        const result = await fetchFailureRates(10, 'my-token');
        expect(result).not.toBeNull();
        expect(Object.keys(result!)).toHaveLength(0);
    });

    it('returns null on top-level exception', async () => {
        MockHttpClient.mockImplementation(() => {
            throw new Error('constructor error');
        });

        const result = await fetchFailureRates(10, 'my-token');
        expect(result).toBeNull();
    });

    it('handles non-Error thrown objects', async () => {
        MockHttpClient.mockImplementation(() => {
            throw 'string error'; // eslint-disable-line no-throw-literal
        });

        const result = await fetchFailureRates(10, 'my-token');
        expect(result).toBeNull();
    });
});

describe('sortByFailureRate', () => {
    it('does nothing when failure rates are empty', () => {
        const matrix = [makeEntry('a'), makeEntry('b')];
        sortByFailureRate(matrix, {});
        expect(matrix[0].name).toBe('a');
        expect(matrix[1].name).toBe('b');
    });

    it('sorts entries by failure rate descending', () => {
        const matrix = [makeEntry('low'), makeEntry('high'), makeEntry('mid')];
        const rates: FailureRates = { low: 0.1, high: 0.9, mid: 0.5 };

        sortByFailureRate(matrix, rates);

        expect(matrix[0].name).toBe('high');
        expect(matrix[1].name).toBe('mid');
        expect(matrix[2].name).toBe('low');
    });

    it('preserves order for equal failure rates (stable sort)', () => {
        const matrix = [makeEntry('a'), makeEntry('b'), makeEntry('c')];
        const rates: FailureRates = { a: 0.5, b: 0.5, c: 0.5 };

        sortByFailureRate(matrix, rates);

        expect(matrix[0].name).toBe('a');
        expect(matrix[1].name).toBe('b');
        expect(matrix[2].name).toBe('c');
    });

    it('assigns mean rate to entries without history', () => {
        const matrix = [makeEntry('known'), makeEntry('unknown')];
        const rates: FailureRates = { known: 0.4 };

        sortByFailureRate(matrix, rates);

        expect(matrix[0].name).toBe('known');
        expect(matrix[0]['failure-rate']).toBe(0.4);
        expect(matrix[1].name).toBe('unknown');
        expect(matrix[1]['failure-rate']).toBe(0.4); // mean of [0.4] = 0.4
    });

    it('sorts unknown entries (mean rate) between high and low rates', () => {
        const matrix = [makeEntry('low'), makeEntry('unknown'), makeEntry('high')];
        const rates: FailureRates = { low: 0.1, high: 0.9 };

        sortByFailureRate(matrix, rates);

        // mean = 0.5, so: high(0.9) > unknown(0.5) > low(0.1)
        expect(matrix[0].name).toBe('high');
        expect(matrix[1].name).toBe('unknown');
        expect(matrix[2].name).toBe('low');
    });

    it('assigns failure-rate property to all entries', () => {
        const matrix = [makeEntry('a'), makeEntry('b')];
        const rates: FailureRates = { a: 0.3, b: 0.7 };

        sortByFailureRate(matrix, rates);

        expect(matrix[0]['failure-rate']).toBe(0.7);
        expect(matrix[1]['failure-rate']).toBe(0.3);
    });
});
