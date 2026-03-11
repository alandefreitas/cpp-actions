/**
 * Vcpkg installation and package management logic.
 *
 * @module vcpkg-install
 */

import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import * as exec from '@actions/exec';
import * as tc from '@actions/tool-cache';
import * as cache from '@actions/cache';
import * as io from '@actions/io';
import * as os from 'os';

import { type Inputs } from './schema';

/**
 * Output values from vcpkg installation.
 */
export interface VcpkgOutputs {
    vcpkgExecutable?: string;
    vcpkgToolchain?: string;
}
import { uuidV4, sha1sum, escapePath, readCompilerVersion } from './utils';

/**
 * Creates a temporary folder inside RUNNER_TEMP (or OS temp) with a UUID name.
 *
 * @param dest - Optional destination path (ignored, folder is created with UUID)
 * @returns Absolute path to the created temporary folder
 */
async function createTempFolder(dest?: string): Promise<string> {
    dest = path.join(process.env['RUNNER_TEMP'] || os.tmpdir() || '', uuidV4());
    await io.mkdirP(dest);
    return dest;
}

/**
 * Installs and configures vcpkg with the specified packages.
 *
 * Handles vcpkg cloning, bootstrapping, package installation, and caching.
 *
 * @param inputs - Configuration inputs for vcpkg installation
 * @returns Object containing vcpkg executable and toolchain paths
 * @throws Error if a vcpkg package fails to install
 */
