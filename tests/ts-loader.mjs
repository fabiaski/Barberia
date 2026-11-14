import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT_DIR = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

function resolveLocalFile(absPath) {
  const candidates = [
    absPath,
    `${absPath}.ts`,
    `${absPath}.tsx`,
    `${absPath}.js`,
    `${absPath}.mjs`,
    `${absPath}.json`,
    resolvePath(absPath, 'index.ts'),
    resolvePath(absPath, 'index.tsx'),
    resolvePath(absPath, 'index.js'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return pathToFileURL(candidate).href;
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') {
    return {
      shortCircuit: true,
      url: 'data:text/javascript,export default {};',
    };
  }

  if (specifier === 'next/headers') {
    return {
      shortCircuit: true,
      url: 'data:text/javascript,export async function cookies() { return { get: () => undefined }; } export async function headers() { return new Headers(); }',
    };
  }

  if (specifier.startsWith('@/')) {
    const absTarget = resolvePath(ROOT_DIR, specifier.slice(2));
    const resolvedUrl = resolveLocalFile(absTarget);
    if (resolvedUrl) {
      return { shortCircuit: true, url: resolvedUrl };
    }
  }

  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    context.parentURL?.startsWith('file:')
  ) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    const absTarget = resolvePath(parentDir, specifier);
    const resolvedUrl = resolveLocalFile(absTarget);
    if (resolvedUrl) {
      return { shortCircuit: true, url: resolvedUrl };
    }
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.json')) {
    const raw = readFileSync(fileURLToPath(url), 'utf-8');
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${raw};`,
    };
  }

  if (
    url.startsWith('file:') &&
    !url.includes('/node_modules/') &&
    (url.endsWith('.ts') || url.endsWith('.tsx'))
  ) {
    const raw = readFileSync(fileURLToPath(url), 'utf-8');
    const transpiled = ts.transpileModule(raw, {
      fileName: fileURLToPath(url),
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    });

    return {
      format: 'module',
      shortCircuit: true,
      source: transpiled.outputText,
    };
  }

  return nextLoad(url, context);
}
