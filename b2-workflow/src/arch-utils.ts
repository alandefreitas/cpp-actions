/**
 * Architecture utilities for B2 workflow.
 *
 * @module arch-utils
 */

import * as os from 'os';

import { normalizeArchitectureInput } from 'setup-program';
export { normalizeArchitectureInput };

/**
 * Configuration for B2 architecture settings.
 */
export interface ArchConfig {
    /** Normalized architecture identifier (x86, x64, arm, arm64) */
    normalizedArch: string;
    /** B2 address model (32 or 64 bit) */
    addressModel?: string;
    /** B2 architecture family (x86 or arm) */
    architecture?: string;
}

/**
 * Returns the number of available CPU cores.
 *
 * @returns Number of available CPUs, minimum 1
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
 * Derives B2 architecture configuration from an architecture string.
 *
 * Maps architecture to appropriate address model (32/64 bit) and
 * architecture family (x86/arm) for B2 build configuration.
 *
 * @param arch - Architecture string to derive configuration from
 * @returns Architecture configuration with normalized values
 */
export function deriveB2ArchConfig(arch: string): ArchConfig {
    const normalizedArch = normalizeArchitectureInput(arch);
    if (!normalizedArch) {
        return { normalizedArch: '' };
    }
    if (normalizedArch === 'x86') {
        return { normalizedArch, addressModel: '32', architecture: 'x86' };
    }
    if (normalizedArch === 'x64') {
        return { normalizedArch, addressModel: '64', architecture: 'x86' };
    }
    if (normalizedArch === 'arm') {
        return { normalizedArch, addressModel: '32', architecture: 'arm' };
    }
    if (normalizedArch === 'arm64') {
        return { normalizedArch, addressModel: '64', architecture: 'arm' };
    }
    return { normalizedArch };
}
