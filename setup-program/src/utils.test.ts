import {
    escapeRegExp,
    removeSemverLeadingZeros,
    renderTemplate,
    getRunnerOs,
    sleep,
    normalizeArchitectureInput
} from './utils';

describe('escapeRegExp', () => {
    it('escapes special regex characters', () => {
        expect(escapeRegExp('clang++')).toBe('clang\\+\\+');
        expect(escapeRegExp('foo.bar')).toBe('foo\\.bar');
        expect(escapeRegExp('a*b?c')).toBe('a\\*b\\?c');
        expect(escapeRegExp('(test)')).toBe('\\(test\\)');
        expect(escapeRegExp('[a]')).toBe('\\[a\\]');
        expect(escapeRegExp('a{b}')).toBe('a\\{b\\}');
        expect(escapeRegExp('a|b')).toBe('a\\|b');
        expect(escapeRegExp('a^b$c')).toBe('a\\^b\\$c');
        expect(escapeRegExp('a\\b')).toBe('a\\\\b');
    });

    it('returns plain strings unchanged', () => {
        expect(escapeRegExp('clang')).toBe('clang');
        expect(escapeRegExp('gcc-12')).toBe('gcc-12');
    });
});

describe('removeSemverLeadingZeros', () => {
    it('removes leading zeros from version components', () => {
        expect(removeSemverLeadingZeros('01.02.03')).toBe('1.2.3');
        expect(removeSemverLeadingZeros('014.000.001')).toBe('14.0.1');
    });

    it('leaves valid versions unchanged', () => {
        expect(removeSemverLeadingZeros('14.0.0')).toBe('14.0.0');
        expect(removeSemverLeadingZeros('3.24')).toBe('3.24');
    });

    it('handles single component version', () => {
        expect(removeSemverLeadingZeros('012')).toBe('12');
    });
});

describe('renderTemplate', () => {
    it('replaces placeholders with data values', () => {
        expect(renderTemplate('Hello {{name}}!', { name: 'World' })).toBe('Hello World!');
        expect(renderTemplate('v{{major}}.{{minor}}', { major: 1, minor: 2 })).toBe('v1.2');
    });

    it('preserves unmatched placeholders', () => {
        expect(renderTemplate('{{known}} {{unknown}}', { known: 'yes' })).toBe('yes {{unknown}}');
    });

    it('handles templates with no placeholders', () => {
        expect(renderTemplate('no placeholders', {})).toBe('no placeholders');
    });

    it('handles whitespace in placeholders', () => {
        expect(renderTemplate('{{ name }}', { name: 'test' })).toBe('test');
    });
});

describe('getRunnerOs', () => {
    const originalPlatform = process.platform;

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('returns Linux for linux platform', () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        expect(getRunnerOs()).toBe('Linux');
    });

    it('returns Windows for win32 platform', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        expect(getRunnerOs()).toBe('Windows');
    });

    it('returns macOS for darwin platform', () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        expect(getRunnerOs()).toBe('macOS');
    });
});

describe('sleep', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('resolves after the specified duration', async () => {
        const promise = sleep(1000);
        jest.advanceTimersByTime(1000);
        await promise;
    });
});

describe('normalizeArchitectureInput', () => {
    it('returns empty string for empty/falsy input', () => {
        expect(normalizeArchitectureInput('')).toBe('');
    });

    it('normalizes x86 variants', () => {
        expect(normalizeArchitectureInput('x86')).toBe('x86');
        expect(normalizeArchitectureInput('win32')).toBe('x86');
        expect(normalizeArchitectureInput('ia32')).toBe('x86');
        expect(normalizeArchitectureInput('i386')).toBe('x86');
        expect(normalizeArchitectureInput('i686')).toBe('x86');
        expect(normalizeArchitectureInput('I386')).toBe('x86'); // case insensitive
    });

    it('normalizes x64 variants', () => {
        expect(normalizeArchitectureInput('x64')).toBe('x64');
        expect(normalizeArchitectureInput('amd64')).toBe('x64');
        expect(normalizeArchitectureInput('x86_64')).toBe('x64');
        expect(normalizeArchitectureInput('x86-64')).toBe('x64');
        expect(normalizeArchitectureInput('AMD64')).toBe('x64');
    });

    it('normalizes arm variants', () => {
        expect(normalizeArchitectureInput('arm')).toBe('arm');
        expect(normalizeArchitectureInput('arm32')).toBe('arm');
        expect(normalizeArchitectureInput('ARM')).toBe('arm');
    });

    it('normalizes arm64 variants', () => {
        expect(normalizeArchitectureInput('arm64')).toBe('arm64');
        expect(normalizeArchitectureInput('aarch64')).toBe('arm64');
        expect(normalizeArchitectureInput('AARCH64')).toBe('arm64');
    });

    it('returns original value for unknown architectures', () => {
        expect(normalizeArchitectureInput('riscv64')).toBe('riscv64');
        expect(normalizeArchitectureInput('mips')).toBe('mips');
    });
});
