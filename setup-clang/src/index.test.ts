import { main } from './index';

// Mock @actions/core for pretty-errors test
jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    setFailed: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    addPath: jest.fn(),
    exportVariable: jest.fn(),
    getInput: jest.fn()
}));

describe('setup-clang', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('main function is exported', () => {
        expect(main).toBeDefined();
        expect(typeof main).toBe('function');
    });
});

describe('pretty errors integration', () => {
    it('logs once and fails once', async () => {
        let runPromise: Promise<void> | undefined;
        jest.isolateModules(() => {
            jest.doMock('@actions/core', () => ({
                error: jest.fn(),
                setFailed: jest.fn()
            }));
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const core = require('@actions/core');
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { reportAndSetFailed } = require('../../common/pretty-errors');

            runPromise = reportAndSetFailed(new Error('clang boom'), {
                title: 'Setup Clang failed'
            }).then(() => {
                const msg = core.setFailed.mock.calls[0][0] as string;
                expect(msg).toContain('Setup Clang failed');
                expect(msg).toContain('clang boom');
            });
        });

        if (runPromise) {
            await runPromise;
        }
    });
});
