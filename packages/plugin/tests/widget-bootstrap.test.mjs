import { describe, expect, it } from 'vitest';

import { createSandboxScript, resolveWidgetName } from '../public/widget-bootstrap.js';

describe('widget bootstrap', () => {
  it('resolveWidgetName uses query param when present', () => {
    expect(resolveWidgetName('http://localhost:8080/index.html?widgetName=sample_widget')).toBe('sample_widget');
  });

  it('resolveWidgetName falls back to index on root path', () => {
    expect(resolveWidgetName('http://localhost:8080/')).toBe('index');
  });

  it('createSandboxScript never emits undefined-sandbox.js for root path', () => {
    const script = createSandboxScript('http://localhost:8080/');
    expect(script.src).toBe('index-sandbox.js');
    expect(script.type).toBe('module');
  });

  it('resolveWidgetName extracts widget name from path segment', () => {
    expect(resolveWidgetName('http://localhost:8080/todo/')).toBe('todo');
    expect(resolveWidgetName('http://localhost:8080/my-widget')).toBe('my-widget');
  });

  it('createSandboxScript uses path-based widget name', () => {
    const script = createSandboxScript('http://localhost:8080/todo/');
    expect(script.src).toBe('todo-sandbox.js');
    expect(script.type).toBe('module');
  });
});
