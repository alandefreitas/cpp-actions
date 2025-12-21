/**
 * Architecture utilities for B2 workflow.
 *
 * @module arch-utils
 */

import * as os from 'os';

import { ArchConfig } from './types';

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
 * Normalizes an architecture string to a standard format.
 *
 * @param arch - Architecture string to normalize
 * @returns Normalized architecture: 'x86', 'x64', 'arm', 'arm64', or original
 */
export function normalizeArchitectureInput(arch: string): string {
    if (!arch) {
        return '';
    }
    const token = arch.toLowerCase();
    if (['x86', 'win32', 'ia32', 'i386', 'i486', 'i586', 'i686'].includes(token)) {
        return 'x86';
    }
    if (['x64', 'amd64', 'x86_64', 'x86-64'].includes(token)) {
        return 'x64';
    }
    if (['arm', 'arm32'].includes(token)) {
        return 'arm';
    }
    if (['arm64', 'aarch64'].includes(token)) {
        return 'arm64';
    }
    return arch;
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
