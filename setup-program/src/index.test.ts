import * as main from './index';
import * as fs from 'fs';
import * as semver from 'semver';

test('find_program_in_path', async () => {
    const { find_program_in_path } = main;
    for (const name of ['node', 'gcc']) {
        const version = '>=1';
        // check if /usr/local/bin/node exists
        if (fs.existsSync(`/usr/local/bin/${name}`) || fs.existsSync(`/usr/bin/${name}`)) {
            const paths = [`/usr/local/bin/${name}`, `/usr/bin/${name}`];
            const result = await find_program_in_path(paths, version, true);
            // result.output_version satisfies version
            if (result.output_version) {
                expect(semver.satisfies(result.output_version, version)).toBe(true);
            }
            expect(result.output_path == `/usr/local/bin/${name}` || result.output_path == `/usr/bin/${name}`).toBe(true);
        }
    }
});

test('find_program_in_system_paths', async () => {
    const { find_program_in_system_paths } = main;
    for (const name of ['node', 'gcc']) {
        const paths = ['/usr/bin', '/usr/local/bin'];
        const version = '>=1';
        // check if /usr/local/bin/node exists
        if (fs.existsSync(`/usr/local/bin/${name}`) || fs.existsSync(`/usr/bin/${name}`)) {
            const result = await find_program_in_system_paths(paths, [name], version, true);
            if (result.output_version) {
                expect(semver.satisfies(result.output_version, version)).toBe(true);
            }
            expect(result.output_path == `/usr/local/bin/${name}` || result.output_path == `/usr/bin/${name}`).toBe(true);
        }
    }
});

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
// test('find_program_with_apt', async () => {
//   if (process.platform === 'linux') {
//     const {find_program_with_apt} = main
//     for (const name of ['cowsay']) {
//       const version = '>=1'
//       const result = await find_program_with_apt([name], version, true)
//       if (result.output_path !== null) {
//         expect(semver.satisfies(result.output_version, version)).toBe(true)
//         expect(result.output_path == `/usr/local/bin/${name}` || result.output_path == `/usr/bin/${name}`).toBe(true)
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
