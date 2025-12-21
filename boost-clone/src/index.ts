/**
 * Main entry point for boost-clone action.
 *
 * @module index
 */

import * as core from '@actions/core';
import * as cache from '@actions/cache';
import * as tc from '@actions/tool-cache';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as trace_commands from 'trace-commands';
import * as gh_inputs from 'gh-inputs';
import { reportAndSetFailed } from 'pretty-errors';

// Type imports
import {
    CloneStrategy,
    Inputs,
    Outputs,
    CacheKeyResult,
    ModuleEstimation
} from './types';

// Module imports
import { generateCacheKey, getCachedBoost, cacheBoost } from './cache';
import { isReleaseTag, estimateTotalModules, decideStrategy, getBoostDepsData } from './module-deps';
import { batchInitializeSubmodules, initializeSubmodules, initializeAllSubmodules } from './submodules';
import { readExceptions, readGitmodules, scanBoostDependencies } from './header-scan';
import { getArchiveUrl, downloadAndExtractArchive } from './archive';
import { findGitFeatures, cloneBoostSuperproject, applyPatches } from './git-utils';

// Re-export for external consumers
export { generateCacheKey } from './cache';
export type { Inputs, Outputs, CloneStrategy } from './types';

/**
 * Clones the Boost super-project and initializes required submodules.
 *
 * Manages caching of the Boost installation, resolves module dependencies,
 * applies patches, and initializes git submodules for the specified modules.
 * Supports two strategies: git (clone + submodule init) and archive (download release tarball).
 *
 * @param inputs - Configuration inputs including branch, modules, patches, and cache settings
 * @returns Outputs including the Boost directory path
 */
