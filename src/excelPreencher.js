/**
 * excelPreencher.js
 * Busca o modelo .xlsm da pasta public/, preenche os dados do paciente
 * via edição cirúrgica do ZIP interno (preserva 100% VBA/macros/formatação),
 * e retorna um Blob para download.
 */

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

function addSharedString(xml, texto) {
  const escaped = texto.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const matches = [...xml.matchAll(/<si><t[^>]*>(.*?)<\/t><\/si>/gs)];
  for (let i = 0; i < matches.length; i++) {
    if (matches[i][1] === texto || matches[i][1] === escaped) return [xml, i];
  }
  const nova = `<si><t xml:space="preserve">${escaped}</t></si>`;
  xml = xml.replace('</sst>', nova + '</sst>');
  const total = (xml.match(/<si>/g) || []).length;
  xml = xml.replace(/count="\d+"/, `count="${total}"`);
  xml = xml.replace(/uniqueCount="\d+"/, `uniqueCount="${total}"`);
  return [xml, total - 1];
}

function upsertCell(sheetXml, rowNum, col, cellXml) {
  const cref = `${col}${rowNum}`;
  const rowRe = new RegExp(`(<row[^>]+r="${rowNum}"[^>]*>)(.*?)(</row>)`, 's');
  const m = sheetXml.match(rowRe);
  if (!m) {
    const novaRow = `<row r="${rowNum}" spans="2:20">${cellXml}</row>`;
    const nextRe = new RegExp(`(<row[^>]+r="${rowNum+1}")`);
    if (nextRe.test(sheetXml)) return sheetXml.replace(nextRe, novaRow + '$1');
    return sheetXml.replace('</sheetData>', novaRow + '</sheetData>');
  }
  let content = m[2];
  const cellRe = new RegExp(`<c r="${cref}"[^>]*>.*?</c>`, 's');
  content = cellRe.test(content) ? content.replace(cellRe, cellXml) : cellXml + content;
  return sheetXml.replace(rowRe, m[1] + content + m[3]);
}

function setCellStr(sheetXml, row, col, idx) {
  return upsertCell(sheetXml, row, col, `<c r="${col}${row}" s="2" t="s"><v>${idx}</v></c>`);
}

function setCellNum(sheetXml, row, col, val) {
  return upsertCell(sheetXml, row, col, `<c r="${col}${row}" s="2"><v>${val}</v></c>`);
}

export async function preencherExcel({ nome, prontuario, maeNome, idade, sexo, data }) {
  const JSZip = await carregarJSZip();

  // Busca o modelo da pasta public/
  const resp = await fetch('/modelo.xlsm');
  if (!resp.ok) throw new Error('Modelo Excel não encontrado (/modelo.xlsm)');
  const arrayBuffer = await resp.arrayBuffer();

  const zip = await JSZip.loadAsync(arrayBuffer);

  let sharedXml = await zip.file('xl/sharedStrings.xml').async('string');
  let sheet1Xml = await zip.file('xl/worksheets/sheet1.xml').async('string');

  let iNome, iPron, iMae, iSexo, iData;
  [sharedXml, iNome]  = addSharedString(sharedXml, (nome || '').toUpperCase());
  [sharedXml, iPron]  = addSharedString(sharedXml, String(prontuario || ''));
  [sharedXml, iMae]   = addSharedString(sharedXml, (maeNome || '').toUpperCase());
  [sharedXml, iSexo]  = addSharedString(sharedXml, sexo || '');
  [sharedXml, iData]  = addSharedString(sharedXml, data || '');

  sheet1Xml = setCellStr(sheet1Xml, 7,  'C', iNome);
  sheet1Xml = setCellStr(sheet1Xml, 8,  'C', iPron);
  sheet1Xml = setCellStr(sheet1Xml, 9,  'C', iMae);
  if (idade !== '' && idade != null) sheet1Xml = setCellNum(sheet1Xml, 12, 'C', Number(idade));
  sheet1Xml = setCellStr(sheet1Xml, 13, 'C', iSexo);
  sheet1Xml = setCellStr(sheet1Xml, 16, 'C', iData);

  zip.file('xl/sharedStrings.xml', sharedXml);
  zip.file('xl/worksheets/sheet1.xml', sheet1Xml);

  const outBuf = await zip.generateAsync({
    type: 'arraybuffer',
    mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return new Blob([outBuf], {
    type: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  });
}
