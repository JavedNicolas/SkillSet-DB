import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseCargoToml,
  parseGemfile,
  parseGoMod,
  parsePackageJson,
  parsePubspec,
  parseRequirements,
} from '../src/detect/manifests.js';
import { detectStack, stackHash } from '../src/detect/stack.js';

describe('manifest extractors', () => {
  it('package.json: deps, typescript, frameworks', () => {
    const ev = parsePackageJson(
      JSON.stringify({ dependencies: { next: '14', react: '18' }, devDependencies: { typescript: '5' } }),
    );
    expect(ev.languages).toContain('typescript');
    expect(ev.frameworks).toEqual(expect.arrayContaining(['nextjs', 'react']));
    expect(ev.dependencies).toContain('next');
  });

  it('pubspec.yaml: flutter + bloc detected, riverpod absent', () => {
    const ev = parsePubspec(
      'name: memoka\ndependencies:\n  flutter:\n    sdk: flutter\n  flutter_bloc: ^8.0.0\n  freezed: ^2.0.0\ndev_dependencies:\n  build_runner: ^2.0.0\n',
    );
    expect(ev.languages).toEqual(['dart']);
    expect(ev.frameworks).toEqual(expect.arrayContaining(['flutter', 'bloc', 'freezed']));
    expect(ev.frameworks).not.toContain('riverpod');
  });

  it('pubspec.yaml regex fallback on broken yaml', () => {
    const ev = parsePubspec('dependencies:\n  flutter_riverpod: ^2.0.0\n\t- broken: [yaml\n');
    expect(ev.dependencies).toContain('flutter_riverpod');
  });

  it('go.mod and Gemfile and requirements and Cargo', () => {
    expect(parseGoMod('module x\nrequire (\n  github.com/gin-gonic/gin v1.9.0\n)\n').frameworks).toContain('gin');
    expect(parseGemfile("source 'https://rubygems.org'\ngem 'rails', '~> 7'\n").frameworks).toContain('rails');
    expect(parseRequirements('Django==4.2\n# comment\nfastapi>=0.100\n').frameworks).toEqual(
      expect.arrayContaining(['django', 'fastapi']),
    );
    expect(parseCargoToml('[package]\nname="x"\n[dependencies]\ntokio = "1"\n').frameworks).toContain('tokio');
  });
});

describe('detectStack', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillsdb-detect-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('empty dir: isEmpty, absent candidates recorded', () => {
    const det = detectStack(tmpDir);
    expect(det.isEmpty).toBe(true);
    expect(det.profile.manifests).toEqual([]);
    expect(det.candidates.length).toBeGreaterThan(5);
    expect(det.candidates.every((c) => !c.present)).toBe(true);
  });

  it('flutter project: detected via pubspec', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pubspec.yaml'),
      'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n  flutter_bloc: ^8.0.0\n',
    );
    const det = detectStack(tmpDir);
    expect(det.isEmpty).toBe(false);
    expect(det.profile.frameworks).toEqual(expect.arrayContaining(['flutter', 'bloc']));
    expect(det.profile.languages).toContain('dart');
    expect(det.candidates.find((c) => c.path.endsWith('pubspec.yaml'))?.present).toBe(true);
  });

  it('monorepo: depth-1 manifests merge into a union profile', () => {
    fs.mkdirSync(path.join(tmpDir, 'backend'));
    fs.mkdirSync(path.join(tmpDir, 'mobile'));
    fs.writeFileSync(
      path.join(tmpDir, 'backend', 'package.json'),
      JSON.stringify({ dependencies: { express: '4' } }),
    );
    fs.writeFileSync(path.join(tmpDir, 'mobile', 'pubspec.yaml'), 'dependencies:\n  flutter_riverpod: ^2.0.0\n');
    const det = detectStack(tmpDir);
    expect(det.profile.frameworks).toEqual(expect.arrayContaining(['express', 'riverpod']));
    expect(det.profile.languages).toEqual(expect.arrayContaining(['javascript', 'dart']));
  });

  it('hash is stable across runs; more files of a known language do not churn it', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { react: '18' } }));
    const h1 = detectStack(tmpDir).hash;
    // census counts change, language set does not
    fs.writeFileSync(path.join(tmpDir, 'extra.js'), 'export {}');
    const h2 = detectStack(tmpDir).hash;
    expect(h1).toBe(h2);
    // a NEW language appearing must change the hash (re-triggers activation)
    fs.writeFileSync(path.join(tmpDir, 'main.dart'), '// dart');
    expect(detectStack(tmpDir).hash).not.toBe(h2);
    expect(stackHash(detectStack(tmpDir).profile)).toBe(detectStack(tmpDir).hash);
  });

  it('census detects languages without manifests', () => {
    fs.mkdirSync(path.join(tmpDir, 'lib'));
    for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(tmpDir, 'lib', `f${i}.dart`), '// dart');
    const det = detectStack(tmpDir);
    expect(det.isEmpty).toBe(false);
    expect(det.profile.languages).toContain('dart');
  });
});
