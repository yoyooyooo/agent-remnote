import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const SANDBOX_SUFFIX = '-sandbox';

function walkFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const results: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...walkFiles(full));
      continue;
    }
    results.push(full);
  }
  return results;
}

function packageInfo() {
  const raw = readFileSync(path.resolve(__dirname, 'package.json'), 'utf8');
  const parsed = JSON.parse(raw);
  return {
    name: typeof parsed?.name === 'string' ? parsed.name : '@remnote/plugin',
    version: typeof parsed?.version === 'string' ? parsed.version : '0.0.0',
  };
}

function maxMtime(paths: string[]): number {
  let max = 0;
  for (const target of paths) {
    try {
      const st = statSync(target);
      if (st.isDirectory()) {
        max = Math.max(max, ...walkFiles(target).map((file) => Math.floor(statSync(file).mtimeMs)));
      } else {
        max = Math.max(max, Math.floor(st.mtimeMs));
      }
    } catch {}
  }
  return max || Date.now();
}

function collectWidgetEntries() {
  const widgetsDir = path.resolve(__dirname, 'src/widgets');
  const files = walkFiles(widgetsDir).filter((f) => /\.[tj]sx?$/.test(f));
  const widgetSource: Record<string, string> = {};
  const inputs: Record<string, string> = {};

  for (const file of files) {
    const rel = path
      .relative(widgetsDir, file)
      .replace(/\.[tj]sx?$/, '')
      .split(path.sep)
      .join('/');
    const relWithExt = path.relative(widgetsDir, file).split(path.sep).join('/');
    widgetSource[rel] = relWithExt;
    widgetSource[`${rel}${SANDBOX_SUFFIX}`] = relWithExt;
    inputs[rel] = `\0remnote-widget-entry:${rel}`;
    inputs[`${rel}${SANDBOX_SUFFIX}`] = `\0remnote-widget-entry:${rel}${SANDBOX_SUFFIX}`;
  }
  return { inputs, widgetNames: Object.keys(inputs), widgetSource };
}

function virtualWidgetEntriesPlugin(widgetSource: Record<string, string>): Plugin {
  return {
    name: 'remnote-plugin-virtual-widget-entries',
    resolveId(id) {
      if (id.startsWith('\0remnote-widget-entry:')) return id;
      return null;
    },
    load(id) {
      if (!id.startsWith('\0remnote-widget-entry:')) return null;
      const entryName = id.slice('\0remnote-widget-entry:'.length);
      const source = widgetSource[entryName];
      if (!source) throw new Error(`Unknown widget entry: ${entryName}`);
      const qs = entryName.endsWith(SANDBOX_SUFFIX) ? 'sandbox=1' : 'sandbox=0';
      return `import "/src/widgets/${source}?${qs}";\n`;
    },
  };
}

function devEntryShimPlugin(widgetSource: Record<string, string>): Plugin {
  // In dev server mode, provide /<widget>.js and /<widget>-sandbox.js "entry shims"
  // so that public/index.html can dynamically load the requested widget.
  return {
    name: 'remnote-plugin-dev-entry-shim',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ? req.url.split('?')[0] : '';
        if (!url || !url.endsWith('.js')) return next();

        const name = url.replace(/^\//, '').replace(/\.js$/, '');
        const source = widgetSource[name];
        if (!source) return next();

        const qs = name.endsWith(SANDBOX_SUFFIX) ? 'sandbox=1' : 'sandbox=0';
        const code = `import "/src/widgets/${source}?${qs}";\n`;

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.end(code);
      });
    },
  };
}

function injectImportMetaConstantPlugin(): Plugin {
  return {
    name: 'remnote-plugin-import-meta-const',
    renderChunk(code, chunk) {
      if (!chunk.isEntry) return null;
      if (chunk.name.includes(SANDBOX_SUFFIX)) return null;
      if (code.startsWith('const IMPORT_META=import.meta;')) return null;
      return { code: `const IMPORT_META=import.meta;\n${code}`, map: null };
    },
  };
}

