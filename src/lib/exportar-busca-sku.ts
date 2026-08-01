type ItemExportacaoSku = {
  sku: string;
  tituloProduto: string | null;
  quantidade: number;
};

const encoder = new TextEncoder();

function escaparXml(valor: string) {
  return valor.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function uint16(valor: number) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, valor, true);
  return bytes;
}

function uint32(valor: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, valor, true);
  return bytes;
}

function juntar(partes: Uint8Array[]) {
  const resultado = new Uint8Array(partes.reduce((total, parte) => total + parte.length, 0));
  let offset = 0;
  for (const parte of partes) {
    resultado.set(parte, offset);
    offset += parte.length;
  }
  return resultado;
}

function crc32(dados: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of dados) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function criarZip(arquivos: Array<{ nome: string; conteudo: string }>) {
  const locais: Uint8Array[] = [];
  const centrais: Uint8Array[] = [];
  let offset = 0;

  for (const arquivo of arquivos) {
    const nome = encoder.encode(arquivo.nome);
    const conteudo = encoder.encode(arquivo.conteudo);
    const crc = crc32(conteudo);
    const local = juntar([uint32(0x04034b50), uint16(20), uint16(0x0800), uint16(0), uint16(0), uint16(0), uint32(crc), uint32(conteudo.length), uint32(conteudo.length), uint16(nome.length), uint16(0), nome, conteudo]);
    locais.push(local);
    centrais.push(juntar([uint32(0x02014b50), uint16(20), uint16(20), uint16(0x0800), uint16(0), uint16(0), uint16(0), uint32(crc), uint32(conteudo.length), uint32(conteudo.length), uint16(nome.length), uint16(0), uint16(0), uint16(0), uint16(0), uint32(0), uint32(offset), nome]));
    offset += local.length;
  }

  const central = juntar(centrais);
  return juntar([...locais, central, uint32(0x06054b50), uint16(0), uint16(0), uint16(arquivos.length), uint16(arquivos.length), uint32(central.length), uint32(offset), uint16(0)]);
}

