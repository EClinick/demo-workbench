import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../lib/common.js';
import { loadGallery, assertGalleryPrivacy } from './helpers/gallery.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = (label, scores = null) => ({
  label, v: label, width: 160, height: 120, resolution: '160×120', duration: 1,
  video: `media/${label}/web.mp4`, download: `media/${label}/render.mp4`,
  sidebyside: `media/${label}/comparison.mp4`, comparisonAspect: '8/3',
  reference: `media/${label}/reference-web.mp4`, sheets: [`media/${label}/packet/pair-001.png`],
  outputSha256: label, scores, review: scores ? { critics: [{ name: 'Timing', model: 'manual', score: 8 }], rubric: 'Timing' } : null
});

test('generated gallery shows pending scores, selects either comparison, and keeps links/resources local', async t => {
  const temp = await fs.mkdtemp(path.join(repo, '.gallery-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const project = path.join(temp, 'demo');
  run(process.execPath, [path.join(repo, 'bin/cli.js'), 'init', project]);
  const page = await loadGallery(path.join(project, 'public'), {
    title: 'Synthetic demo', description: 'Public gallery contract', generated: '2026-01-01',
    versions: [version('v003'), version('v002', [8]), version('v001')]
  });
  const { document, dom } = page;
  t.after(() => dom.window.close());
  assert.deepEqual(page.errors, []);
  assert.equal(document.getElementById('project-title').textContent, 'Synthetic demo');
  assert.equal(document.getElementById('m-score').textContent, 'not judged yet');
  const rows = [...document.querySelectorAll('#scores tbody tr')];
  assert.equal(rows[0].textContent, 'v001: not judged yet');
  assert.equal(rows[2].textContent, 'v003: not judged yet');
  assert.equal(rows[1].lastElementChild.textContent, '8.0');
  for (const [side, initial, selected] of [['a', 'v002', 'v001'], ['b', 'v003', 'v001']]) {
    const media = document.getElementById(`cv-${side}`);
    assert.equal(new URL(media.src).pathname, `/media/${initial}/web.mp4`);
    const select = document.getElementById(`cmp-${side}`);
    select.value = [...select.options].find(option => option.textContent === selected).value;
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(new URL(media.src).pathname, `/media/${selected}/web.mp4`);
  }
  const tabs = document.querySelectorAll('#featplayer [role=tab]');
  tabs[0].click();
  assert.equal(new URL(document.querySelector('#featplayer video').src).pathname, '/media/v003/web.mp4');
  tabs[1].click();
  assert.equal(new URL(document.querySelector('#featplayer video').src).pathname, '/media/v003/comparison.mp4');
  for (const details of document.querySelectorAll('details')) {
    details.open = true;
    details.dispatchEvent(new dom.window.Event('toggle'));
  }
  document.querySelector('#gallery button').click();
  assert.equal(new URL(document.querySelector('#lb img').src).pathname, '/media/v003/packet/pair-001.png');
  assertGalleryPrivacy(document, page.requests);
  assert.deepEqual(page.errors, []);
});
