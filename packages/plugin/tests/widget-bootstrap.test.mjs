import assert from 'node:assert/strict';
import test from 'node:test';

import { createSandboxScript, resolveWidgetName } from '../public/widget-bootstrap.js';

test('resolveWidgetName uses query param when present', () => {
  assert.equal(resolveWidgetName('http://localhost:8080/index.html?widgetName=sample_widget'), 'sample_widget');
});

test('resolveWidgetName falls back to index on root path', () => {
  assert.equal(resolveWidgetName('http://localhost:8080/'), 'index');
});

test('createSandboxScript never emits undefined-sandbox.js for root path', () => {
  const script = createSandboxScript('http://localhost:8080/');
  assert.equal(script.src, 'index-sandbox.js');
  assert.equal(script.type, 'module');
});