function emitReadmePlugin(): Plugin {
  return {
    name: 'remnote-plugin-emit-readme',
    apply: 'build',
    generateBundle() {
      const src = readFileSync(path.resolve(__dirname, 'README.md'), 'utf8');
      this.emitFile({ type: 'asset', fileName: 'README.md', source: src });
    },
  };
}

function emitBuildInfoPlugin(buildInfo: Record<string, unknown>): Plugin {
  return {
    name: 'remnote-plugin-emit-build-info',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build-info.json',
        source: JSON.stringify(buildInfo, null, 2),
      });
    },
  };
}

function duplicateSandboxCssPlugin(baseWidgetNames: string[]): Plugin {
  return {
    name: 'remnote-plugin-duplicate-sandbox-css',
    apply: 'build',
    generateBundle(_options, bundle) {
      const getCssAssetSourceFromEntry = (entryJsFileName: string): any | undefined => {
        const visited = new Set<string>();
        const queue: string[] = [entryJsFileName];
        while (queue.length > 0) {
          const fileName = queue.shift()!;
          if (visited.has(fileName)) continue;
          visited.add(fileName);

          const item = bundle[fileName];
          if (!item || item.type !== 'chunk') continue;

          const importedCss: Set<string> | undefined = (item as any).viteMetadata?.importedCss;
          if (importedCss && importedCss.size > 0) {
            const cssFileName = Array.from(importedCss)[0];
            const cssAsset = bundle[cssFileName];
            if (cssAsset?.type === 'asset') {
              return cssAsset.source;
            }
          }

          for (const next of item.imports ?? []) queue.push(next);
          for (const next of item.dynamicImports ?? []) queue.push(next);
        }
        return undefined;
      };

      for (const base of baseWidgetNames) {
        const normal = `${base}.css`;
        const sandbox = `${base}${SANDBOX_SUFFIX}.css`;
        const normalAsset = bundle[normal];
        const sandboxAsset = bundle[sandbox];

        const normalSource =
          normalAsset?.type === 'asset' ? normalAsset.source : getCssAssetSourceFromEntry(`${base}.js`);
        const sandboxSource =
          sandboxAsset?.type === 'asset'
            ? sandboxAsset.source
            : getCssAssetSourceFromEntry(`${base}${SANDBOX_SUFFIX}.js`);

        const source = normalSource ?? sandboxSource;
        if (source === undefined) continue;

        if (!normalAsset) {
          // @ts-expect-error rollup bundle shape
          bundle[normal] = { type: 'asset', fileName: normal, name: normal, source };
        }
        if (!sandboxAsset) {
          // @ts-expect-error rollup bundle shape
          bundle[sandbox] = { type: 'asset', fileName: sandbox, name: sandbox, source };
        }
      }
    },
  };
}

const { inputs, widgetNames, widgetSource } = collectWidgetEntries();
const baseWidgetNames = Array.from(
  new Set(widgetNames.map((n) => (n.endsWith(SANDBOX_SUFFIX) ? n.slice(0, -SANDBOX_SUFFIX.length) : n))),
);
const pkg = packageInfo();
const sourceStamp = maxMtime([
  path.resolve(__dirname, 'src'),
  path.resolve(__dirname, 'package.json'),
  path.resolve(__dirname, 'vite.config.ts'),
]);
const builtAt = Date.now();
const buildInfo = {
  name: pkg.name,
  version: pkg.version,
  build_id: `${pkg.version}:${String(sourceStamp)}`,
  built_at: builtAt,
  source_stamp: sourceStamp,
  mode: 'dist',
} as const;

export default defineConfig({
  base: '',
  define: {
    __REMNOTE_PLUGIN_BUILD_INFO__: JSON.stringify(buildInfo),
  },
  plugins: [
    react(),
    virtualWidgetEntriesPlugin(widgetSource),
    devEntryShimPlugin(widgetSource),
    injectImportMetaConstantPlugin(),
    emitReadmePlugin(),
    emitBuildInfoPlugin(buildInfo),
    duplicateSandboxCssPlugin(baseWidgetNames),
  ],
  server: {
    port: 8080,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: true,
    assetsDir: '',
    rollupOptions: {
      input: inputs,
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name ?? '';
          if (name.endsWith('.css')) return name;
          return '[name]-[hash][extname]';
        },
      },
    },
  },
});