export async function vcpkgMain(inputs: Inputs): Promise<VcpkgOutputs> {
    /*
        Infer any vcpkg parameters necessary and
        create a cache key.
     */
    core.startGroup('🔢 vcpkg parameters');
    // Git Hash
    const gitPath = await io.which('git', true);
    core.info(`🧩 git-path: ${gitPath}`);
    const vcpkgRepo = 'https://github.com/microsoft/vcpkg.git';
    core.info(`🧩 vcpkg-repo: ${vcpkgRepo}`);
    core.info(`🧩 vcpkg-branch: ${inputs.vcpkgBranch}`);
    const vcpkgCommitHash = (await exec.getExecOutput(escapePath(gitPath), ['ls-remote', vcpkgRepo, inputs.vcpkgBranch])).stdout.trim();
    core.info(`🧩 vcpkg-commit-hash: ${vcpkgCommitHash}`);

    // Triplet
    const defaultTriplet = ({'win32': 'x64-windows', 'linux': 'x64-linux', 'darwin': 'x64-osx'} as Record<string, string>)[process.platform] || '';
    core.info(`🧩 default-triplet: ${defaultTriplet}`);
    const triplet = inputs.vcpkgTriplet || defaultTriplet;
    const tripletSuffix = triplet ? `:${triplet}` : '';
    core.info(`🧩 triplet: ${triplet}`);

    // vcpkg directory
    let vcpkgDir = inputs.vcpkgDir;
    if (!vcpkgDir) {
        vcpkgDir = tc.find('vcpkg', inputs.vcpkgBranch);
    }
    if (!vcpkgDir && process.env.RUNNER_TOOL_CACHE) {
        const dir = path.join(process.env.RUNNER_TOOL_CACHE, 'vcpkg', inputs.vcpkgBranch);
        if (fs.existsSync(dir)) {
            vcpkgDir = dir;
        }
    }
    if (!vcpkgDir) {
        const tmp = await createTempFolder();
        const vcpkgTempDir = path.join(tmp, 'vcpkg');
        await io.mkdirP(vcpkgTempDir);
        // Move that empty folder to the cache tools and make the cache
        // tool the final directory
        vcpkgDir = await tc.cacheDir(vcpkgTempDir, 'vcpkg', inputs.vcpkgBranch);
    }
    if (vcpkgDir && !path.isAbsolute(vcpkgDir)) {
        vcpkgDir = path.join(process.cwd(), vcpkgDir);
    }

    core.info(`🧩 vcpkg-dir: ${vcpkgDir}`);
    const bootstrapBasename = process.platform === 'win32' ? 'bootstrap-vcpkg.bat' : 'bootstrap-vcpkg.sh';
    const bootstrapPath = path.join(vcpkgDir, bootstrapBasename);
    core.info(`🧩 bootstrap-path: ${bootstrapPath}`);
    const toolchainPath = path.join(vcpkgDir, 'scripts', 'buildsystems', 'vcpkg.cmake');
    const vcpkgExecutable = path.join(vcpkgDir, 'vcpkg');

    // Compiler hash
    let compilerHashStr = '';
    let cxxCompilerVersion = '';
    if (inputs.cxx !== '') {
        if (inputs.cxx === path.basename(inputs.cxx)) {
            inputs.cxx = await io.which(inputs.cxx, true);
        }
        const compilerVersionOutput = await readCompilerVersion(inputs.cxx);
        const regex = /[0-9]+\.[0-9]+\.[0-9]+/;
        const matches = compilerVersionOutput.match(regex);
        const compilerVersion = matches ? matches[0] : '';
        compilerHashStr += `cxx:${inputs.cxx}-version:${compilerVersion}-flags:${inputs.cxxflags}`;
        cxxCompilerVersion = compilerVersion;
    }
    if (inputs.cc !== '') {
        if (inputs.cc === path.basename(inputs.cc)) {
            inputs.cc = await io.which(inputs.cc, true);
        }
        const compilerVersionOutput = await readCompilerVersion(inputs.cc);
        const regex = /[0-9]+\.[0-9]+\.[0-9]+/;
        const matches = compilerVersionOutput.match(regex);
        const compilerVersion = matches ? matches[0] : '';
        if (cxxCompilerVersion !== compilerVersion || inputs.ccflags !== inputs.cxxflags) {
            compilerHashStr += `cc:${inputs.cc}-version:${compilerVersion}-flags:${inputs.ccflags}`;
        }
    }
    core.info(`🧩 compiler-hash-str: ${compilerHashStr}`);
    const compilerHash = sha1sum(compilerHashStr);
    core.info(`🧩 compiler-hash: ${compilerHash}`);
    const compilerHashId = compilerHash.substr(0, 8);
    const packagesHash = sha1sum(inputs.vcpkg.join('-'));
    const packagesHashId = packagesHash.substr(0, 8);
    const vcpkgCacheKey = `vcpkg${tripletSuffix}-os:${process.platform}-cxx:${compilerHashId}-packages:${packagesHashId}`;
    core.info(`🧩 vcpkg-cache-key: ${vcpkgCacheKey}`);

    const outputs: VcpkgOutputs = {
        vcpkgExecutable: vcpkgExecutable,
        vcpkgToolchain: toolchainPath
    };
    core.endGroup();

    const cachePaths = [vcpkgDir];
    if (inputs.vcpkgCache) {
        core.startGroup('🔍 Cache lookup');
        const cacheKey = await cache.restoreCache([vcpkgDir], vcpkgCacheKey, [], {}, false);
        if (cacheKey) {
            core.info(`Cache hit: ${cacheKey}`);
            core.info(`- triplet: ${triplet}`);
            core.info(`- compiler-hash-id: ${compilerHashId}`);
            core.info(`- packages: ${inputs.vcpkg.join('-')}`);
            core.endGroup();
            return outputs;
        }
        core.info(`Cache miss for key: ${vcpkgCacheKey}`);
        core.endGroup();
    }
    core.startGroup('📦 Install vcpkg');
    const cloneArgs = ['clone', vcpkgRepo, '-b', inputs.vcpkgBranch, '--depth', '1', vcpkgDir];
    core.info(`💻 ${escapePath(gitPath)} ${cloneArgs.join(' ')}`);
    await exec.exec(escapePath(gitPath), cloneArgs, {});
    core.info(`💻 ${escapePath(bootstrapPath)}`);
    await exec.exec(escapePath(bootstrapPath), [], {cwd: vcpkgDir});
    core.endGroup();

    if (inputs.vcpkg.length > 0) {
        // Set environment variables to determine how vcpkg should
        // build packages by default
        if (inputs.cxx !== '') {
            core.exportVariable('CXX', inputs.cxx);
        }
        if (inputs.cxxflags !== '') {
            core.exportVariable('CXXFLAGS', inputs.cxxflags);
        }
        if (inputs.cc !== '') {
            core.exportVariable('CC', inputs.cc);
        }
        if (inputs.ccflags) {
            core.exportVariable('CFLAGS', inputs.ccflags);
        }

        for (const pkg of inputs.vcpkg) {
            core.startGroup('📦 Install vcpkg package: ' + pkg);
            // Check pkg contains its own triplet suffix
            const hasOwnTriplet = pkg.includes(':');
            const pkgWithTriplet = hasOwnTriplet ? pkg : `${pkg}${tripletSuffix}`;
            const exitCode = await exec.exec(escapePath(vcpkgExecutable), ['install', pkg, pkgWithTriplet], {
                ignoreReturnCode: true
            });
            if (exitCode === 0) {
                core.endGroup();
                continue;
            }
            // If the package failed to install, we attempt to print some
            // helpful information about why it failed.
            // vcpkg might store this information in a number of log files
            const pkgWithoutTriplet = hasOwnTriplet ? pkg.split(':')[0] : pkg;
            const pkgTriplet = hasOwnTriplet ? pkg.split(':')[1] : triplet;
            for (const prefix of ['detect_compiler', pkgWithoutTriplet]) {
                for (const buildType of ['rel', 'dbg']) {
                    for (const step of ['config', 'build', 'install']) {
                        for (const suffix of ['CMakeCache.txt', 'out', 'err']) {
                            const logBasename = `${step}-${pkgTriplet}-${buildType}-${suffix}.log`;
                            const logPath = path.join(vcpkgDir, 'buildtrees', prefix, logBasename);
                            if (fs.existsSync(logPath)) {
                                core.info(`📄 Contents of ${logPath}:`);
                                const contents = fs.readFileSync(logPath, 'utf8');
                                core.info(contents);
                            }
                        }
                    }
                    const cmakeOutputLogPath = path.join(vcpkgDir, 'buildtrees', prefix, `${pkgTriplet}-${buildType}`, 'CMakeFiles', 'CMakeOutput.log');
                    if (fs.existsSync(cmakeOutputLogPath)) {
                        core.info(`📄 Contents of ${cmakeOutputLogPath}:`);
                        const contents = fs.readFileSync(cmakeOutputLogPath, 'utf8');
                        core.info(contents);
                    }
                    const cmakeErrorLogPath = path.join(vcpkgDir, 'buildtrees', prefix, `${pkgTriplet}-${buildType}`, 'CMakeFiles', 'CMakeError.log');
                    if (fs.existsSync(cmakeErrorLogPath)) {
                        core.info(`📄 Contents of ${cmakeErrorLogPath}:`);
                        const contents = fs.readFileSync(cmakeErrorLogPath, 'utf8');
                        core.info(contents);
                    }
                }
            }
            core.endGroup();
            throw new Error(`Failed to install package ${pkg}`);
        }
    }

    if (inputs.vcpkgCache) {
        core.startGroup('💾 Cache vcpkg and built packages');
        core.info(`Cache path: ${cachePaths.join(', ')}`);
        core.info(`Cache key: ${vcpkgCacheKey}`);
        await cache.saveCache(cachePaths, vcpkgCacheKey, {}, false);
        core.endGroup();
    }

    return outputs;
}
