/**
 * Handlebars template helpers for cpp-matrix action.
 *
 * @module handlebars-helpers
 */

import * as Handlebars from 'handlebars';

/**
 * Registers Handlebars helpers for template rendering in extra-values templates.
 *
 * ## Rationale
 *
 * Users of the cpp-matrix action often need to derive values from existing matrix fields
 * (e.g., transforming container names like `ubuntu:24.04` into filesystem-safe strings
 * like `ubuntu-24.04` for cache keys). Without helpers, this requires hardcoding values
 * or defining redundant variables.
 *
 * ## Design Criteria
 *
 * The helper set was designed to:
 *
 * 1. **Cover common string transformations** - The primary use case is deriving cache keys,
 *    artifact names, and conditional values from matrix fields like compiler, version,
 *    and container names.
 *
 * 2. **Maintain GitHub Actions compatibility** - Since this is a GitHub Action, users expect
 *    helpers similar to GitHub Actions expression functions (`${{ }}`). We provide equivalent
 *    helpers: `format`, `toJSON`, `fromJSON`, `join`, and case-insensitive string functions
 *    (`icontains`, `istartsWith`, `iendsWith`) that match GitHub's behavior.
 *
 * 3. **Follow industry standards** - The helper categories and naming conventions follow
 *    the widely-used `handlebars-helpers` library (188+ helpers in 20 categories), ensuring
 *    familiarity for users experienced with Handlebars templating.
 *
 * 4. **Be comprehensive but focused** - Rather than adding helpers incrementally as issues
 *    arise, we provide a complete set covering string, math, array, logical, comparison,
 *    type checking, conversion, and utility operations. This reduces maintenance overhead
 *    and user friction.
 *
 * ## Sources
 *
 * Helper selection was informed by:
 * - GitHub Actions expression functions: https://docs.github.com/en/actions/learn-github-actions/expressions
 * - handlebars-helpers library: https://github.com/helpers/handlebars-helpers
 * - just-handlebars-helpers library: https://www.npmjs.com/package/just-handlebars-helpers
 *
 * ## Helper Categories
 *
 * - **String (21)**: Case conversion, substring operations, search/replace, trimming,
 *   case transformations (camelCase, kebab-case, etc.)
 * - **Case-insensitive (3)**: `icontains`, `istartsWith`, `iendsWith` - matching GitHub Actions behavior
 * - **Logical (4)**: `and`, `or`, `not`, `select` (ternary)
 * - **Comparison (8)**: Equality, inequality, relational operators (case-sensitive and insensitive)
 * - **Math (12)**: Arithmetic, rounding, min/max, power
 * - **Array (8)**: Access, manipulation, searching
 * - **Type checking (4)**: `isString`, `isNumber`, `isArray`, `isEmpty`
 * - **Conversion (3)**: `toNumber`, `toJSON`, `fromJSON`
 * - **Utility (3)**: `default`, `coalesce`, `format`
 *
 * @throws Error if 'and' or 'or' helpers receive fewer than 2 arguments
 *
 * NOTE: When adding or removing helpers, update the helper tables in
 * `cpp-matrix/action.yml` (under "Extra values in entries") so the
 * documentation stays in sync.
 */
