/** Consumo médio por peça em fileiras de orientação fixa, com arredondamento para cima em cm. */
export function calculateFabricConsumption(fabricWidth: number, pieceWidth: number, pieceLength: number) {
  if ([fabricWidth, pieceWidth, pieceLength].some(value => !Number.isFinite(value) || value <= 0)) {
    throw new Error("Informe medidas positivas em centímetros.");
  }
  const piecesPerRow = Math.floor(fabricWidth / pieceWidth);
  if (!Number.isSafeInteger(piecesPerRow) || piecesPerRow < 1) {
    throw new Error("A largura da peça deve caber na largura útil do tecido.");
  }
  const exactCmPerPiece = pieceLength / piecesPerRow;
  // Evita arredondar um centímetro extra devido à precisão de ponto flutuante.
  const roundedCmPerPiece = Math.ceil(Number(exactCmPerPiece.toPrecision(15)));
  return { piecesPerRow, exactCmPerPiece, roundedCmPerPiece, metersPerPiece: roundedCmPerPiece / 100 };
}
