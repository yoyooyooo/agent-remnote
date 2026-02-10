# agent-remnote Bridge Plugin (Vite)

This is the RemNote plugin package under `packages/plugin/`, built with Vite (Rollup).

## Build Outputs (aligned with RemNote constraints)

- `dist/` contains: `manifest.json`, `index.js`, `index-sandbox.js`, `index.css`, `index-sandbox.css`, `index.html`
- Other dependencies / split chunks are included as `*-<hash>.js` and bundled into `PluginZip.zip`

## Build & Install

1. Build and zip

```bash
cd packages/plugin
npm run build # outputs dist/ and PluginZip.zip
```

2. Install the local plugin zip in RemNote

- RemNote → Settings → Plugins → Developer → Install From Zip
- Select `packages/plugin/PluginZip.zip`

Note: `public/manifest.json` currently uses the same `id` as the webpack version. If you need to install both side-by-side,
change the `id` first.

## Local Preview (optional)

```bash
cd packages/plugin
npm run dev
```

Then open:

- `http://localhost:8080/index.html?widgetName=index`
