import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateFabricConsumption } from '../src/lib/fabricConsumption';

test('145 cm com peças de 45 × 35 cm resulta em 0,12 m por peça', () => {
  const result = calculateFabricConsumption(145, 45, 35);
  assert.equal(result.piecesPerRow, 3);
  assert.equal(result.exactCmPerPiece, 35 / 3);
  assert.equal(result.roundedCmPerPiece, 12);
  assert.equal(result.metersPerPiece, 0.12);
});

test('respeita orientação e não arredonda quocientes inteiros para cima', () => {
  assert.equal(calculateFabricConsumption(145, 35, 45).piecesPerRow, 4);
  assert.equal(calculateFabricConsumption(100, 50, 24).roundedCmPerPiece, 12);
  assert.equal(calculateFabricConsumption(100, 100, 35).metersPerPiece, 0.35);
  assert.equal(calculateFabricConsumption(1, 0.1, 1.1).roundedCmPerPiece, 1);
});

test('aceita medidas decimais e arredonda consumo fracionário para cima', () => {
  assert.equal(calculateFabricConsumption(145.5, 48.5, 36.3).roundedCmPerPiece, 13);
});

test('rejeita medidas inválidas e peças que não cabem', () => {
  for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(() => calculateFabricConsumption(value, 45, 35));
    assert.throws(() => calculateFabricConsumption(145, value, 35));
    assert.throws(() => calculateFabricConsumption(145, 45, value));
  }
  assert.throws(() => calculateFabricConsumption(40, 45, 35));
});
