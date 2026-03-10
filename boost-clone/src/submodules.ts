/**
 * Submodule initialization utilities for boost-clone action.
 *
 * ## Submodule Initialization Strategies
 *
 * There are three initialization paths:
 *
 * 1. **`initializeAllSubmodules`**: No specific modules requested. Initializes
 *    everything with `--init --recursive`. Simple but slow.
 *
 * 2. **`batchInitializeSubmodules`**: Uses precomputed transitive deps (from
 *    `boost-deps.json` or the journal) to initialize all needed modules in
 *    one pass. Fast and exact when the complete set is known.
 *
 * 3. **`initializeSubmodules`**: Layer-by-layer discovery. Initializes direct
 *    modules, scans their headers for deps, initializes those, repeats until
 *    convergence. Always correct but expensive.
 *
 * @module submodules
 */

import * as exec from '@actions/exec';
import * as path from 'path';
import * as os from 'os';
import * as trace_commands from 'trace-commands';
import * as gh_inputs from 'gh-inputs';
import type { Inputs } from './schema';
import type { GitFeatures } from './git-utils';
import { scanBoostDependencies } from './header-scan';

/**
 * Result from layer-by-layer submodule initialization.
 */
export interface DiscoveryResult {
    /** All modules that were initialized (the full transitive closure) */
    initialized: Set<string>;
    /** Per-module direct deps discovered during header scanning */
    discoveredDeps: Map<string, string[]>;
}

/** Module names always initialized regardless of what the user requests */
const ESSENTIAL_MODULES = ['config', 'headers'];

/** Tool submodule paths always initialized */
const ESSENTIAL_TOOL_PATHS = ['tools/boost_install', 'tools/build', 'tools/cmake'];

/**
 * Returns the number of available CPU cores for parallel operations.
 *
 * @returns Number of CPU cores, minimum 1
 */
export function numberOfCpus(): number {
    const result = typeof os.availableParallelism === 'function'
        ? os.availableParallelism()
        : os.cpus().length;
    if (!result || result === 0) {
        return 1;
    }
    return result;
}

/**
 * Builds the shared git args for `git submodule update` commands.
 *
 * @param gitFeatures - Git executable capabilities
 * @returns Array of git arguments (jobs, depth, quiet)
 */
function makeSubmoduleUpdateArgs(gitFeatures: GitFeatures): string[] {
    const jobsArgs = gitFeatures.supportsJobs ? ['--jobs', `${numberOfCpus()}`] : [];
    const depthArgs = gitFeatures.supportsDepth ? ['--depth', '1'] : [];
    return jobsArgs.concat(depthArgs).concat(['-q']);
}

/**
 * Batch-initializes all specified modules at once using precomputed dependency data.
 * This is more efficient than layer-by-layer discovery.
 *
 * @param inputs - User inputs
 * @param allModules - Complete set of modules to initialize (including transitive deps)
 * @param gitFeatures - Git capabilities
 * @param patchNames - Names of patch modules already cloned by applyPatches (excluded from git submodule init)
 */
export async function batchInitializeSubmodules(
    inputs: Inputs,
    allModules: Set<string>,
    gitFeatures: GitFeatures,
    patchNames: Set<string> = new Set()
): Promise<void> {
    const fnlog = trace_commands.scoped('batchInitializeSubmodules');

    const gitArgs = makeSubmoduleUpdateArgs(gitFeatures);

    // Seed patch names so they aren't re-cloned via git submodule update
    const allModulesWithEssentials = new Set(allModules);
    for (const mod of ESSENTIAL_MODULES) {
        allModulesWithEssentials.add(mod);
    }
    for (const patchName of patchNames) {
        allModulesWithEssentials.add(patchName);
    }

    // Build list of all submodule paths to initialize, excluding patches
    // (they're already cloned by applyPatches and aren't registered submodules)
    const submoduleInitPaths: string[] = [];
    for (const mod of allModulesWithEssentials) {
        if (!patchNames.has(mod)) {
            submoduleInitPaths.push(`libs/${mod}`);
        }
    }
    for (const tool of ESSENTIAL_TOOL_PATHS) {
        submoduleInitPaths.push(tool);
    }

    fnlog(`Batch initializing ${submoduleInitPaths.length} submodules`);

    // Initialize all submodules in one command with multiple paths
    const args = ['submodule', 'update'].concat(gitArgs).concat(['--init']).concat(submoduleInitPaths);
    await exec.exec(`"${gitFeatures.gitPath}"`, args, { cwd: inputs.boost_dir });

    fnlog('Batch initialization complete');
}

/**
 * Initializes Boost submodules using layer-by-layer dependency discovery.
 *
 * Starts with the requested modules, then recursively discovers and initializes
 * their dependencies by scanning header files. Returns both the complete set
 * of initialized modules and the per-module direct deps discovered during
 * scanning (for journal updates).
 *
 * When `preScannedDeps` is provided (from a partial journal-based resolution),
 * those modules are treated as already scanned — their deps are trusted and
 * only modules not in the pre-scanned set are header-scanned. This avoids
 * rediscovering transitive deps that the journal already knows.
 *
 * @param inputs - Action inputs containing directory and module settings
 * @param allModules - Initial set of modules to initialize
 * @param gitFeatures - Git executable capabilities
 * @param exceptions - Map of header exceptions to module names
 * @param submodulePaths - Set of valid submodule paths from .gitmodules
 * @param patchNames - Names of patch modules already cloned by applyPatches (excluded from git submodule init, seeded into scan loop)
 * @param preScannedDeps - Pre-known deps from journal for validated modules (skips scanning them)
 * @returns The complete set of initialized modules and discovered dependencies
 */
