// The transform of source that Node cannot run with only its types
// removed: a decorator, an `enum`, a parameter property (D111), and
// the JSX of a `.tsx` or `.jsx` file (D145). A project asks for it
// with the `transform` key.
// The compiler is a package of the project. Only a process that
// must compile a file, or find one in the cache, loads this file.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { OWN_CONFIG, tsOptions } from './tsconfig.ts'

/** The JavaScript of one file, with an inline source map, and the module system of that JavaScript. */
export interface Transformed {
  js: string
  format: 'commonjs' | 'module'
}

export interface Transformer {
  /**
   * What the JavaScript of the file at `path` depends on, with the
   * source: the compiler, its version, and the options of the
   * file. It is a part of the key of the cache.
   */
  stamp(path: string): string
  /** The module system of the JavaScript of the file at `path`. */
  format(path: string): Transformed['format']
  /** Compiles `code`, the source of the file at `path`. Throws the error of the compiler. */
  compile(code: string, path: string): Transformed
}

/** The options of a tsconfig file that change the JavaScript of a file. */
interface Options {
  /** True for decorators of TypeScript (`experimentalDecorators`), false for decorators of JavaScript. */
  legacy: boolean
  /** `emitDecoratorMetadata` */
  metadata: boolean
  /** `useDefineForClassFields`, or its default for the `target` of the project. */
  define: boolean
  /** `verbatimModuleSyntax`: the compiler keeps each import that is not `import type`. */
  verbatim: boolean
  /** `esModuleInterop` */
  interop: boolean
  /** True if the output of the project is CommonJS for a `.ts` file. */
  commonjs: boolean
  /**
   * What an element of JSX becomes: a call of `jsxFactory`
   * (`"jsx": "react"`), or a call of a function that the file
   * imports from `jsxImportSource`. `react-jsxdev` is the form with
   * the places of the source.
   */
  jsx: 'react' | 'react-jsx' | 'react-jsxdev'
  jsxImportSource: string
  jsxFactory: string
  jsxFragmentFactory: string
}

/** The options of a project with no tsconfig. */
const DEFAULTS: Options = {
  legacy: false,
  metadata: false,
  define: true,
  verbatim: false,
  interop: true,
  commonjs: false,
  jsx: 'react-jsx',
  jsxImportSource: 'react',
  jsxFactory: 'React.createElement',
  jsxFragmentFactory: 'React.Fragment',
}
/** A file with JSX. */
const JSX = /\.[jt]sx$/

// The part of each compiler that this file uses.
interface TypeScript {
  version: string
  transpileModule?(code: string, options: { fileName: string; compilerOptions: object }): { outputText: string }
  convertCompilerOptionsFromJson(json: object, base: string): { options: object }
}
interface Swc {
  version: string
  transformSync(code: string, options: object): { code: string }
}

/**
 * CommonJS that gets its `require` from the function of
 * `counters-preload.ts`, which finds `./file.ts` for `./file`. The
 * text goes after the directive of the first line, so each
 * position of the source map stays correct.
 */
