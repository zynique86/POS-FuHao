import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stationForCategory } from '../types';

test('routes back-kitchen (wok) categories to the kitchen printer', () => {
  for (const cat of ['noodles', 'noodles / fried', 'fried', 'rice']) {
    assert.equal(stationForCategory(cat), 'kitchen', `category: ${cat}`);
  }
});

test('routes drinks to the bar printer', () => {
  assert.equal(stationForCategory('drinks'), 'bar');
});

test('routes front-kitchen categories to the cashier printer', () => {
  for (const cat of ['dim sum', 'buns', 'roasted', 'other']) {
    assert.equal(stationForCategory(cat), 'cashier', `category: ${cat}`);
  }
});

test('normalises casing and whitespace', () => {
  assert.equal(stationForCategory('  Dim Sum  '), 'cashier');
  assert.equal(stationForCategory('DRINKS'), 'bar');
  assert.equal(stationForCategory('Noodles'), 'kitchen');
});

test('defaults unknown / missing categories to the cashier (front counter)', () => {
  assert.equal(stationForCategory('mystery'), 'cashier');
  assert.equal(stationForCategory(''), 'cashier');
  assert.equal(stationForCategory(null), 'cashier');
  assert.equal(stationForCategory(undefined), 'cashier');
});