export async function main(inputs: Inputs): Promise<Outputs> {
    function fnlog(msg: string): void {
        trace_commands.log(`main: ${msg}`);
    }

    const outputs: Outputs = { boost_dir: inputs.boost_dir };

    // Ensure cache path exists before interacting with the cache API
    fs.mkdirSync(inputs.boost_dir, { recursive: true });

    core.info(`Cache path: ${inputs.boost_dir}`);
    core.info(`Cache enabled: ${inputs.cache}`);
    core.info(`Optimistic caching: ${inputs.optimistic_caching}`);
    core.info(`Clone strategy: ${inputs.clone_strategy}`);
    core.info(`Archive threshold: ${inputs.archive_threshold}`);

    core.startGroup('📐 Identify git features');
    const gitFeatures = await findGitFeatures(inputs);
    core.endGroup();

    core.startGroup('🔑 Calculate Boost Cache Key');
    const { cacheKey: initialCacheKey } = await generateCacheKey(inputs, inputs.modules, gitFeatures, { logInfo: true, withFragments: true }) as CacheKeyResult;
    core.endGroup();
    let cacheKey = initialCacheKey;

    const cacheAvailable = inputs.cache && cache.isFeatureAvailable();
    if (inputs.cache && !cacheAvailable) {
        core.info('GitHub cache service unavailable; continuing without cache');
    }

    if (cacheAvailable) {
        core.startGroup('📦 Check Boost Cache');
        const cacheHit = await getCachedBoost(inputs, cacheKey);
        core.endGroup();
        if (cacheHit) {
            core.info('Cache hit: skipping downloads, scans, clone, and submodule init');
            return outputs;
        }
    } else if (!inputs.cache) {
        core.info('Caching disabled via input; proceeding without cache');
    }

    // Get gitmodules and exceptions (needed for scanning local deps)
    core.startGroup('🌍 Download .gitmodules and exceptions.txt');
    const gitmodulesUrl = `https://raw.githubusercontent.com/boostorg/boost/${inputs.branch}/.gitmodules`;
    const gitmodulesPath = path.resolve(await tc.downloadTool(gitmodulesUrl));
    core.info(`Downloaded ${gitmodulesUrl} to ${gitmodulesPath}`);
    const submodulePaths = readGitmodules(gitmodulesPath);
    fnlog(`Submodule Paths: ${gh_inputs.makeValueString(submodulePaths)}`);

    const exceptionsUrl = `https://raw.githubusercontent.com/boostorg/boostdep/${inputs.branch}/depinst/exceptions.txt`;
    const exceptionsPath = path.resolve(await tc.downloadTool(exceptionsUrl));
    core.info(`Downloaded ${exceptionsUrl} to ${exceptionsPath}`);
    const exceptions = readExceptions(exceptionsPath);
    fnlog(`Exceptions: ${JSON.stringify(exceptions)}`);
    core.endGroup();

    // Scan local directories for required modules
    const directModules = new Set(inputs.modules);
    for (const scanDir of inputs.scan_modules_dir) {
        core.startGroup(`🔍 Scan Boost Modules Required by ${path.basename(scanDir)}`);
        const scannedModules = await scanBoostDependencies(scanDir, inputs, exceptions, submodulePaths);
        for (const module of scannedModules) {
            directModules.add(module);
        }
        core.endGroup();
    }

    // Estimate total modules using precomputed data
    core.startGroup('📊 Estimate Total Modules');
    const releaseForEstimate = isReleaseTag(inputs.branch) ? inputs.branch : undefined;
    const estimation = estimateTotalModules(directModules, releaseForEstimate);
    core.info(`Direct modules requested: ${directModules.size}`);
    core.info(`Estimated total modules (with transitive deps): ${estimation.totalCount}`);
    core.info(`Estimation from precomputed data: ${estimation.fromPrecomputed}`);
    core.endGroup();

    // Decide on strategy
    core.startGroup('🎯 Select Clone Strategy');
    const strategy = decideStrategy(inputs, estimation.totalCount);
    core.info(`Selected strategy: ${strategy}`);
    core.endGroup();

    // Recalculate cache key with full module set
    core.startGroup('🔑 Calculate Boost Cache Key');
    const allModulesForCache = estimation.fromPrecomputed ? estimation.allModules : directModules;
    cacheKey = await generateCacheKey(inputs, allModulesForCache, gitFeatures) as string;
    core.endGroup();

    // Execute the selected strategy
    if (strategy === 'archive') {
        // Archive strategy: download and extract the CMake release
        core.startGroup('📦 Download Boost Archive');
        const archiveUrl = getArchiveUrl(inputs.branch);
        try {
            await downloadAndExtractArchive(archiveUrl, inputs.boost_dir);
        } catch (error) {
            core.warning(`Archive download failed: ${error}. Falling back to git strategy.`);
            core.endGroup();
            // Fall through to git strategy
            await executeGitStrategy(inputs, directModules, estimation, gitFeatures, exceptions, submodulePaths);
        }
        core.endGroup();

        // Apply patches (git clone into libs/)
        if (inputs.patches.size > 0) {
            core.startGroup('🔨 Apply Boost Patches');
            await applyPatches(inputs);
            core.endGroup();
        }
    } else {
        // Git strategy
        await executeGitStrategy(inputs, directModules, estimation, gitFeatures, exceptions, submodulePaths);
    }

    // Cache boost
    if (cacheAvailable) {
        core.startGroup(`📦 Cache Boost`);
        core.info(`Saving cache for key: ${cacheKey}`);
        await cacheBoost(inputs, cacheKey);
        core.endGroup();
    } else if (inputs.cache) {
        core.info('Cache save skipped because cache service is unavailable');
    }

    return outputs;
}

/**
 * Executes the git clone strategy.
 *
 * @param inputs - User inputs
 * @param directModules - Directly requested modules (from user input + scanning)
 * @param estimation - Module estimation from precomputed data
 * @param gitFeatures - Git capabilities
 * @param exceptions - Header exceptions map
 * @param submodulePaths - Valid submodule paths
 */
async function executeGitStrategy(
    inputs: Inputs,
    directModules: Set<string>,
    estimation: ModuleEstimation,
    gitFeatures: import('./types').GitFeatures,
    exceptions: Record<string, string>,
    submodulePaths: Set<string>
): Promise<void> {
    // Clone boost super-project
    core.startGroup('🚀 Clone Boost Super-project');
    await cloneBoostSuperproject(inputs);
    core.endGroup();

    // Apply patches
    if (inputs.patches.size > 0) {
        core.startGroup('🔨 Apply Boost Patches');
        await applyPatches(inputs);
        core.endGroup();
    }

    // Initialize submodules
    // Check if we have precomputed dependencies for this exact release tag
    const depsData = getBoostDepsData();
    const hasPrecomputedDepsForBranch = isReleaseTag(inputs.branch) && inputs.branch in depsData.releases;

    if (directModules.size === 0) {
        // No specific modules requested, initialize all
        core.startGroup('🔧 Initialize All Boost Submodules');
        await initializeAllSubmodules(inputs, gitFeatures);
        core.endGroup();
    } else if (hasPrecomputedDepsForBranch && estimation.totalCount > 0) {
        // We have precomputed transitive deps for this exact release tag, use batch initialization.
        // Only use batch init for exact release tags (e.g., boost-1.87.0) where we have
        // precomputed dependencies in boost-deps.json. For branches like 'develop' or 'master',
        // or release tags not in our precomputed data, we must use layer-by-layer discovery.
        core.startGroup('🔧 Batch Initialize Boost Submodules');
        core.info(`Using precomputed dependencies for batch initialization`);
        await batchInitializeSubmodules(inputs, estimation.allModules, gitFeatures);
        core.endGroup();
    } else {
        // No precomputed data for this branch, use layer-by-layer discovery
        core.startGroup('🔧 Initialize Boost Submodules');
        core.info(`Using layer-by-layer dependency discovery`);
        await initializeSubmodules(inputs, directModules, gitFeatures, exceptions, submodulePaths);
        core.endGroup();
    }
}

