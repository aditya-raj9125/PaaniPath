import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, icon } from '@paanipath/ui';
import { publicSpot, PROFILES } from '@paanipath/domain';
import { seedGurugramSpots } from '@paanipath/data';
import { shell, spotDetail } from '../apps/web/src/views.ts';

test('crowd-entered names cannot become executable markup or attributes', () => {
  const text = `<img src=x onerror="alert('x')"> &`;
  const escaped = escapeHtml(text);
  assert.equal(escaped.includes('<img'), false);
  assert.equal(escaped.includes('"'), false);
  assert.equal(escaped.includes("'"), false);
  assert(escaped.includes('&lt;img')); assert(escaped.includes('&amp;'));
});
test('unknown icon names do not interpolate user-supplied SVG markup', () => {
  const svg = icon('<script>alert(1)</script>');
  assert.equal(svg.includes('<script>'), false); assert(svg.includes('aria-hidden="true"'));
});

test('researched scenario details show source date, approximate pin and simulated status', () => {
  const seed = seedGurugramSpots(Date.now())[0]; const profile = PROFILES[1]; assert(seed && profile);
  const html = spotDetail(publicSpot(seed, profile, Date.now()));
  assert(html.includes('2025-07-10')); assert(html.includes('ABP Live'));
  assert(html.includes('Approximate pin')); assert(html.includes('not a live flood report'));
  assert(html.includes('rel="noopener noreferrer"')); assert(!shell().includes('data-action="theme"'));
});
