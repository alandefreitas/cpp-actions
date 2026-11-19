import * as os from 'os';
import * as path from 'path';
import { inputsSchema, outputsSchema } from './schema';

describe('create-changelog schema', () => {
    it('resolves sourceDir to an absolute path', () => {
        expect(inputsSchema.sourceDir.transform('.')).toBe(path.resolve('.'));
        expect(inputsSchema.sourceDir.transform(path.join('a', 'b'))).toBe(path.resolve('a', 'b'));
    });

    it('resolves a relative outputPath from the source directory', () => {
        const sourceDir = path.join(os.tmpdir(), 'project');
        expect(inputsSchema.outputPath.crossTransform('CHANGELOG.md', { sourceDir }))
            .toBe(path.join(sourceDir, 'CHANGELOG.md'));
        expect(inputsSchema.outputPath.crossTransform(path.join('docs', 'CHANGES.md'), { sourceDir }))
            .toBe(path.join(sourceDir, 'docs', 'CHANGES.md'));
    });

    it('keeps an absolute outputPath', () => {
        const absolute = path.join(os.tmpdir(), 'elsewhere', 'CHANGELOG.md');
        expect(inputsSchema.outputPath.crossTransform(absolute, { sourceDir: path.join(os.tmpdir(), 'project') }))
            .toBe(absolute);
    });

    it('uses default patterns that recognize version bumps and version tags', () => {
        expect(inputsSchema.versionPattern.default.test('Bump version to 1.2.3')).toBe(true);
        expect(inputsSchema.versionPattern.default.test('Set  version 2')).toBe(true);
        expect(inputsSchema.versionPattern.default.test('fix: version parsing')).toBe(false);
        expect(inputsSchema.tagPattern.default.test('v1.2.3')).toBe(true);
        expect(inputsSchema.tagPattern.default.test('nightly')).toBe(false);
    });

    it('excludes chore and style commits by default and has no outputs', () => {
        expect(Array.from(inputsSchema.excludeTypes.default)).toEqual(['chore', 'style']);
        expect(inputsSchema.includeTypes.default.size).toBe(0);
        expect(inputsSchema.checkUnconventional.validValues).toEqual(['false', 'warn', 'error']);
        expect(outputsSchema).toEqual({});
    });
});
