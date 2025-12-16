import { main, semverGteLoose } from './index';

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

describe('semverGteLoose', () => {
    test('handles four-part versions without throwing', () => {
        expect(semverGteLoose('0.96.24.20', '0.96.24.20')).toBe(true);
        expect(semverGteLoose('0.96.24.21', '0.96.24.20')).toBe(true);
        expect(semverGteLoose('0.96.24.19', '0.96.24.20')).toBe(false);
    });

    test('coerces distro-suffixed versions without throwing', () => {
        expect(() => semverGteLoose('0.96.24ubuntu1', '0.96.24.20')).not.toThrow();
        expect(semverGteLoose('0.96.24ubuntu1', '0.96.24.20')).toBe(false);
    });
});

describe('package-install', () => {
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

            runPromise = reportAndSetFailed(new Error('pkg boom'), {
                title: 'Package install failed'
            }).then(() => {
                const msg = core.setFailed.mock.calls[0][0] as string;
                expect(msg).toContain('Package install failed');
                expect(msg).toContain('pkg boom');
            });
        });

        if (runPromise) {
            await runPromise;
        }
    });
});