export function criarExcelBuscaSku(dataBusca: string, itens: ItemExportacaoSku[]) {
  const linhaData = `<row r="1"><c r="A1" s="2" t="inlineStr"><is><t>Data da busca</t></is></c><c r="B1" t="inlineStr"><is><t>${escaparXml(dataBusca)}</t></is></c></row>`;
  const cabecalho = '<row r="3"><c r="A3" s="1" t="inlineStr"><is><t>SKU</t></is></c><c r="B3" s="1" t="inlineStr"><is><t>TITULO_PRODUTO</t></is></c><c r="C3" s="1" t="inlineStr"><is><t>QTD</t></is></c></row>';
  const linhas = itens.map((item, indice) => {
    const linha = indice + 4;
    return `<row r="${linha}"><c r="A${linha}" t="inlineStr"><is><t>${escaparXml(item.sku)}</t></is></c><c r="B${linha}" t="inlineStr"><is><t>${escaparXml(item.tituloProduto ?? "")}</t></is></c><c r="C${linha}"><v>${item.quantidade}</v></c></row>`;
  }).join("");

  return criarZip([
    { nome: "[Content_Types].xml", conteudo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { nome: "_rels/.rels", conteudo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { nome: "xl/workbook.xml", conteudo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="SKUs" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { nome: "xl/_rels/workbook.xml.rels", conteudo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { nome: "xl/styles.xml", conteudo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment horizontal="left"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    { nome: "xl/worksheets/sheet1.xml", conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="35" customWidth="1"/><col min="2" max="2" width="65" customWidth="1"/><col min="3" max="3" width="12" customWidth="1"/></cols><sheetData>${linhaData}${cabecalho}${linhas}</sheetData><autoFilter ref="A3:C${Math.max(3, itens.length + 3)}"/></worksheet>` },
  ]);
}

function normalizarTextoPdf(valor: string) {
  return valor.replaceAll(/[^\x20-\xFF]/g, "?");
}

function textoPdf(valor: string, limite?: number) {
  const normalizado = normalizarTextoPdf(valor);
  const resumido = limite && normalizado.length > limite
    ? `${normalizado.slice(0, limite - 3)}...`
    : normalizado;
  return resumido.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function larguraAproximadaPdf(valor: string, tamanhoFonte: number) {
  return [...valor].reduce((largura, caractere) => {
    if (/[MW@%&]/.test(caractere)) return largura + tamanhoFonte * 0.85;
    if (/[ilI.,'`:;!| ]/.test(caractere)) return largura + tamanhoFonte * 0.3;
    if (/[A-Z0-9]/.test(caractere)) return largura + tamanhoFonte * 0.62;
    return largura + tamanhoFonte * 0.52;
  }, 0);
}

function quebrarTextoPdf(valor: string, larguraMaxima: number, tamanhoFonte: number) {
  const palavras = normalizarTextoPdf(valor).trim().split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return [""];

  const linhas: string[] = [];
  let linhaAtual = "";

  function adicionarPalavraLonga(palavra: string) {
    let trecho = "";
    for (const caractere of palavra) {
      if (trecho && larguraAproximadaPdf(trecho + caractere, tamanhoFonte) > larguraMaxima) {
        linhas.push(trecho);
        trecho = caractere;
      } else {
        trecho += caractere;
      }
    }
    linhaAtual = trecho;
  }

  for (const palavra of palavras) {
    const candidata = linhaAtual ? `${linhaAtual} ${palavra}` : palavra;
    if (larguraAproximadaPdf(candidata, tamanhoFonte) <= larguraMaxima) {
      linhaAtual = candidata;
      continue;
    }

    if (linhaAtual) {
      linhas.push(linhaAtual);
      linhaAtual = "";
    }

    if (larguraAproximadaPdf(palavra, tamanhoFonte) > larguraMaxima) {
      adicionarPalavraLonga(palavra);
    } else {
      linhaAtual = palavra;
    }
  }

  if (linhaAtual) linhas.push(linhaAtual);
  return linhas;
}

function bufferLatin1(valor: string) {
  return new Uint8Array(Buffer.from(valor, "latin1"));
}

export function criarPdfBuscaSku(dataBusca: string, itens: ItemExportacaoSku[]) {
  const linhas = itens.map((item) => {
    // Reserva uma folga antes da coluna de quantidade, inclusive para sequências
    // longas sem espaços, cujos glifos podem ser mais largos que a média.
    const titulo = quebrarTextoPdf(item.tituloProduto ?? "", 270, 8);
    return {
      item,
      titulo,
      altura: Math.max(20, titulo.length * 10 + 10),
    };
  });
  const paginas: typeof linhas[] = [[]];
  let espacoRestante = 733 - 45;
  for (const linha of linhas) {
    if (paginas.at(-1)!.length > 0 && linha.altura > espacoRestante) {
      paginas.push([]);
      espacoRestante = 733 - 45;
    }
    paginas.at(-1)!.push(linha);
    espacoRestante -= linha.altura;
  }
  const objetos = new Map<number, Uint8Array>();
  const idsPaginas = paginas.map((_, indice) => 5 + indice * 2);

  objetos.set(1, bufferLatin1("<< /Type /Catalog /Pages 2 0 R >>"));
  objetos.set(2, bufferLatin1(`<< /Type /Pages /Kids [${idsPaginas.map((id) => `${id} 0 R`).join(" ")}] /Count ${paginas.length} >>`));
  objetos.set(3, bufferLatin1("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"));
  objetos.set(4, bufferLatin1("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"));

  paginas.forEach((linhasPagina, pagina) => {
    const comandos = [
      "BT /F2 16 Tf 40 805 Td (Anotar SKU) Tj ET",
      `BT /F1 10 Tf 40 786 Td (Data da busca: ${textoPdf(dataBusca)}) Tj ET`,
      "0.85 G 40 766 m 555 766 l S 0 G",
      "BT /F2 9 Tf 40 750 Td (SKU) Tj ET",
      "BT /F2 9 Tf 210 750 Td (TITULO_PRODUTO) Tj ET",
      "BT /F2 9 Tf 520 750 Td (QTD) Tj ET",
    ];
    let y = 733;
    for (const linha of linhasPagina) {
      const { item } = linha;
      comandos.push(`BT /F1 8 Tf 40 ${y} Td (${textoPdf(item.sku, 32)}) Tj ET`);
      linha.titulo.forEach((trecho, indice) => {
        comandos.push(`BT /F1 8 Tf 210 ${y - indice * 10} Td (${textoPdf(trecho)}) Tj ET`);
      });
      comandos.push(`BT /F1 8 Tf 520 ${y} Td (${textoPdf(String(item.quantidade), 8)}) Tj ET`);
      comandos.push(`0.92 G 40 ${y - linha.altura + 5} m 555 ${y - linha.altura + 5} l S 0 G`);
      y -= linha.altura;
    }
    comandos.push(`BT /F1 8 Tf 485 25 Td (Página ${pagina + 1} de ${paginas.length}) Tj ET`);

    const stream = bufferLatin1(comandos.join("\n"));
    const paginaId = idsPaginas[pagina];
    const conteudoId = paginaId + 1;
    objetos.set(paginaId, bufferLatin1(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${conteudoId} 0 R >>`));
    objetos.set(conteudoId, juntar([bufferLatin1(`<< /Length ${stream.length} >>\nstream\n`), stream, bufferLatin1("\nendstream")]));
  });

  const partes: Uint8Array[] = [bufferLatin1("%PDF-1.4\n%âãÏÓ\n")];
  const offsets = [0];
  let offset = partes[0].length;
  const totalObjetos = 4 + paginas.length * 2;
  for (let id = 1; id <= totalObjetos; id += 1) {
    offsets[id] = offset;
    const objeto = juntar([bufferLatin1(`${id} 0 obj\n`), objetos.get(id)!, bufferLatin1("\nendobj\n")]);
    partes.push(objeto);
    offset += objeto.length;
  }
  const inicioXref = offset;
  const xref = [`xref\n0 ${totalObjetos + 1}\n`, "0000000000 65535 f \n", ...offsets.slice(1).map((valor) => `${String(valor).padStart(10, "0")} 00000 n \n`), `trailer\n<< /Size ${totalObjetos + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF`].join("");
  partes.push(bufferLatin1(xref));
  return juntar(partes);
}
