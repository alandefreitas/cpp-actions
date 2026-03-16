import { inputsSchema, outputsSchema } from './schema';

describe('inputsSchema', () => {
    it('defines all expected input fields', () => {
        const expectedFields = [
            'compilers', 'subrangePolicy', 'standards', 'maxStandards',
            'latestFactors', 'factors', 'combinatorialFactors', 'forceFactors',
            'generators', 'generatorToolsets', 'containers', 'useContainers',
            'buildTypes', 'defaultBuildType', 'ccflags', 'cxxflags',
            'install', 'runsOn', 'b2Toolsets', 'triplets',
            'extraValues', 'traceCommands', 'logMatrix', 'generateSummary',
            'outputFile', 'failureRateRuns', 'sortByFailureRate', 'githubToken',
            'warnNoMatches', 'sanitizerBuildType', 'x86BuildType',
            'appendInstall', 'appendCcflags', 'appendCxxflags'
        ];
        for (const field of expectedFields) {
            expect(inputsSchema).toHaveProperty(field);
        }
    });

    it('every input has a type, default, and description', () => {
        for (const [, schema] of Object.entries(inputsSchema)) {
            const s = schema as Record<string, unknown>;
            expect(s.type).toBeDefined();
            expect(s).toHaveProperty('default');
            expect(typeof s.description).toBe('string');
            expect((s.description as string).length).toBeGreaterThan(0);
        }
    });

    it('compilers transform parses compiler requirements', () => {
        const result = inputsSchema.compilers.transform(['gcc >=11', 'clang >=14']);
        expect(result).toHaveProperty('gcc');
        expect(result).toHaveProperty('clang');
    });

    it('subrangePolicy transform normalizes compiler names', () => {
        const input = { 'GCC': 'one-per-major', 'Clang': 'one-per-minor' } as Record<string, string>;
        const result = inputsSchema.subrangePolicy.transform(input);
        expect(result).toHaveProperty('gcc');
        expect(result).toHaveProperty('clang');
    });

    it('standards transform normalizes version requirements', () => {
        const result = inputsSchema.standards.transform('>=11');
        expect(result).toBeDefined();
    });

    it('maxStandards transform returns a number', () => {
        const result = inputsSchema.maxStandards.transform(3);
        expect(typeof result).toBe('number');
    });

    it('containers has crossTransform', () => {
        expect(typeof inputsSchema.containers.crossTransform).toBe('function');
    });

    it('generators has crossTransform', () => {
        expect(typeof inputsSchema.generators.crossTransform).toBe('function');
    });

    it('subrangePolicy default is empty object', () => {
        expect(inputsSchema.subrangePolicy.default).toEqual({});
    });

    it('latestFactors crossTransform parses factors', () => {
        const mockInputs = { compilers: { gcc: '>=11', clang: '>=14' } };
        const result = inputsSchema.latestFactors.crossTransform!(
            ['gcc Coverage TSan'],
            mockInputs
        );
        expect(result).toBeDefined();
        expect(result).toHaveProperty('gcc');
    });

    it('factors crossTransform parses factors', () => {
        const mockInputs = { compilers: { gcc: '>=11', msvc: '>=14' } };
        const result = inputsSchema.factors.crossTransform!(
            ['gcc Asan Shared', 'msvc Shared x86'],
            mockInputs
        );
        expect(result).toHaveProperty('gcc');
        expect(result).toHaveProperty('msvc');
    });

    it('forceFactors crossTransform parses suggestions', () => {
        const mockInputs = { compilers: { gcc: '>=11' } };
        const result = inputsSchema.forceFactors.crossTransform!(
            ['gcc >=13 <14: Asan'],
            mockInputs
        );
        expect(Array.isArray(result)).toBe(true);
    });

    it('extraValues transform parses key-value pairs', () => {
        const result = inputsSchema.extraValues.transform(['key: value', 'foo: bar']);
        expect(result).toBeDefined();
    });

    it('defaultBuildType transform trims and falls back to Release', () => {
        expect(inputsSchema.defaultBuildType.transform('Debug')).toBe('Debug');
        expect(inputsSchema.defaultBuildType.transform('  ')).toBe('Release');
    });

    it('sanitizerBuildType transform trims and falls back', () => {
        expect(inputsSchema.sanitizerBuildType.transform('Debug')).toBe('Debug');
        expect(inputsSchema.sanitizerBuildType.transform('')).toBe('Release');
    });

    it('x86BuildType transform trims and falls back', () => {
        expect(inputsSchema.x86BuildType.transform('Debug')).toBe('Debug');
        expect(inputsSchema.x86BuildType.transform('')).toBe('Release');
    });

    it('boolean inputs have correct defaults', () => {
        expect(inputsSchema.useContainers.default).toBe(true);
        expect(inputsSchema.logMatrix.default).toBe(true);
        expect(inputsSchema.generateSummary.default).toBe(true);
        expect(inputsSchema.warnNoMatches.default).toBe(true);
        expect(inputsSchema.sortByFailureRate.default).toBe(true);
    });
});

describe('outputsSchema', () => {
    it('defines matrix output with description', () => {
        expect(outputsSchema).toHaveProperty('matrix');
        expect(typeof outputsSchema.matrix.description).toBe('string');
    });
});