export function registerHelpers(): void {
    // String operators
    Handlebars.registerHelper('lowercase', function (value: string) {
        return value.toLowerCase();
    });
    Handlebars.registerHelper('uppercase', function (value: string) {
        return value.toUpperCase();
    });
    Handlebars.registerHelper('contains', function (str: string, substr: string) {
        return str.includes(substr);
    });
    for (const key of ['startsWith', 'starts-with']) {
        Handlebars.registerHelper(key, function (str: string, substr: string) {
            return str.startsWith(substr);
        });
    }
    for (const key of ['endsWith', 'ends-with']) {
        Handlebars.registerHelper(key, function (str: string, substr: string) {
            return str.endsWith(substr);
        });
    }
    Handlebars.registerHelper('substr', function (str: string, start: number, end: number) {
        return str.substring(start, end);
    });
    Handlebars.registerHelper('replace', function (...args: unknown[]) {
        args.pop(); // Remove Handlebars options
        let str = String(args[0]);
        for (let i = 1; i < args.length - 1; i += 2) {
            str = str.split(String(args[i])).join(String(args[i + 1]));
        }
        return str;
    });
    Handlebars.registerHelper('replaceFirst', function (str: string, search: string, replacement: string) {
        return str.replace(search, replacement);
    });
    Handlebars.registerHelper('indexOf', function (str: string, substr: string) {
        return str.indexOf(substr);
    });
    Handlebars.registerHelper('lastIndexOf', function (str: string, substr: string) {
        return str.lastIndexOf(substr);
    });
    Handlebars.registerHelper('split', function (str: string, delimiter: string) {
        return str.split(delimiter);
    });
    Handlebars.registerHelper('trim', function (str: string) {
        return str.trim();
    });
    Handlebars.registerHelper('trimLeft', function (str: string) {
        return str.trimStart();
    });
    Handlebars.registerHelper('trimRight', function (str: string) {
        return str.trimEnd();
    });
    Handlebars.registerHelper('capitalize', function (str: string) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    });
    Handlebars.registerHelper('titlecase', function (str: string) {
        return str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
    });
    Handlebars.registerHelper('camelcase', function (str: string) {
        return str.replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '').replace(/^./, s => s.toLowerCase());
    });
    Handlebars.registerHelper('pascalcase', function (str: string) {
        return str.replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '').replace(/^./, s => s.toUpperCase());
    });
    Handlebars.registerHelper('snakecase', function (str: string) {
        return str.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[-\s]+/g, '_').toLowerCase();
    });
    Handlebars.registerHelper('kebabcase', function (str: string) {
        return str.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[_\s]+/g, '-').toLowerCase();
    });
    Handlebars.registerHelper('reverse', function (val: string | unknown[]) {
        return Array.isArray(val) ? [...val].reverse() : val.split('').reverse().join('');
    });
    // Logical operators
    Handlebars.registerHelper('and', function (...args: unknown[]) {
        const numArgs = args.length;
        if (numArgs === 3) return args[0] && args[1];
        if (numArgs < 3) throw new Error('{{and}} helper expects at least 2 arguments');
        args.pop();
        return args.every((it) => it);
    });
    Handlebars.registerHelper('or', function (...args: unknown[]) {
        const numArgs = args.length;
        if (numArgs === 3) return args[0] || args[1];
        if (numArgs < 3) throw new Error('{{or}} helper expects at least 2 arguments');
        args.pop();
        return args.some((it) => it);
    });
    Handlebars.registerHelper('not', function (value: unknown) {
        return !value;
    });
    Handlebars.registerHelper('select', function (...args: unknown[]) {
        args.pop(); // Remove Handlebars options
        for (let i = 0; i < args.length - 1; i += 2) {
            if (args[i]) {
                return args[i + 1];
            }
        }
        // Odd trailing argument = default value
        if (args.length % 2 === 1) {
            return args[args.length - 1];
        }
        return '';
    });
    // Relational operators
    Handlebars.registerHelper('eq', function (a: unknown, b: unknown) {
        return a === b;
    });
    Handlebars.registerHelper('ieq', function (a: string, b: string) {
        return a.toLowerCase() === b.toLowerCase();
    });
    Handlebars.registerHelper('ne', function (a: unknown, b: unknown) {
        return a !== b;
    });
    Handlebars.registerHelper('ine', function (a: string, b: string) {
        return a.toLowerCase() !== b.toLowerCase();
    });
    // Case-insensitive string helpers (matching GitHub Actions behavior)
    Handlebars.registerHelper('icontains', function (str: string, substr: string) {
        return str.toLowerCase().includes(substr.toLowerCase());
    });
    for (const key of ['istartsWith', 'istarts-with']) {
        Handlebars.registerHelper(key, function (str: string, substr: string) {
            return str.toLowerCase().startsWith(substr.toLowerCase());
        });
    }
    for (const key of ['iendsWith', 'iends-with']) {
        Handlebars.registerHelper(key, function (str: string, substr: string) {
            return str.toLowerCase().endsWith(substr.toLowerCase());
        });
    }
    Handlebars.registerHelper('lt', function (a: number, b: number) {
        return a < b;
    });
    Handlebars.registerHelper('le', function (a: number, b: number) {
        return a <= b;
    });
    Handlebars.registerHelper('gt', function (a: number, b: number) {
        return a > b;
    });
    Handlebars.registerHelper('ge', function (a: number, b: number) {
        return a >= b;
    });
    // Conversion operators
    Handlebars.registerHelper('toNumber', function (value: string) {
        return Number(value);
    });
    Handlebars.registerHelper('toJSON', function (val: unknown) {
        return JSON.stringify(val);
    });
    Handlebars.registerHelper('fromJSON', function (str: string) {
        return JSON.parse(str);
    });
    // Math operators
    Handlebars.registerHelper('add', function (a: number, b: number) {
        return Number(a) + Number(b);
    });
    Handlebars.registerHelper('sub', function (a: number, b: number) {
        return Number(a) - Number(b);
    });
    Handlebars.registerHelper('mul', function (a: number, b: number) {
        return Number(a) * Number(b);
    });
    Handlebars.registerHelper('div', function (a: number, b: number) {
        return Number(a) / Number(b);
    });
    Handlebars.registerHelper('mod', function (a: number, b: number) {
        return Number(a) % Number(b);
    });
    Handlebars.registerHelper('abs', function (n: number) {
        return Math.abs(Number(n));
    });
    Handlebars.registerHelper('floor', function (n: number) {
        return Math.floor(Number(n));
    });
    Handlebars.registerHelper('ceil', function (n: number) {
        return Math.ceil(Number(n));
    });
    Handlebars.registerHelper('round', function (n: number) {
        return Math.round(Number(n));
    });
    Handlebars.registerHelper('min', function (...args: unknown[]) {
        args.pop(); // Remove Handlebars options object
        return Math.min(...args.map(Number));
    });
    Handlebars.registerHelper('max', function (...args: unknown[]) {
        args.pop(); // Remove Handlebars options object
        return Math.max(...args.map(Number));
    });
    Handlebars.registerHelper('pow', function (base: number, exp: number) {
        return Math.pow(Number(base), Number(exp));
    });
    // Constructors
    Handlebars.registerHelper('list', function (...args: unknown[]) {
        args.pop(); // Remove Handlebars options
        return args;
    });
    Handlebars.registerHelper('dict', function (...args: unknown[]) {
        args.pop(); // Remove Handlebars options
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < args.length - 1; i += 2) {
            obj[String(args[i])] = args[i + 1];
        }
        return obj;
    });
    // Array operators
    Handlebars.registerHelper('join', function (arr: unknown[], delimiter: string) {
        return arr.join(delimiter);
    });
    Handlebars.registerHelper('first', function (arr: unknown[]) {
        return arr[0];
    });
    Handlebars.registerHelper('last', function (arr: unknown[]) {
        return arr[arr.length - 1];
    });
    Handlebars.registerHelper('nth', function (arr: unknown[], n: number) {
        return arr[n];
    });
    Handlebars.registerHelper('length', function (val: string | unknown[]) {
        return val.length;
    });
    Handlebars.registerHelper('slice', function (arr: unknown[], start: number, end?: number) {
        return arr.slice(start, end);
    });
    Handlebars.registerHelper('sort', function (arr: unknown[]) {
        return [...arr].sort();
    });
    Handlebars.registerHelper('includes', function (arr: unknown[], value: unknown) {
        return arr.includes(value);
    });
    // Type checking operators
    Handlebars.registerHelper('isString', function (val: unknown) {
        return typeof val === 'string';
    });
    Handlebars.registerHelper('isNumber', function (val: unknown) {
        return typeof val === 'number' && !isNaN(val);
    });
    Handlebars.registerHelper('isArray', function (val: unknown) {
        return Array.isArray(val);
    });
    Handlebars.registerHelper('isEmpty', function (val: unknown) {
        return val === '' || val === null || val === undefined ||
            (Array.isArray(val) && val.length === 0);
    });
    // Utility operators
    Handlebars.registerHelper('default', function (val: unknown, defaultVal: unknown) {
        return val || defaultVal;
    });
    Handlebars.registerHelper('coalesce', function (...args: unknown[]) {
        args.pop(); // Remove Handlebars options
        return args.find(arg => arg !== null && arg !== undefined);
    });
    Handlebars.registerHelper('format', function (str: string, ...args: unknown[]) {
        args.pop(); // Remove Handlebars options
        return str.replace(/\{(\d+)}/g, (_, i) => String(args[Number(i)] ?? ''));
    });
}