/**
 * Entry point for the GitHub Action.
 *
 * Parses action inputs, validates configuration, and orchestrates the
 * boost-clone workflow including caching, cloning, and submodule initialization.
 */
async function run(): Promise<void> {
    const cloneStrategyInput = gh_inputs.getInput('clone-strategy', { defaultValue: 'auto' }) || 'auto';
    const validStrategies: CloneStrategy[] = ['auto', 'git', 'archive'];
    const cloneStrategy: CloneStrategy = validStrategies.includes(cloneStrategyInput as CloneStrategy)
        ? (cloneStrategyInput as CloneStrategy)
        : 'auto';

    const inputs: Inputs = {
        boost_dir: gh_inputs.getInput('boost-dir') || '',
        branch: gh_inputs.getInput('branch', { defaultValue: 'master' }) || 'master',
        // Modules to clone
        modules: new Set([...gh_inputs.getSet('modules')].filter((m): m is string => m !== undefined)),
        patches: new Set([...gh_inputs.getSet('patches')].filter((p): p is string => p !== undefined)),
        scan_modules_ignore: new Set([...gh_inputs.getSet('scan-modules-ignore')].filter((s): s is string => s !== undefined)),
        // Paths to scan
        scan_modules_dir: new Set(gh_inputs.getMultilineInput('scan-modules-dir').filter((d): d is string => d !== undefined)),
        modules_scan_paths: new Set([...gh_inputs.getSet('modules-scan-paths')].filter((m): m is string => m !== undefined)),
        modules_exclude_paths: new Set([...gh_inputs.getSet('modules-exclude-paths')].filter((m): m is string => m !== undefined)),
        // Caching
        cache: gh_inputs.getBoolean('cache', { defaultValue: true }),
        optimistic_caching: gh_inputs.getBoolean('optimistic-caching', { defaultValue: false }),
        trace_commands: gh_inputs.getBoolean('trace-commands', { defaultValue: false }),
        // Strategy
        clone_strategy: cloneStrategy,
        archive_threshold: parseInt(gh_inputs.getInput('archive-threshold', { defaultValue: '25' }) || '25', 10)
    };

    // Remove any empty entry from scan_modules_dir
    inputs.scan_modules_dir = new Set([...inputs.scan_modules_dir].filter((dir) => dir.trim() !== ''));
    // Resolve scan modules dir
    inputs.scan_modules_dir = new Set([...inputs.scan_modules_dir].map((dir) => path.resolve(dir)));

    // If Boost dir is not provided, we will use a temporary directory
    // for it. This directory will be returned as an output.
    if (!inputs.boost_dir) {
        const pathSuffix = `boost-${inputs.branch}`;
        inputs.boost_dir = path.join(os.tmpdir(), pathSuffix);
    }
    inputs.boost_dir = path.resolve(inputs.boost_dir);

    if (inputs.trace_commands) {
        trace_commands.set_trace_commands(true);
    }

    core.startGroup('📥 Action Inputs');
    gh_inputs.printInputObject(inputs as unknown as Record<string, unknown>);
    core.endGroup();

    const outputs = await main(inputs);

    // Parse Final program / Setup version / Outputs
    if (outputs.boost_dir) {
        core.startGroup('📤 Action Outputs');
        gh_inputs.setOutputObject(outputs as unknown as Record<string, unknown>);
        core.endGroup();
    } else {
        core.setFailed('Cannot clone Boost');
    }
}

if (require.main === module) {
    (async () => {
        try {
            await run();
        } catch (error) {
            await reportAndSetFailed(error as Error, {
                title: 'Boost clone failed'
            });
        }
    })();
}
