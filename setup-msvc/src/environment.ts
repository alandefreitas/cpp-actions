/**
 * Environment variable manipulation utilities.
 *
 * @module environment
 */

/**
 * Determines whether the provided environment variable name is PATH-like.
 *
 * @param name - Environment variable name.
 * @returns True when the variable represents a path list.
 *
 * @example
 * isPathVariable('LIB') // true
 *
 * @example
 * isPathVariable('TEMP') // false
 */
export function isPathVariable(name: string): boolean {
    const pathLikeVariables = ['PATH', 'INCLUDE', 'LIB', 'LIBPATH']
    return pathLikeVariables.indexOf(name.toUpperCase()) !== -1
}

/**
 * Deduplicates entries in a PATH-style string while preserving order.
 *
 * @param path - Semi-colon separated path string.
 * @returns Deduplicated path string.
 *
 * @example
 * deduplicatePathValue('C:\\bin;C:\\bin;D:\\bin') // 'C:\\bin;D:\\bin'
 *
 * @remarks
 * Empty segments are preserved intentionally to avoid mutating the caller's
 * environment in unexpected ways.
 */
export function deduplicatePathValue(path: string): string {
    const paths = path.split(';')
    // Remove duplicates by keeping the first occurrence and preserving order.
    // This keeps path shadowing working as intended.
    function unique(value: string, index: number, self: string[]) {
        return self.indexOf(value) === index
    }

    return paths.filter(unique).join(';')
}
