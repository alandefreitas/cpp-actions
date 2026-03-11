import { deriveB2ArchConfig, numberOfCpus } from './arch-utils';

describe('deriveB2ArchConfig', () => {
    it('returns empty config for empty string', () => {
        const config = deriveB2ArchConfig('');
        expect(config).toEqual({ normalizedArch: '' });
    });

    it('derives x86 architecture (32-bit)', () => {
        const config = deriveB2ArchConfig('x86');
        expect(config).toEqual({
            normalizedArch: 'x86',
            addressModel: '32',
            architecture: 'x86'
        });
    });

    it('derives x64 architecture (64-bit x86)', () => {
        const config = deriveB2ArchConfig('x64');
        expect(config).toEqual({
            normalizedArch: 'x64',
            addressModel: '64',
            architecture: 'x86'
        });
    });

    it('derives arm architecture (32-bit)', () => {
        const config = deriveB2ArchConfig('arm');
        expect(config).toEqual({
            normalizedArch: 'arm',
            addressModel: '32',
            architecture: 'arm'
        });
    });

    it('derives arm64 architecture (64-bit arm)', () => {
        const config = deriveB2ArchConfig('arm64');
        expect(config).toEqual({
            normalizedArch: 'arm64',
            addressModel: '64',
            architecture: 'arm'
        });
    });

    it('handles amd64 alias for x64', () => {
        const config = deriveB2ArchConfig('amd64');
        expect(config).toEqual({
            normalizedArch: 'x64',
            addressModel: '64',
            architecture: 'x86'
        });
    });

    it('returns normalizedArch only for unknown architecture', () => {
        const config = deriveB2ArchConfig('mips');
        expect(config.normalizedArch).toBe('mips');
        expect(config.addressModel).toBeUndefined();
        expect(config.architecture).toBeUndefined();
    });
});

describe('numberOfCpus', () => {
    it('returns a positive integer', () => {
        const cpus = numberOfCpus();
        expect(cpus).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(cpus)).toBe(true);
    });
});
