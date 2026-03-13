function toUrl(input) {
  if (input instanceof URL) return input;
  if (typeof input === 'string') return new URL(input);

  if (input && typeof input === 'object') {
    if (typeof input.href === 'string') return new URL(input.href);

    const origin = typeof input.origin === 'string' && input.origin !== 'null' ? input.origin : 'http://localhost';
    const pathname = typeof input.pathname === 'string' ? input.pathname : '/';
    const search = typeof input.search === 'string' ? input.search : '';
    return new URL(`${origin}${pathname}${search}`);
  }

  throw new TypeError('Unsupported location input');
}

export function resolveWidgetName(input) {
  const url = toUrl(input);
  const queryWidgetName = url.searchParams.get('widgetName');

  if (queryWidgetName) return queryWidgetName;

  const normalizedPath = url.pathname.replace(/\/+$/, '') || '/';
  const lastSegment = normalizedPath === '/' ? '' : normalizedPath.split('/').pop() ?? '';

  if (lastSegment && lastSegment !== 'index' && lastSegment !== 'index.html') {
    return lastSegment;
  }

  return 'index';
}

export function createSandboxScript(input) {
  const widgetName = resolveWidgetName(input);
  return {
    src: `${widgetName}-sandbox.js`,
    type: 'module',
  };
}

export function mountSandboxScript({ location = window.location, document = window.document } = {}) {
  const sandboxScript = createSandboxScript(location);
  const script = document.createElement('script');
  script.type = sandboxScript.type;
  script.src = sandboxScript.src;
  document.body.appendChild(script);
  return script;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  mountSandboxScript();
}
