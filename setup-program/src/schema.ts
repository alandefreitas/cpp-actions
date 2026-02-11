/**
 * Schema definitions for the setup-program action.
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
 * Input schema for the setup-program action.
 */
export const inputsSchema = {
    ...baseInputs,

    name: {
        type: 'string[]' as const,
        splitter: / /,
        required: true,
        description: `The name of the executable we should look for.

This parameter can also include a list of names to look for.`
    },

    version: {
        type: 'string' as const,
        default: '*',
        description: `Version range or exact version of the program to use, using SemVer's version range syntax.

By default, it uses any version available in the environment.

If a version is provided, any executable found will be run with the --version option
and the result will be parsed to look for a semver version, which will be considered
the version we found.`
    },

    path: {
        type: 'string[]' as const,
        splitter: /[:;]/,
        default: [] as string[],
        description: `Specify directories and paths to search in addition to the default locations.

The paths can be separated by ':' or ';'.`
    },

    check_latest: {
        type: 'boolean' as const,
        default: false,
        description: 'Set this option if you want the action to check for the latest available version that satisfies the version spec.'
    },

    url: {
        type: 'string' as const,
        default: '',
        description: `The URL to download the program binaries when it is not available in the environment.

To simplify the download, the URL can contain the following placeholders:

- \`{{name}}\`: The program name.

- \`{{version}}\`: The version of the program to download. (coerced from the version input)

- \`{{version-major}}\`: The major version of the program to download. (coerced from the version input)

- \`{{version-minor}}\`: The minor version of the program to download. (coerced from the version input)

- \`{{version-patch}}\`: The patch version of the program to download. (coerced from the version input)

- \`{{platform}}\`: The platform name. (process.platform)

- \`{{os}}\`: The operating system name. (process.platform converted to 'windows', 'macos', or 'linux')

- \`{{arch}}\`: The architecture name. (process.arch)`
    },

    install_prefix: {
        type: 'string' as const,
        default: '',
        description: `The directory where the tool should be installed if it's not available in the environment.

By default, the tool will be installed in the hosttools cache directory.`
    },

    update_environment: {
        type: 'boolean' as const,
        default: true,
        description: 'Set this option if you want the action to update environment variables.'
    },

    fail_on_error: {
        type: 'boolean' as const,
        default: true,
        description: 'Fail if the program is not found.'
    }
} satisfies ActionInputsSchema;

/**
 * Output schema for the setup-program action.
 */
export const outputsSchema = {
    path: {
        description: 'The absolute path to the program executable.'
    },
    dir: {
        description: 'The absolute path to the directory containing the executable.'
    },
    version: {
        description: 'The installed program version. Useful when given a version range as input.'
    },
    version_major: {
        description: 'The installed program version major. Useful when given a version range as input.'
    },
    version_minor: {
        description: 'The installed program version minor. Useful when given a version range as input.'
    },
    version_patch: {
        description: 'The installed program version patch. Useful when given a version range as input.'
    },
    found: {
        description: 'Whether the program was found.'
    }
} satisfies ActionOutputsSchema;
