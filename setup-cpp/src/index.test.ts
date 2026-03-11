import { normalizeCompiler, resolveMSVCArch } from './index';
import { describePrettyErrors } from 'pretty-errors/test-helper';

import * as msvc from 'setup-msvc';

test('normalize compiler', async () => {
    const compiler = normalizeCompiler('gcc-4.9.2', '*');
    expect(compiler.compiler).toEqual('gcc');
    expect(compiler.version).toEqual('4.9.2');
});

test('resolveMSVCArch normalizes tokens and falls back to env or defaults', () => {
    expect(resolveMSVCArch('x86', 'AMD64')).toEqual('x86');
    expect(resolveMSVCArch('ARM64', 'AMD64')).toEqual('arm64');
    expect(resolveMSVCArch('', 'AMD64')).toEqual('x64');
    expect(resolveMSVCArch('', '')).toEqual('x64');
    expect(resolveMSVCArch('weird-arch', 'AMD64')).toEqual('weird-arch');
});

test('build MSVC outputs uses Visual Studio metadata when available', () => {
    const compilerPath = 'C\\VS\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64\\x64\\cl.exe';
    const env = {
        VCINSTALLDIR: 'C\\VS\\VC\\',
        VisualStudioVersion: '17.11.35205.1',
        VCToolsVersion: '14.40.33807'
    };

    const outputs = msvc.buildMSVCOutputs(compilerPath, env, { compilerVersion: '19.44.35219' });

    expect(outputs.cc).toEqual(compilerPath);
    expect(outputs.cxx).toEqual(compilerPath);
    expect(outputs.bindir).toEqual('C\\VS\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64\\x64');
    expect(outputs.dir).toEqual('C\\VS\\VC\\');
    expect(outputs.release).toEqual('14.40.33807');
    expect(outputs.versionMajor).toEqual(14);
    expect(outputs.versionMinor).toEqual(40);
    expect(outputs.versionPatch).toEqual(33807);
    expect(outputs.msvcToolsetVersion).toEqual('14.40.33807');
    expect(outputs.msvcProductVersion).toEqual('17.11.35205.1');
    expect(outputs.msvcReleaseYear).toEqual('2022');
    expect(outputs.msvcCompilerVersion).toEqual('19.44.35219');
});

test('build MSVC outputs falls back when metadata is missing', () => {
    const compilerPath = 'C\\VS\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64\\x64\\cl.exe';
    const outputs = msvc.buildMSVCOutputs(compilerPath, {});

    expect(outputs.dir).toEqual('C\\VS\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64');
    expect(outputs.release).toEqual('14.40.33807');
    expect(outputs.versionMajor).toEqual(14);
});

describePrettyErrors('cpp boom', 'Setup C++ failed');
