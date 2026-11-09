import test from 'node:test';
import assert from 'node:assert/strict';
import { countList, plural } from '../src/engine/text.js';

test('plural puts the count in front of the right form', () => {
  assert.equal(plural(0, 'city', 'cities'), '0 cities');
  assert.equal(plural(1, 'city', 'cities'), '1 city');
  assert.equal(plural(2, 'city', 'cities'), '2 cities');
  assert.equal(plural(1, 'unit'), '1 unit');
  assert.equal(plural(3, 'unit'), '3 units');
});

test('countList names only the non-zero counts', () => {
  const names = { infantry: ['Infantry', 'Infantry'], settler: ['Settler', 'Settlers'], ship: ['Ship', 'Ships'] };
  assert.equal(countList({ infantry: 1, settler: 0, ship: 0 }, names), '1 Infantry');
  assert.equal(countList({ infantry: 2, settler: 1, ship: 3 }, names), '2 Infantry, 1 Settler, 3 Ships');
  assert.equal(countList({ infantry: 0, settler: 0, ship: 0 }, names), '');
});
