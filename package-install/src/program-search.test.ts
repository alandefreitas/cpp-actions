jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    setFailed: jest.fn()
}));

jest.mock('@actions/exec', () => {
    const actual = jest.requireActual('@actions/exec');
    return {
        getExecOutput: (cmd: string, args?: string[], options?: Record<string, unknown>) =>
            actual.getExecOutput(cmd, args, { ...options, silent: true })
    };
});

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn()),
    setTraceCommands: jest.fn()
}));

import * as fs from 'fs';
import * as semver from 'semver';

import { findProgramInPath, findProgramInSystemPaths } from './program-search';

describe('findProgramInPath', () => {
    it('finds a program in /usr/local/bin or /usr/bin', async () => {
        for (const name of ['node', 'gcc']) {
            const version = '>=1';
            if (fs.existsSync(`/usr/local/bin/${name}`) || fs.existsSync(`/usr/bin/${name}`)) {
                const paths = [`/usr/local/bin/${name}`, `/usr/bin/${name}`];
                const result = await findProgramInPath(paths, version, true);
                if (result.outputVersion) {
                    expect(semver.satisfies(result.outputVersion, version)).toBe(true);
                }
                expect(result.outputPath === `/usr/local/bin/${name}` || result.outputPath === `/usr/bin/${name}`).toBe(true);
            }
        }
    }, 30000);
});

describe('findProgramInSystemPaths', () => {
    it('finds a program in system directories', async () => {
        for (const name of ['node', 'gcc']) {
            const paths = ['/usr/bin', '/usr/local/bin'];
            const version = '>=1';
            if (fs.existsSync(`/usr/local/bin/${name}`) || fs.existsSync(`/usr/bin/${name}`)) {
                const result = await findProgramInSystemPaths(paths, [name], version, true);
                if (result.outputVersion) {
                    expect(semver.satisfies(result.outputVersion, version)).toBe(true);
                }
                expect(result.outputPath === `/usr/local/bin/${name}` || result.outputPath === `/usr/bin/${name}`).toBe(true);
            }
        }
    }, 30000);
});

describe('findProgramInSystemPaths with a version the program does not satisfy', () => {
    // The running node binary stands in for a pre-installed compiler of the
    // wrong version, as when clang-cl 23 is requested and the runner image
    // only has clang 20.
    const nodeDir = require('path').dirname(process.execPath);

    it('does not return the program', async () => {
        const result = await findProgramInSystemPaths([nodeDir], ['node'], '>=999', true);
        expect(result).toEqual({ outputPath: null, outputVersion: null });
    }, 30000);

    it('returns the program for a version it satisfies', async () => {
        const result = await findProgramInSystemPaths([nodeDir], ['node'], '>=1', true);
        expect(result.outputPath).not.toBeNull();
        expect(semver.satisfies(result.outputVersion!, '>=1')).toBe(true);
    }, 30000);
});
