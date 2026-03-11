/**
 * Matrix sorting utilities for cpp-matrix action.
 *
 * @module sorting
 */

import { type Inputs, type MatrixEntry } from './types';

/**
 * Sorts the matrix entries by priority order.
 *
 * @param matrix - Matrix array to sort
 * @param inputs - Action inputs
 */
export function sortMatrix(matrix: MatrixEntry[], inputs: Inputs): void {
    // Sort matrix
    // 1) Latest
    // 2) Unique
    // 3) Earliest
    // 4) Factors
    // 5) Intermediary
    const containsFactor = (entry: MatrixEntry): boolean => {
        let allFactors: string[] = [];
        if (entry['compiler'] in inputs.latestFactors) {
            allFactors.push(...inputs.latestFactors[entry['compiler']]);
        }
        if (entry['compiler'] in inputs.factors) {
            allFactors.push(...inputs.factors[entry['compiler']]);
        }
        if (allFactors.length === 0) {
            return false;
        }
        allFactors = allFactors.map(f => f.toLowerCase());
        for (const [key, value] of Object.entries(entry)) {
            if (value === true && allFactors.includes(key)) {
                return true;
            }
        }
        return false;
    };

    const isLatestNoFactor = (entry: MatrixEntry): boolean => {
        return entry['is-latest'] && !entry['is-earliest'] && !containsFactor(entry);
    };

    const isUniqueNoFactor = (entry: MatrixEntry): boolean => {
        return entry['is-latest'] && entry['is-earliest'] && !containsFactor(entry);
    };

    const isEarliestNoFactor = (entry: MatrixEntry): boolean => {
        return entry['is-earliest'] && !entry['is-latest'] && !containsFactor(entry);
    };

    matrix.reverse();
    matrix.sort(function (a, b) {
        // Latest compilers come first
        const a0 = isLatestNoFactor(a);
        const b0 = isLatestNoFactor(b);
        if (a0 && !b0) {
            return -1;
        } else if (!a0 && b0) {
            return 1;
        }

        // Then compilers with a single version
        const a1 = isUniqueNoFactor(a);
        const b1 = isUniqueNoFactor(b);
        if (a1 && !b1) {
            return -1;
        } else if (!a1 && b1) {
            return 1;
        }

        // Then the oldest compilers
        const a2 = isEarliestNoFactor(a);
        const b2 = isEarliestNoFactor(b);
        if (a2 && !b2) {
            return -1;
        } else if (!a2 && b2) {
            return 1;
        }

        // Then configurations with special factors
        const a3 = containsFactor(a);
        const b3 = containsFactor(b);
        if (a3 && !b3) {
            return -1;
        } else if (!a3 && b3) {
            return 1;
        }

        // Then, ceteris paribus, compilers with fewer entries come first
        // so that it increases the changes all seeing all compilers on the screen
        const an = matrix.filter(entry => entry.compiler === a.compiler).length;
        const bn = matrix.filter(entry => entry.compiler === b.compiler).length;
        if (an < bn) {
            return -1;
        } else if (an > bn) {
            return 1;
        } else {
            return 0;
        }
    });
}
