/**
 * excelPreencher.js
 * Preenche o modelo .xlsm via edição cirúrgica do ZIP,
 * preservando 100% da estrutura, VBA/macros e formatação.
 * O modelo fica embutido em base64 para evitar problemas de upload binário.
 */

import { EXCEL_MODELO_B64 } from './excelModelo.js';

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

function setCellStr(sheetXml, cref, strIdx, style) {
  style = style || '2';
  const novaCell = `<c r="${cref}" s="${style}" t="s"><v>${strIdx}</v></c>`;
  const selfClose = new RegExp(`<c r="${cref}"[^/]*/>`);
  if (selfClose.test(sheetXml)) return sheetXml.replace(selfClose, novaCell);
  const withContent = new RegExp(`<c r="${cref}"[^>]*>.*?<\\/c>`, 's');
  if (withContent.test(sheetXml)) return sheetXml.replace(withContent, novaCell);
  return sheetXml;
}

function setCellNum(sheetXml, cref, value, style) {
  style = style || '2';
  const novaCell = `<c r="${cref}" s="${style}"><v>${value}</v></c>`;
  const selfClose = new RegExp(`<c r="${cref}"[^/]*/>`);
  if (selfClose.test(sheetXml)) return sheetXml.replace(selfClose, novaCell);
  const withContent = new RegExp(`<c r="${cref}"[^>]*>.*?<\\/c>`, 's');
  if (withContent.test(sheetXml)) return sheetXml.replace(withContent, novaCell);
  return sheetXml;
}

export async function preencherExcel({ nome, prontuario, maeNome, idade, sexo, data }) {
  const JSZip = await carregarJSZip();

  // Decodifica base64 embutido → ArrayBuffer (evita problema de upload binário)
  const bin = atob(EXCEL_MODELO_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const zip = await JSZip.loadAsync(bytes.buffer);

  let sharedXml = await zip.file('xl/sharedStrings.xml').async('string');
  let sheet1Xml = await zip.file('xl/worksheets/sheet1.xml').async('string');

  let iNome, iPron, iMae, iSexo, iData;
  [sharedXml, iNome] = addSharedString(sharedXml, (nome || '').toUpperCase());
  [sharedXml, iPron] = addSharedString(sharedXml, String(prontuario || ''));
  [sharedXml, iMae]  = addSharedString(sharedXml, (maeNome || '').toUpperCase());
  [sharedXml, iSexo] = addSharedString(sharedXml, sexo || '');
  [sharedXml, iData] = addSharedString(sharedXml, data || '');

  sheet1Xml = setCellStr(sheet1Xml, 'C7',  iNome);
  sheet1Xml = setCellStr(sheet1Xml, 'C8',  iPron);
  sheet1Xml = setCellStr(sheet1Xml, 'C9',  iMae);
  if (idade !== '' && idade != null) {
    sheet1Xml = setCellNum(sheet1Xml, 'C12', Number(idade));
  }
  sheet1Xml = setCellStr(sheet1Xml, 'C13', iSexo);
  sheet1Xml = setCellStr(sheet1Xml, 'C16', iData);

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
