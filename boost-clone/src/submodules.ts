/**
 * Submodule initialization utilities for boost-clone action.
 *
 * @module submodules
 */

import * as exec from '@actions/exec';
import * as path from 'path';
import * as os from 'os';
import * as trace_commands from 'trace-commands';
import * as gh_inputs from 'gh-inputs';
import { Inputs, GitFeatures } from './types';
import { scanBoostDependencies } from './header-scan';

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
 * Batch-initializes all specified modules at once using precomputed dependency data.
 * This is more efficient than layer-by-layer discovery.
 *
 * @param inputs - User inputs
 * @param allModules - Complete set of modules to initialize (including transitive deps)
 * @param gitFeatures - Git capabilities
 */
export async function batchInitializeSubmodules(
    inputs: Inputs,
    allModules: Set<string>,
    gitFeatures: GitFeatures
): Promise<void> {
    function fnlog(msg: string): void {
        trace_commands.log(`batchInitializeSubmodules: ${msg}`);
    }

    const jobsArgs = gitFeatures.supportsJobs ? ['--jobs', `${numberOfCpus()}`] : [];
    const depthArgs = gitFeatures.supportsDepth ? ['--depth', '1'] : [];
    const gitArgs = jobsArgs.concat(depthArgs).concat(['-q']);

    // Add essential modules
    const essentialModules = ['config', 'headers'];
    const essentialTools = ['tools/boost_install', 'tools/build', 'tools/cmake'];

    const allModulesWithEssentials = new Set(allModules);
    for (const mod of essentialModules) {
        allModulesWithEssentials.add(mod);
    }

    // Build list of all submodule paths to initialize
    const submodulePaths: string[] = [];
    for (const mod of allModulesWithEssentials) {
        submodulePaths.push(`libs/${mod}`);
    }
    for (const tool of essentialTools) {
        submodulePaths.push(tool);
    }

    fnlog(`Batch initializing ${submodulePaths.length} submodules`);

    // Initialize all submodules in one command with multiple paths
    // This is more efficient than individual commands
    for (const submodulePath of submodulePaths) {
        const args = ['submodule', 'update'].concat(gitArgs).concat(['--init', submodulePath]);
        await exec.exec(`"${gitFeatures.gitPath}"`, args, { cwd: inputs.boost_dir });
    }

    fnlog('Batch initialization complete');
}

/**
 * Initializes Boost submodules using layer-by-layer dependency discovery.
 *
 * Starts with the requested modules, then recursively discovers and initializes
 * their dependencies by scanning header files.
 *
 * @param inputs - Action inputs containing directory and module settings
 * @param allModules - Initial set of modules to initialize
 * @param gitFeatures - Git executable capabilities
 * @param exceptions - Map of header exceptions to module names
 * @param submodulePaths - Set of valid submodule paths from .gitmodules
 */
export async function initializeSubmodules(inputs: Inputs, allModules: Set<string>, gitFeatures: GitFeatures, exceptions: Record<string, string>, submodulePaths: Set<string>): Promise<void> {
    function fnlog(msg: string): void {
        trace_commands.log(`initializeSubmodules: ${msg}`);
    }

    const jobsArgs = gitFeatures.supportsJobs ? ['--jobs', `${numberOfCpus()}`] : [];
    const depthArgs = gitFeatures.supportsDepth ? ['--depth', '1'] : [];
    const gitArgs = jobsArgs.concat(depthArgs).concat(['-q']);

    const allModulesSubPaths = new Set(Array.from(allModules).map((module) => `libs/${module}`));
    const essentialModuleSubPaths = new Set(['libs/config', 'libs/headers', 'tools/boost_install', 'tools/build', 'tools/cmake']);
    const initialModuleSubpaths = new Set(Array.from(allModulesSubPaths).concat(Array.from(essentialModuleSubPaths)));
    for (const moduleSubPath of initialModuleSubpaths) {
        const args = ['submodule', 'update'].concat(gitArgs).concat(['--init', moduleSubPath]);
        await exec.exec(`"${gitFeatures.gitPath}"`, args, { cwd: inputs.boost_dir });
    }

    const initializedModules = new Set(allModules);
    initializedModules.add('config');
    initializedModules.add('headers');
    const scannedModules = new Set<string>();
    const remainingModules = new Set(initializedModules);
    while (remainingModules.size > 0) {
        fnlog(`==== ${remainingModules.size} modules remaining to scan ====`);
        fnlog(`Initialized modules: ${gh_inputs.makeValueString(initializedModules)}`);
        fnlog(`Remaining modules: ${gh_inputs.makeValueString(remainingModules)}`);
        fnlog(`Scanned modules: ${gh_inputs.makeValueString(scannedModules)}`);

        const module = remainingModules.values().next().value as string;
        const modulePath = path.resolve(path.join(inputs.boost_dir, 'libs', module));
        const moduleInputs: Inputs = {
            ...inputs,
            scan_modules_ignore: new Set<string>([module]),
            modules_scan_paths: new Set<string>(),
            modules_exclude_paths: new Set<string>(['test', 'tests', 'example', 'examples'])
        };
        const submodules = await scanBoostDependencies(modulePath, moduleInputs, exceptions, submodulePaths);
        fnlog(`Submodules of ${module}: ${gh_inputs.makeValueString(submodules)}`);
        scannedModules.add(module);
        remainingModules.delete(module);

        // Initialize submodules
        for (const submodule of submodules) {
            // Add to the list if not scanned yet
            if (!scannedModules.has(submodule)) {
                fnlog(`Submodule: ${submodule} has not been scanned yet`);
                remainingModules.add(submodule);
                fnlog(`Remaining modules: ${gh_inputs.makeValueString(remainingModules)}`);
            } else {
                fnlog(`Submodule: ${submodule} has already been scanned`);
            }
            // Initialize submodule if not initialized yet
            if (!initializedModules.has(submodule)) {
                fnlog(`Initializing submodule: ${submodule}`);
                const moduleSubPath = `libs/${submodule}`;
                const args = ['submodule', 'update'].concat(gitArgs).concat(['--init', moduleSubPath]);
                await exec.exec(`"${gitFeatures.gitPath}"`, args, { cwd: inputs.boost_dir });
                initializedModules.add(submodule);
                fnlog(`Initialized modules: ${gh_inputs.makeValueString(initializedModules)}`);
            } else {
                fnlog(`Submodule: ${submodule} has already been initialized`);
            }
        }
    }
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
        .concat(gitFeatures.supportsDepth ? ['--depth', '1'] : [])
        .concat(gitFeatures.supportsJobs ? ['--jobs', `${numberOfCpus()}`] : [])
        .concat(['--init', '--recursive']);
    await exec.exec(`"${gitFeatures.gitPath}"`, args, { cwd: inputs.boost_dir });
}
