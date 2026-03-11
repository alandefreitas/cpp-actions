import { main } from './index';
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

describe('package-install', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('main function is exported', () => {
        expect(main).toBeDefined();
        expect(typeof main).toBe('function');
    });
});

describePrettyErrors('pkg boom', 'Package install failed');