export async function initializeSubmodules(
    inputs: Inputs,
    allModules: Set<string>,
    gitFeatures: GitFeatures,
    exceptions: Record<string, string>,
    submodulePaths: Set<string>,
    patchNames: Set<string> = new Set(),
    preScannedDeps: Map<string, string[]> = new Map()
): Promise<DiscoveryResult> {
    const fnlog = trace_commands.scoped('initializeSubmodules');

    const gitArgs = makeSubmoduleUpdateArgs(gitFeatures);

    // Filter patch modules out of submodule init (they're already cloned, not git submodules)
    const allModulesSubPaths = Array.from(allModules)
        .filter((module) => !patchNames.has(module))
        .map((module) => `libs/${module}`);
    const essentialSubPaths = ESSENTIAL_MODULES.map(m => `libs/${m}`).concat(ESSENTIAL_TOOL_PATHS);
    const initialModuleSubpaths = new Set([...allModulesSubPaths, ...essentialSubPaths]);
    if (initialModuleSubpaths.size > 0) {
        const args = ['submodule', 'update'].concat(gitArgs).concat(['--init', ...initialModuleSubpaths]);
        await exec.exec(`"${gitFeatures.gitPath}"`, args, { cwd: inputs.boost_dir });
    }

    // Seed patch modules as already initialized so they enter the scan loop.
    // This ensures patch headers are scanned for their Boost dependencies,
    // which are then initialized as submodules.
    const initializedModules = new Set(allModules);
    for (const mod of ESSENTIAL_MODULES) {
        initializedModules.add(mod);
    }
    for (const patchName of patchNames) {
        initializedModules.add(patchName);
    }

    // Pre-seed with journal-validated deps so they skip header scanning
    const scannedModules = new Set<string>(preScannedDeps.keys());
    const discoveredDeps = new Map<string, string[]>(preScannedDeps);
    const remainingModules = new Set(
        [...initializedModules].filter(m => !scannedModules.has(m))
    );

    while (remainingModules.size > 0) {
        fnlog(`==== ${remainingModules.size} modules remaining to scan ====`);
        fnlog(`Initialized modules: ${gh_inputs.makeValueString(initializedModules)}`);
        fnlog(`Remaining modules: ${gh_inputs.makeValueString(remainingModules)}`);
        fnlog(`Scanned modules: ${gh_inputs.makeValueString(scannedModules)}`);

        // Scan all modules in this layer in parallel
        const scanResults = await Promise.all([...remainingModules].map(async (mod) => {
            const modulePath = path.resolve(path.join(inputs.boost_dir, 'libs', mod));
            const ignoreSet = new Set<string>(inputs.scan_modules_ignore);
            ignoreSet.add(mod);
            const moduleInputs: Inputs = {
                ...inputs,
                scan_modules_ignore: ignoreSet,
                modules_scan_paths: new Set<string>(),
                modules_exclude_paths: new Set<string>(['test', 'tests', 'example', 'examples'])
            };
            const deps = await scanBoostDependencies(modulePath, moduleInputs, exceptions, submodulePaths);
            fnlog(`Submodules of ${mod}: ${gh_inputs.makeValueString(deps)}`);
            return { mod, deps };
        }));

        // Process results: collect all newly discovered deps
        const newModules = new Set<string>();
        for (const { mod, deps } of scanResults) {
            discoveredDeps.set(mod, [...deps].sort());
            scannedModules.add(mod);
            for (const dep of deps) {
                if (!scannedModules.has(dep) && !initializedModules.has(dep)) {
                    newModules.add(dep);
                }
            }
        }
        remainingModules.clear();

        // Batch-init all new deps in a single git command (skip patches, they're already cloned)
        const toInit = [...newModules].filter(m => !patchNames.has(m));
        if (toInit.length > 0) {
            const paths = toInit.map(m => `libs/${m}`);
            const args = ['submodule', 'update'].concat(gitArgs).concat(['--init', ...paths]);
            await exec.exec(`"${gitFeatures.gitPath}"`, args, { cwd: inputs.boost_dir });
        }
        for (const mod of newModules) {
            initializedModules.add(mod);
            remainingModules.add(mod);
        }
    }

    return { initialized: initializedModules, discoveredDeps };
}


/**
 * Initializes all Boost submodules recursively.
 *
 * Used when no specific modules are requested and the entire Boost library is needed.
 *
 * @param inputs - Action inputs containing the boost directory
 * @param gitFeatures - Git executable capabilities
 */
export async function initializeAllSubmodules(inputs: Inputs, gitFeatures: GitFeatures): Promise<void> {
    const args = ['submodule', 'update']
        .concat(makeSubmoduleUpdateArgs(gitFeatures))
        .concat(['--init', '--recursive']);
    await exec.exec(`"${gitFeatures.gitPath}"`, args, { cwd: inputs.boost_dir });
}