const REQUIRE = "require = (globalThis[Symbol.for('ubq.require')] ?? (r => r))(require, __filename);"
const withRequire = (js: string): string => js.replace(/^\s*(?:(['"])use strict\1;?)?/, start => start + REQUIRE)

/**
 * The transformer of the project at `root` for the `transform` key
 * of its configuration. Throws if the project does not have the
 * package of the compiler.
 */
export const transformer = (root: string, compiler: 'typescript' | 'swc'): Transformer => {
  const require = createRequire(join(root, 'package.json'))
  const name = compiler === 'swc' ? '@swc/core' : 'typescript'
  let version: string
  try {
    version = (JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8')) as { version: string }).version
  } catch {
    throw new Error(
      `"transform": "${compiler}" in the ubq configuration needs the package ${name}, and the project does not have it. Install it as a devDependency.`,
    )
  }
  if (compiler === 'typescript' && +version.split('.')[0]! >= 7)
    throw new Error(
      `"transform": "typescript" in the ubq configuration needs typescript 5 or 6. The project has typescript ${version}, which has no function that compiles one file. Use "transform": "swc", with the package @swc/core.`,
    )

  // A stack trace then has the places of the source.
  process.setSourceMapsEnabled?.(true)

  /** The folder, then the options of the config of that folder or of the nearest folder above it. */
  const byFolder = new Map<string, Options>()
  const options = (folder: string): Options => {
    let found = byFolder.get(folder)
    if (found) return found
    const config = [OWN_CONFIG, 'tsconfig.json'].map(file => join(folder, file)).find(file => existsSync(file))
    if (config) {
      let json: Record<string, unknown> = {}
      try {
        json = tsOptions(config)
      } catch {
        // A config that this code cannot read: the type check reports it.
      }
      const target = /^es(\d+|next)$/i.exec(String(json.target))?.[1]
      const module = String(json.module).toLowerCase()
      const jsx = String(json.jsx).toLowerCase()
      const text = (key: keyof Options): string =>
        typeof json[key] === 'string' ? json[key] : (DEFAULTS[key] as string)
      found = {
        legacy: json.experimentalDecorators === true,
        metadata: json.emitDecoratorMetadata === true,
        define:
          typeof json.useDefineForClassFields === 'boolean'
            ? json.useDefineForClassFields
            : target !== undefined && (target.toLowerCase() === 'next' || +target >= 2022),
        verbatim: json.verbatimModuleSyntax === true,
        interop: json.esModuleInterop !== false,
        commonjs: module === 'commonjs' || (/^node(\d+|next)$/.test(module) && !esmPackage(folder)),
        // `preserve` keeps the JSX, which Node cannot run.
        jsx: jsx === 'react' || jsx === 'react-jsxdev' ? jsx : 'react-jsx',
        jsxImportSource: text('jsxImportSource'),
        jsxFactory: text('jsxFactory'),
        jsxFragmentFactory: text('jsxFragmentFactory'),
      }
    } else if (folder === root || dirname(folder) === folder) found = DEFAULTS
    else found = options(dirname(folder))
    byFolder.set(folder, found)
    return found
  }
  /** True if the nearest package.json of the folder has `"type": "module"`. */
  const esmPackage = (folder: string): boolean => {
    for (let dir = folder; ; dir = dirname(dir)) {
      try {
        return (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { type?: string }).type === 'module'
      } catch {
        if (dir === root || dirname(dir) === dir) return false
      }
    }
  }
  const format = (path: string): Transformed['format'] =>
    path.endsWith('.cts') || (options(dirname(path)).commonjs && !path.endsWith('.mts')) ? 'commonjs' : 'module'

  let ts: TypeScript | undefined
  let swc: Swc | undefined
  const stamps = new Map<string, string>()
  return {
    stamp(path) {
      const folder = dirname(path)
      let stamp = stamps.get(folder)
      if (!stamp) stamps.set(folder, (stamp = `${name}@${version} ${JSON.stringify(options(folder))}`))
      return stamp
    },
    format,
    compile(code, path) {
      const o = options(dirname(path))
      const cjs = format(path) === 'commonjs'
      if (compiler === 'swc') {
        swc ??= require(name) as Swc
        const { code: js } = swc.transformSync(code, {
          filename: path,
          swcrc: false,
          configFile: false,
          sourceMaps: 'inline',
          inlineSourcesContent: false,
          jsc: {
            parser: path.endsWith('.jsx')
              ? { syntax: 'ecmascript', jsx: true, decorators: true }
              : { syntax: 'typescript', tsx: path.endsWith('.tsx'), decorators: true },
            target: 'es2022',
            keepClassNames: true,
            transform: {
              legacyDecorator: o.legacy,
              decoratorMetadata: o.metadata,
              ...(!o.legacy && { decoratorVersion: '2022-03' }),
              useDefineForClassFields: o.define,
              verbatimModuleSyntax: o.verbatim,
              ...(JSX.test(path) && {
                react: {
                  runtime: o.jsx === 'react' ? 'classic' : 'automatic',
                  development: o.jsx === 'react-jsxdev',
                  importSource: o.jsxImportSource,
                  pragma: o.jsxFactory,
                  pragmaFrag: o.jsxFragmentFactory,
                },
              }),
            },
          },
          // `import()` stays as it is: it loads a module of each kind.
          module: cjs ? { type: 'commonjs', ignoreDynamic: true, noInterop: !o.interop } : { type: 'es6' },
        })
        return { js: cjs ? withRequire(js) : js, format: format(path) }
      }
      ts ??= require(name) as TypeScript
      const { options: compilerOptions } = ts.convertCompilerOptionsFromJson(
        {
          // A CommonJS file of `node16` keeps `import()` as it is.
          module: cjs ? 'node16' : 'esnext',
          target: 'es2022',
          experimentalDecorators: o.legacy,
          emitDecoratorMetadata: o.metadata,
          useDefineForClassFields: o.define,
          verbatimModuleSyntax: o.verbatim,
          esModuleInterop: o.interop,
          inlineSourceMap: true,
          ...(JSX.test(path) && {
            jsx: o.jsx,
            // TypeScript refuses the factory options with an import source.
            ...(o.jsx === 'react'
              ? { jsxFactory: o.jsxFactory, jsxFragmentFactory: o.jsxFragmentFactory }
              : { jsxImportSource: o.jsxImportSource }),
          }),
        },
        root,
      )
      const js = ts.transpileModule!(code, { fileName: path, compilerOptions }).outputText
      return { js: cjs ? withRequire(js) : js, format: format(path) }
    },
  }
}
