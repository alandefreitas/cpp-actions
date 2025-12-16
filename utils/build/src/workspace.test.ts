import * as path from 'path';
import { discoverWorkspaces, filterPackageWorkspaces, filterCompositeActions, findWorkspace } from './workspace';

describe('workspace discovery', () => {
    // Use the actual repo root for testing
    const rootDir = path.resolve(__dirname, '../../..');

    describe('discoverWorkspaces', () => {
        it('should discover workspaces in the repo', () => {
            const workspaces = discoverWorkspaces(rootDir);
            expect(workspaces.length).toBeGreaterThan(0);
        });

        it('should find action workspaces with package.json', () => {
            const workspaces = discoverWorkspaces(rootDir);
            const cppMatrix = workspaces.find(w => w.name === 'cpp-matrix');
            expect(cppMatrix).toBeDefined();
            expect(cppMatrix?.hasPackageJson).toBe(true);
        });

        it('should find common module workspaces', () => {
            const workspaces = discoverWorkspaces(rootDir);
            const ghInputs = workspaces.find(w => w.name === 'common/gh-inputs');
            expect(ghInputs).toBeDefined();
            expect(ghInputs?.displayName).toBe('gh-inputs');
        });

        it('should find utils workspaces', () => {
            const workspaces = discoverWorkspaces(rootDir);
            const build = workspaces.find(w => w.name === 'utils/build');
            expect(build).toBeDefined();
            expect(build?.displayName).toBe('build');
        });
    });

    describe('filterPackageWorkspaces', () => {
        it('should filter to only workspaces with package.json', () => {
            const workspaces = discoverWorkspaces(rootDir);
            const packageWorkspaces = filterPackageWorkspaces(workspaces);

            expect(packageWorkspaces.every(w => w.hasPackageJson)).toBe(true);
        });
    });

    describe('filterCompositeActions', () => {
        it('should filter to only composite actions', () => {
            const workspaces = discoverWorkspaces(rootDir);
            const compositeActions = filterCompositeActions(workspaces);

            // All composite actions have action.yml but no package.json
            expect(compositeActions.every(w => w.hasActionYml && !w.hasPackageJson)).toBe(true);
        });
    });

    describe('findWorkspace', () => {
        it('should find workspace by name', () => {
            const workspaces = discoverWorkspaces(rootDir);
            const found = findWorkspace(workspaces, 'cpp-matrix');
            expect(found?.name).toBe('cpp-matrix');
        });

        it('should find workspace by display name', () => {
            const workspaces = discoverWorkspaces(rootDir);
            const found = findWorkspace(workspaces, 'gh-inputs');
            expect(found?.name).toBe('common/gh-inputs');
        });

        it('should return undefined for non-existent workspace', () => {
            const workspaces = discoverWorkspaces(rootDir);
            const found = findWorkspace(workspaces, 'non-existent');
            expect(found).toBeUndefined();
        });
    });
});
