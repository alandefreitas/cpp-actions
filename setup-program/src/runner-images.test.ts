import { loadRunnerImages } from './runner-images';
import runnerImagesJson from '../runner-images.json';

describe('loadRunnerImages', () => {
    it('returns the bundled runner-images data', () => {
        const data = loadRunnerImages();
        expect(data).toBe(runnerImagesJson);
    });

    it('lists runners for every platform with a name and version', () => {
        const data = loadRunnerImages();
        for (const platform of ['ubuntu', 'macos', 'windows'] as const) {
            expect(Array.isArray(data.runners[platform])).toBe(true);
            expect(data.runners[platform].length).toBeGreaterThan(0);
            for (const entry of data.runners[platform]) {
                expect(typeof entry.name).toBe('string');
                expect(typeof entry.version).toBe('string');
            }
        }
    });
});
