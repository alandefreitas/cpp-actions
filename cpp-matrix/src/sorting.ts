/**
 * Matrix sorting utilities for cpp-matrix action.
 *
 * @module sorting
 */

import { Inputs, MatrixEntry } from './types';

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
    const contains_factor = (entry: MatrixEntry): boolean => {
        let allFactors: string[] = [];
        if (entry['compiler'] in inputs.latest_factors) {
            allFactors.push(...inputs.latest_factors[entry['compiler']]);
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

    const is_latest_no_factor = (entry: MatrixEntry): boolean => {
        return entry['is-latest'] && !entry['is-earliest'] && !contains_factor(entry);
    };

    const is_unique_no_factor = (entry: MatrixEntry): boolean => {
        return entry['is-latest'] && entry['is-earliest'] && !contains_factor(entry);
    };

    const is_earliest_no_factor = (entry: MatrixEntry): boolean => {
        return entry['is-earliest'] && !entry['is-latest'] && !contains_factor(entry);
    };

    matrix.reverse();
    matrix.sort(function (a, b) {
        // Latest compilers come first
        const a0 = is_latest_no_factor(a);
        const b0 = is_latest_no_factor(b);
        if (a0 && !b0) {
            return -1;
        } else if (!a0 && b0) {
            return 1;
        }

        // Then compilers with a single version
        const a1 = is_unique_no_factor(a);
        const b1 = is_unique_no_factor(b);
        if (a1 && !b1) {
            return -1;
        } else if (!a1 && b1) {
            return 1;
        }

        // Then the oldest compilers
        const a2 = is_earliest_no_factor(a);
        const b2 = is_earliest_no_factor(b);
        if (a2 && !b2) {
            return -1;
        } else if (!a2 && b2) {
            return 1;
        }

        // Then configurations with special factors
        const a3 = contains_factor(a);
        const b3 = contains_factor(b);
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
