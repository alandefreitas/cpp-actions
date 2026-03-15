import {
    isValidType,
    normalizeType,
    iconFor,
    humanize,
    commitTypeDescription,
    capitalizeSentences,
    featureSubjectIcon
} from './commit-formatting';

beforeEach(() => {
    featureSubjectIcon.count = 0;
});

describe('isValidType', () => {
    it('should return true for recognized types', () => {
        const validTypes = [
            'doc', 'docs', 'documentation',
            'fix', 'fixes', 'bugfix',
            'chore', 'work', 'chores', 'maintenance',
            'feat', 'feature',
            'refactor', 'cleanup',
            'perf', 'performance',
            'test', 'testing', 'tests',
            'release', 'version',
            'ci', 'integration',
            'breaking', 'break',
            'revert', 'undo',
            'style', 'build', 'improvement'
        ];
        for (const t of validTypes) {
            expect(isValidType(t)).toBe(true);
        }
    });

    it('should return false for unrecognized types', () => {
        expect(isValidType('unknown')).toBe(false);
        expect(isValidType('')).toBe(false);
        expect(isValidType('FEAT')).toBe(false);
    });
});

describe('normalizeType', () => {
    it('should return "other" for null/empty input', () => {
        expect(normalizeType(null)).toBe('other');
        expect(normalizeType('')).toBe('other');
    });

    it('should normalize known aliases', () => {
        expect(normalizeType('doc')).toBe('docs');
        expect(normalizeType('documentation')).toBe('docs');
        expect(normalizeType('fixes')).toBe('fix');
        expect(normalizeType('bugfix')).toBe('fix');
        expect(normalizeType('work')).toBe('chore');
        expect(normalizeType('chores')).toBe('chore');
        expect(normalizeType('maintenance')).toBe('chore');
        expect(normalizeType('feature')).toBe('feat');
        expect(normalizeType('cleanup')).toBe('refactor');
        expect(normalizeType('performance')).toBe('perf');
        expect(normalizeType('testing')).toBe('test');
        expect(normalizeType('tests')).toBe('test');
        expect(normalizeType('version')).toBe('release');
        expect(normalizeType('integration')).toBe('ci');
        expect(normalizeType('break')).toBe('breaking');
        expect(normalizeType('undo')).toBe('revert');
    });

    it('should be case-insensitive', () => {
        expect(normalizeType('DOC')).toBe('docs');
        expect(normalizeType('Feature')).toBe('feat');
        expect(normalizeType('BUGFIX')).toBe('fix');
    });

    it('should return the input unchanged for unknown types', () => {
        expect(normalizeType('custom')).toBe('custom');
        expect(normalizeType('feat')).toBe('feat');
    });
});

describe('iconFor', () => {
    it('should return correct icons for known types', () => {
        expect(iconFor('docs')).toBe('📖');
        expect(iconFor('fix')).toBe('🐛');
        expect(iconFor('feat')).toBe('🚀');
        expect(iconFor('breaking')).toBe('🚨');
        expect(iconFor('other')).toBe('💬');
    });

    it('should return default icon for null', () => {
        expect(iconFor(null)).toBe('💬');
    });

    it('should return the input string for unrecognized types', () => {
        expect(iconFor('custom')).toBe('custom');
    });
});

describe('humanize', () => {
    it('should return human-readable titles for known types', () => {
        expect(humanize('docs')).toBe('Documentation');
        expect(humanize('fix')).toBe('Fixes');
        expect(humanize('feat')).toBe('Features');
        expect(humanize('ci')).toBe('Continuous Integration');
        expect(humanize('other')).toBe('Other');
    });

    it('should return the input unchanged for unknown types', () => {
        expect(humanize('custom')).toBe('custom');
    });
});

describe('commitTypeDescription', () => {
    it('should return descriptions for known types', () => {
        expect(commitTypeDescription('feat')).toBe('New features and additions');
        expect(commitTypeDescription('fix')).toBe('Bug fixes and error corrections');
        expect(commitTypeDescription('docs')).toBe('Documentation updates and improvements');
    });

    it('should return empty string for unknown types', () => {
        expect(commitTypeDescription('custom')).toBe('');
    });
});

describe('capitalizeSentences', () => {
    it('should capitalize the first letter of each sentence', () => {
        expect(capitalizeSentences('hello world. foo bar')).toBe('Hello world. Foo bar.');
    });

    it('should handle single sentence', () => {
        expect(capitalizeSentences('hello world')).toBe('Hello world.');
    });

    it('should handle sentence already ending with period', () => {
        expect(capitalizeSentences('hello world.')).toBe('Hello world.');
    });

    it('should handle empty string', () => {
        expect(capitalizeSentences('')).toBe('.');
    });
});

describe('featureSubjectIcon', () => {
    it('should cycle through icons', () => {
        expect(featureSubjectIcon()).toBe('✨');
        expect(featureSubjectIcon()).toBe('💫');
        expect(featureSubjectIcon()).toBe('🌟');
        expect(featureSubjectIcon()).toBe('✨'); // wraps around
    });
});
