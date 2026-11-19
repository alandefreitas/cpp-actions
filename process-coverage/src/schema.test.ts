import * as path from 'node:path';

import { inputsSchema, outputsSchema } from './schema';

const compilerVersion = inputsSchema.compilerVersion.transform;
const includeTransform = inputsSchema.include.transform;
const excludeTransform = inputsSchema.exclude.transform;

describe('process-coverage schema', () => {
    describe('compilerVersion transform', () => {
        it.each([
            ['', ''],
            ['   ', ''],
            ['*', ''],
            [' * ', ''],
            ['14', '14'],
            [' 18 ', '18'],
            ['14.2.0', '14'],
            ['14.2', '14'],
            ['>=14', '14'],
            ['^17.0.1', '17'],
            ['>=3.8 <6 || >11', '3'],
            ['x', '0'],
            ['x.x', '0']
        ])('maps %p to major %p', (input, expected) => {
            expect(compilerVersion(input)).toBe(expected);
        });
    });

    describe('include/exclude transforms', () => {
        it.each([
            ['include', includeTransform],
            ['exclude', excludeTransform]
        ])('%s keeps absolute, wildcard and negated patterns unchanged', (_name, transform) => {
            expect(transform(['/abs/src/**', '**/test/**', '!**/gen/**']))
                .toEqual(['/abs/src/**', '**/test/**', '!**/gen/**']);
        });

        it.each([
            ['include', includeTransform],
            ['exclude', excludeTransform]
        ])('%s resolves relative patterns against cwd with forward slashes', (_name, transform) => {
            const expected = path.resolve('src/**').replace(/\\/g, '/');
            const expectedParent = path.resolve('../boost-root/libs/url/**').replace(/\\/g, '/');
            const result = transform(['src/**', '../boost-root/libs/url/**']) as string[];
            expect(result).toEqual([expected, expectedParent]);
            for (const p of result) {
                expect(p).not.toContain('\\');
            }
        });

        it('returns an empty list for an empty list', () => {
            expect(includeTransform([])).toEqual([]);
            expect(excludeTransform([])).toEqual([]);
        });
    });

    describe('inputs', () => {
        it('includes the shared traceCommands input', () => {
            expect(inputsSchema.traceCommands.type).toBe('boolean');
            expect(inputsSchema.traceCommands.default).toBe(false);
        });

        it('declares the documented defaults', () => {
            expect(inputsSchema.buildDir.default).toEqual(['build']);
            expect(inputsSchema.summary.default).toBe(true);
            expect(inputsSchema.htmlReport.default).toBe(false);
            expect(inputsSchema.htmlReportArtifact.default).toBe('<auto>');
            expect(inputsSchema.htmlReportRetentionDays.default).toBe(30);
            expect(inputsSchema.stripExclMarkers.default).toBe(true);
            expect(inputsSchema.profrawPattern.default).toBe('*.profraw');
            expect(inputsSchema.failOnUploadError.default).toBe(true);
        });

        it('falls back to the CXX environment variable for cxx', () => {
            expect(inputsSchema.cxx.fallbackEnv).toBe('CXX');
        });

        it('documents every input', () => {
            for (const [name, spec] of Object.entries(inputsSchema)) {
                expect({ name, hasDescription: spec.description.length > 0 })
                    .toEqual({ name, hasDescription: true });
            }
        });
    });

    describe('outputs', () => {
        it('declares file paths and all coverage metrics', () => {
            const metrics = ['lines', 'functions', 'branches'];
            const expected = ['lcovFile', 'htmlReportDir'];
            for (const m of metrics) {
                expected.push(`${m}Covered`, `${m}Total`, `${m}Percent`);
            }
            for (const m of metrics) {
                const cap = m[0].toUpperCase() + m.slice(1);
                expected.push(`new${cap}Covered`, `new${cap}Total`, `new${cap}Percent`);
            }
            expect(Object.keys(outputsSchema).sort()).toEqual(expected.sort());
        });
    });
});
