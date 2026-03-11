jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    setFailed: jest.fn()
}));

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn()),
    setTraceCommands: jest.fn()
}));

import * as path from 'path';
import * as process from 'process';

const cacheDir = path.join(__dirname, '..', 'test-data', 'cache');
process.env.CPP_MATRIX_CACHE_DIR = cacheDir;

import * as setup_program from 'setup-program';
setup_program.setVersionsCacheDir(cacheDir);

import { splitRanges, findMSVCVersions, SubrangePolicies } from './versions';

describe('setup_program.findGCCVersions', () => {
    test('contains valid versions', async () => {
        expect(await setup_program.findGCCVersions()).toContain('4.8.0');
        expect(await setup_program.findGCCVersions()).toContain('13.1.0');
    });
});

describe('findClangVersions', () => {
    test('Contains valid versions', async () => {
        expect(await setup_program.findClangVersions()).toContain('2.6.0');
        expect(await setup_program.findClangVersions()).toContain('16.0.0');
    });
});

describe('splitRanges', () => {
    test('should split ranges correctly', async () => {
        expect(splitRanges('9.2 - 11', await setup_program.findGCCVersions())).toStrictEqual(['^9.2', '10', '11']);
        expect(splitRanges('9.2 - 9.4 || 11', await setup_program.findGCCVersions())).toStrictEqual(['9.2 - 9.4', '11']);
        expect(splitRanges('>=8 <9.100', await setup_program.findGCCVersions())).toStrictEqual(['8', '9']);
        expect(splitRanges('>=14 <14.50', findMSVCVersions())).toStrictEqual(['14']);
        expect(splitRanges('<=9.2', ['9.1.0', '9.2.0', '9.3.0', '9.4.0', '9.5.0'], SubrangePolicies.ONE_PER_MAJOR)).toStrictEqual(['9 - 9.2']);
        expect(splitRanges('>14.29.4 <14.40', ['14.29.30139', '14.29.30140'])).toStrictEqual(['14']);
        expect(splitRanges('>14.29.30140 <14.40', ['14.29.30139', '14.29.30150'])).toStrictEqual(['^14.29.30150']);
        expect(splitRanges('>14.0.0 <14.29.30140', ['14.29.30139', '14.29.30150'])).toStrictEqual(['14 - 14.29.30139']);
    });
});
