import { main, semverGteLoose } from './index';
import { describePrettyErrors } from 'pretty-errors/test-helper';

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

describePrettyErrors('pkg boom', 'Package install failed');
