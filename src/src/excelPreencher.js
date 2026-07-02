/**
 * excelPreencher.js
 * Preenche o arquivo .xlsm do HSE com dados do paciente
 * fazendo edição cirúrgica do ZIP interno, preservando 100%
 * das macros VBA, formatação e fórmulas do arquivo original.
 *
 * Usa JSZip (carregado via CDN) para manipular o ZIP sem
 * desmontar a estrutura do arquivo.
 */

// Carrega JSZip via CDN se ainda não estiver disponível
function carregarJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = () => resolve(window.JSZip);
    s.onerror = () => reject(new Error('Falha ao carregar JSZip'));
    document.head.appendChild(s);
  });
}

/**
 * Adiciona texto ao sharedStrings.xml se ainda não existir.
 * Retorna [xmlAtualizado, índice].
 */
function addSharedString(sharedXml, texto) {
  // Escapa caracteres XML
  const escaped = texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Verifica se já existe (comparação com texto escapado e não-escapado)
  const existingMatches = [...sharedXml.matchAll(/<si><t[^>]*>(.*?)<\/t><\/si>/gs)];
  for (let i = 0; i < existingMatches.length; i++) {
    const val = existingMatches[i][1];
    if (val === texto || val === escaped) return [sharedXml, i];
  }

  // Adiciona nova entrada
  const nova = `<si><t xml:space="preserve">${escaped}</t></si>`;
  let updated = sharedXml.replace('</sst>', nova + '</sst>');

  // Atualiza count e uniqueCount
  const novoTotal = (updated.match(/<si>/g) || []).length;
  updated = updated.replace(/count="\d+"/, `count="${novoTotal}"`);
  updated = updated.replace(/uniqueCount="\d+"/, `uniqueCount="${novoTotal}"`);

  return [updated, novoTotal - 1];
}

/**
 * Insere ou substitui uma célula de texto (shared string) em uma row do sheet XML.
 */
function setCellString(sheetXml, rowNum, col, strIdx, style = '2') {
  const cref = `${col}${rowNum}`;
  const novaCell = `<c r="${cref}" s="${style}" t="s"><v>${strIdx}</v></c>`;
  return _upsertCell(sheetXml, rowNum, col, cref, novaCell);
}

/**
 * Insere ou substitui uma célula numérica em uma row do sheet XML.
 */
function setCellNumber(sheetXml, rowNum, col, value, style = '2') {
  const cref = `${col}${rowNum}`;
  const novaCell = `<c r="${cref}" s="${style}"><v>${value}</v></c>`;
  return _upsertCell(sheetXml, rowNum, col, cref, novaCell);
}

function _upsertCell(sheetXml, rowNum, col, cref, novaCell) {
  const rowRe = new RegExp(`(<row[^>]+r="${rowNum}"[^>]*>)(.*?)(</row>)`, 's');
  const rowMatch = sheetXml.match(rowRe);

  if (!rowMatch) {
    // Row não existe — cria e insere antes da próxima row
    const novaRow = `<row r="${rowNum}" spans="2:20">${novaCell}</row>`;
    const nextRowRe = new RegExp(`<row[^>]+r="${rowNum + 1}"`);
    if (nextRowRe.test(sheetXml)) {
      return sheetXml.replace(nextRowRe, novaRow + '<row r="' + (rowNum + 1) + '"');
    }
    return sheetXml.replace('</sheetData>', novaRow + '</sheetData>');
  }

  let rowContent = rowMatch[2];
  const cellRe = new RegExp(`<c r="${cref}"[^>]*>.*?</c>`, 's');
  if (cellRe.test(rowContent)) {
    rowContent = rowContent.replace(cellRe, novaCell);
  } else {
    rowContent = novaCell + rowContent;
  }

  return sheetXml.replace(rowRe, rowMatch[1] + rowContent + rowMatch[3]);
}

/**
 * Função principal: recebe o base64 do modelo e os dados do paciente,
 * retorna um Blob .xlsm com os dados preenchidos e VBA intacto.
 */
export async function preencherExcel(modeloB64, { nome, prontuario, maeNome, idade, sexo, data }) {
  const JSZip = await carregarJSZip();

  // Decodifica base64 → ArrayBuffer
  const bin = atob(modeloB64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  // Carrega o ZIP
  const zip = await JSZip.loadAsync(bytes.buffer);

  // Lê os XMLs que precisamos modificar
  let sharedXml = await zip.file('xl/sharedStrings.xml').async('string');
  let sheet1Xml = await zip.file('xl/worksheets/sheet1.xml').async('string');

  // Adiciona os valores às shared strings
  let idxNome, idxPron, idxMae, idxSexo, idxData;
  [sharedXml, idxNome] = addSharedString(sharedXml, (nome || '').toUpperCase());
  [sharedXml, idxPron] = addSharedString(sharedXml, String(prontuario || ''));
  [sharedXml, idxMae] = addSharedString(sharedXml, (maeNome || '').toUpperCase());
  [sharedXml, idxSexo] = addSharedString(sharedXml, sexo || '');
  [sharedXml, idxData] = addSharedString(sharedXml, data || '');

  // Preenche as células do Cadastro
  sheet1Xml = setCellString(sheet1Xml, 7,  'C', idxNome);   // C7  = Nome paciente
  sheet1Xml = setCellString(sheet1Xml, 8,  'C', idxPron);   // C8  = Prontuário
  sheet1Xml = setCellString(sheet1Xml, 9,  'C', idxMae);    // C9  = Nome da mãe
  if (idade != null && String(idade).trim() !== '') {
    sheet1Xml = setCellNumber(sheet1Xml, 12, 'C', Number(idade)); // C12 = Idade
  }
  sheet1Xml = setCellString(sheet1Xml, 13, 'C', idxSexo);   // C13 = Sexo
  // C14 = GERIATRIA já vem preenchido no modelo
  sheet1Xml = setCellString(sheet1Xml, 16, 'C', idxData);   // C16 = Data

  // Salva os XMLs modificados de volta no ZIP
  zip.file('xl/sharedStrings.xml', sharedXml);
  zip.file('xl/worksheets/sheet1.xml', sheet1Xml);

  // Gera o arquivo final como Blob, mantendo TUDO o mais intacto (inclusive vbaProject.bin)
  const outBuffer = await zip.generateAsync({
    type: 'arraybuffer',
    mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return new Blob([outBuffer], {
    type: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  });
}
