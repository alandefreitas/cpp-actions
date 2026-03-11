import * as main from './index';
import * as fs from 'fs';
import * as semver from 'semver';

test('findProgramInPath', async () => {
    const { findProgramInPath } = main;
    for (const name of ['node', 'gcc']) {
        const version = '>=1';
        // check if /usr/local/bin/node exists
        if (fs.existsSync(`/usr/local/bin/${name}`) || fs.existsSync(`/usr/bin/${name}`)) {
            const paths = [`/usr/local/bin/${name}`, `/usr/bin/${name}`];
            const result = await findProgramInPath(paths, version, true);
            // result.outputVersion satisfies version
            if (result.outputVersion) {
                expect(semver.satisfies(result.outputVersion, version)).toBe(true);
            }
            expect(result.outputPath === `/usr/local/bin/${name}` || result.outputPath === `/usr/bin/${name}`).toBe(true);
        }
    }
}, 30000);

test('findProgramInSystemPaths', async () => {
    const { findProgramInSystemPaths } = main;
    for (const name of ['node', 'gcc']) {
        const paths = ['/usr/bin', '/usr/local/bin'];
        const version = '>=1';
        // check if /usr/local/bin/node exists
        if (fs.existsSync(`/usr/local/bin/${name}`) || fs.existsSync(`/usr/bin/${name}`)) {
            const result = await findProgramInSystemPaths(paths, [name], version, true);
            if (result.outputVersion) {
                expect(semver.satisfies(result.outputVersion, version)).toBe(true);
            }
            expect(result.outputPath === `/usr/local/bin/${name}` || result.outputPath === `/usr/bin/${name}`).toBe(true);
        }
    }
}, 30000);

describe('pretty errors', () => {
    it.skip('logs once and fails once', async () => {
        await new Promise<void>((resolve) => {
            jest.isolateModules(() => {
                jest.doMock('@actions/core', () => ({
                    error: jest.fn(),
                    setFailed: jest.fn()
                }));
                const core = require('@actions/core');
                const { reportAndSetFailed } = require('pretty-errors');

                reportAndSetFailed(new Error('program boom'), { title: 'Setup program failed' }).then(() => {
                    expect(core.error).toHaveBeenCalledTimes(1);
                    const failedArg = core.setFailed.mock.calls[0][0];
                    expect(failedArg).toContain('program boom');
                    resolve();
                });
            });
        });
    });
});

// Unreliable for testing as it is
// test('findProgramWithApt', async () => {
//   if (process.platform === 'linux') {
//     const {findProgramWithApt} = main
//     for (const name of ['cowsay']) {
//       const version = '>=1'
//       const result = await findProgramWithApt([name], version, true)
//       if (result.outputPath !== null) {
//         expect(semver.satisfies(result.outputVersion, version)).toBe(true)
//         expect(result.outputPath == `/usr/local/bin/${name}` || result.outputPath == `/usr/bin/${name}`).toBe(true)
//       }
//     }
//   }
// })

describe('getPackagePreferenceTier', () => {
    const { getPackagePreferenceTier, PackagePreferenceTier } = main;

    it('returns UNVERSIONED tier for exact base name match', () => {
        expect(getPackagePreferenceTier('clang', ['clang'])).toBe(PackagePreferenceTier.UNVERSIONED);
        expect(getPackagePreferenceTier('gcc', ['gcc', 'g++'])).toBe(PackagePreferenceTier.UNVERSIONED);
        expect(getPackagePreferenceTier('g++', ['gcc', 'g++'])).toBe(PackagePreferenceTier.UNVERSIONED);
        expect(getPackagePreferenceTier('cmake', ['cmake'])).toBe(PackagePreferenceTier.UNVERSIONED);
    });

    it('returns RAW_VERSIONED tier for base name with version suffix', () => {
        expect(getPackagePreferenceTier('clang-14', ['clang'])).toBe(PackagePreferenceTier.RAW_VERSIONED);
        expect(getPackagePreferenceTier('gcc-12', ['gcc', 'g++'])).toBe(PackagePreferenceTier.RAW_VERSIONED);
        expect(getPackagePreferenceTier('cmake-3.24', ['cmake'])).toBe(PackagePreferenceTier.RAW_VERSIONED);
        expect(getPackagePreferenceTier('clang-14.0', ['clang'])).toBe(PackagePreferenceTier.RAW_VERSIONED);
    });

    it('returns OTHER_VERSIONED tier for packages with additional suffixes', () => {
        expect(getPackagePreferenceTier('clang-14-tools', ['clang'])).toBe(PackagePreferenceTier.OTHER_VERSIONED);
        expect(getPackagePreferenceTier('clang-format-14', ['clang'])).toBe(PackagePreferenceTier.OTHER_VERSIONED);
        expect(getPackagePreferenceTier('clang-tidy-14', ['clang'])).toBe(PackagePreferenceTier.OTHER_VERSIONED);
        expect(getPackagePreferenceTier('libclang-14-dev', ['clang'])).toBe(PackagePreferenceTier.OTHER_VERSIONED);
    });

    it('handles multiple base names correctly', () => {
        // Both gcc and g++ should be recognized as unversioned
        expect(getPackagePreferenceTier('gcc', ['gcc', 'g++'])).toBe(PackagePreferenceTier.UNVERSIONED);
        expect(getPackagePreferenceTier('g++', ['gcc', 'g++'])).toBe(PackagePreferenceTier.UNVERSIONED);
        // gcc-12 should be raw versioned when searching for gcc
        expect(getPackagePreferenceTier('gcc-12', ['gcc', 'g++'])).toBe(PackagePreferenceTier.RAW_VERSIONED);
    });
});
