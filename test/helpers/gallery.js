import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JSDOM, ResourceLoader, VirtualConsole } from 'jsdom';

export function assertGalleryPrivacy(document, requests = []) {
  const base = new URL(document.URL);
  for (const anchor of document.querySelectorAll('a[href]')) {
    const url = new URL(anchor.href);
    assert.equal(url.origin, base.origin);
    assert.ok(url.pathname === '/index.html' || url.pathname === '/' ||
      (anchor.hasAttribute('download') && /^\/media\/v\d{3,}\/(render|comparison)\.mp4$/.test(url.pathname)), `Unexpected navigation: ${url}`);
  }
  for (const element of document.querySelectorAll('[src], link[href], object[data], [srcset], form[action]')) {
    for (const attribute of ['src', 'href', 'data', 'action']) {
      if (!element.hasAttribute(attribute)) continue;
      const value = element.getAttribute(attribute);
      if (value) requests.push(new URL(value, base).href);
    }
    for (const candidate of (element.getAttribute('srcset') || '').split(',').filter(Boolean)) requests.push(new URL(candidate.trim().split(/\s+/)[0], base).href);
  }
  for (const request of requests) {
    const url = new URL(request, base);
    assert.equal(url.origin, base.origin, `External resource: ${url}`);
    assert.match(url.pathname, /^\/(?:theme\.(?:css|js)|data\.json|media\/v\d{3,}\/(?:render\.mp4|web\.mp4|reference-web\.mp4|comparison\.mp4|packet\/pair-\d{3}\.png))$/);
  }
}

export async function loadGallery(site, data) {
  const requests = [], errors = [];
  const origin = 'http://gallery.test';
  class Resources extends ResourceLoader {
    fetch(url) {
      requests.push(url);
      const parsed = new URL(url);
      if (parsed.origin !== origin || !['/theme.css', '/theme.js'].includes(parsed.pathname)) return null;
      return fs.readFile(path.join(site, parsed.pathname.slice(1)));
    }
  }
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(await fs.readFile(path.join(site, 'index.html'), 'utf8'), {
    url: origin + '/index.html', runScripts: 'dangerously', resources: new Resources(), virtualConsole: console,
    beforeParse(window) {
      window.fetch = async url => {
        requests.push(new URL(url, origin).href);
        return { ok: true, json: async () => structuredClone(data) };
      };
      window.HTMLMediaElement.prototype.pause = function () {};
      window.HTMLMediaElement.prototype.load = function () {};
    }
  });
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
  await new Promise(resolve => setImmediate(resolve));
  return { dom, document: dom.window.document, requests, errors };
}
