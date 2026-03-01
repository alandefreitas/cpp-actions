/**
 * Schema definitions for the boost-clone action.
 *
 * This file is the single source of truth for inputs and outputs.
 * Types are inferred from these schemas, and action.yml is generated from them.
 *
 * @module schema
 */

import {
    baseInputs,
    type ActionInputsSchema,
    type ActionOutputsSchema
} from 'action-schema';

/**
 * Valid clone strategies for obtaining Boost source files.
 */
export type CloneStrategy = 'auto' | 'git' | 'archive';

/**
 * Input schema for the boost-clone action.
 */
export const inputsSchema = {
    ...baseInputs,

    boost_dir: {
        type: 'string' as const,
        default: '',
        description: `The directory where Boost should be cloned.

If no value is provided (default), the action will clone boost in a temporary directory.`
    },

    branch: {
        type: 'string' as const,
        default: 'master',
        description: `Branch of the super-project.

Boost projects should usually set this to \`develop\` or \`master\` according
to the project branch they are working on.`
    },

    patches: {
        type: 'string[]' as const,
        default: [] as string[],
        description: `A list of patches to apply to the boost super-project.

A patch is a module intended as a Boost library that is not yet part of the super-project.

Each path will be cloned in the \`libs\` directory of the super-project.`
    },

    modules: {
        type: 'string[]' as const,
        default: [] as string[],
        description: `The boost submodules we need to clone.

This field is optional. If not set, the action will scan the modules found in \`scan-modules-dir\`.`
    },

    scan_modules_dir: {
        type: 'multiline' as const,
        default: ['.'] as string[],
        description: `An independent directory we should scan for boost dependencies to clone.
This option also accepts a multi-line string with multiple directories.

This is usually a directory in the current project that requires boost libraries.
The Boost modules required in files from this directory will be added to the \`modules\` list.

Only the subdirectories of this directory specified by \`modules-scan-paths\` will be scanned.`
    },

    modules_scan_paths: {
        type: 'string[]' as const,
        default: [] as string[],
        description: `Additional module subdirectory to scan.

For instance, by setting it to \`test\` the action will scan the \`test\` directory for boost dependencies.

By default, the action scans the ['include', 'src', 'source', 'test', 'tests', 'example', 'examples'] directories.`
    },

    modules_exclude_paths: {
        type: 'string[]' as const,
        default: ['test', 'tests'] as string[],
        description: `Module subdirectory to exclude from scanning.

Directories that match any of the values in this list will be ignored.

By default, the action excludes the ['test', 'tests'] directories.`
    },

    scan_modules_ignore: {
        type: 'string[]' as const,
        default: [] as string[],
        description: `List of modules that should be ignored in scan-modules.

This if often useful to exclude the current project's libraries from the scan.`
    },

    cache: {
        type: 'boolean' as const,
        default: true,
        description: `Cache the boost source directory for future builds.
The cache key will include the boost hash, the modules hash and the patch hashes.

When using the cache, the action will not rescan dependencies. This means that if a transitive
dependency is updated and \`optimistic-caching\` is being used, the cache will not be invalidated.
The previous version of the transitive dependency will be used until the cache expires.`
    },

    optimistic_caching: {
        type: 'boolean' as const,
        default: false,
        description: `If this option is \`true\`, the action will reuse the cache whenever direct dependencies haven't changed.

For instance, if your library depends on Boost.Url and Boost.Url depends on Boost.Optional, then
the cache will be reused for as long as Boost.Url hasn't changed, even if Boost.Optional has
changed. If you know about a change in a transitive dependency that affects your library, the
current cache should be invalidated for the changes to take effect.

In the \`develop\` branch, this makes the cache much more useful, as the super-project hash changes
many times a day and the cache would be invalidated every time that happens. The downside is that
if a transitive dependency is updated, the cache will not be invalidated until the current cache expires.
However, this option assumes changes in transitive dependencies should not usually affect the library.

If this option is set to \`false\`, the cache will be invalidated whenever the hash of the Boost super-project
repository changes, which implies it's also updated whenever a transitive dependency is updated. Note that
in this pessimistic case, the cache will be invalidated even if the change in the super-project is unrelated
to the library, even when considering transitive dependencies. This makes the pessimistic option more
pessimistic than it should be.

The reason we have to use the main super-project hash in the cache key is that calculating a new
hash only for transitive dependencies would require us to clone these transitive dependencies, which
makes the cache useless.

The default value is \`false\`, because we prioritize correctness over performance. However,
most users should consider the possibility of setting this option to \`true\`, considering their requirements.`
    },

    clone_strategy: {
        type: 'string' as const,
        default: 'auto',
        description: `Strategy for obtaining Boost source files.

- \`auto\`: Automatically select the best strategy based on branch type and module count.
  For release tags with many modules (>25), downloads the CMake release archive.
  For develop/master or few modules, uses git clone with batch initialization.
- \`git\`: Always use git clone (current behavior, with batch-init optimization).
- \`archive\`: Always download the CMake release archive (only works for release tags).

The archive strategy is faster when many modules are needed, as it avoids per-module
git overhead. However, it only works for release tags (e.g., boost-1.87.0), not for
develop/master branches.`
    },

    archive_threshold: {
        type: 'number' as const,
        default: 25,
        description: `Number of total modules (including transitive dependencies) above which the archive
strategy is preferred over git clone.

Only applies when clone-strategy is 'auto' and branch is a release tag.

The default of 25 is an approximate crossover point based on typical network
conditions. Archive download has a fixed overhead (~30s for the ~80MB CMake archive)
but no per-module cost. Git clone has lower initial cost but adds ~0.5-1s per module
for submodule initialization. For projects needing fewer modules, git is faster;
for more modules, archive becomes more efficient. Adjust based on your network and
typical module count.`
    }
} satisfies ActionInputsSchema;

/**
 * Output schema for the boost-clone action.
 */
export const outputsSchema = {
    boost_dir: {
        description: 'The absolute path to the boost source files.'
    }
} satisfies ActionOutputsSchema;
