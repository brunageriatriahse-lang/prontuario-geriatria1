/**
 * excelPreencher.js
 * Preenche o modelo .xlsm via edição cirúrgica do ZIP,
 * preservando 100% da estrutura, VBA/macros e formatação.
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

/**
 * Conta o total de entradas <si> no sharedStrings.xml.
 * Usa split em vez de regex para ser imune a \r\n no conteúdo.
 */
function contarSharedStrings(xml) {
  return xml.split('<si>').length - 1;
}

/**
 * Verifica se um texto já existe nas shared strings.
 * Retorna o índice se encontrar, -1 se não encontrar.
 * Compara o texto escapado para XML.
 */
function buscarSharedString(xml, texto) {
  const escaped = texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Divide por <si> para iterar cada entrada
  const partes = xml.split('<si>');
  for (let i = 1; i < partes.length; i++) {
    const inner = partes[i].split('</si>')[0];
    // Extrai texto(s) da entrada
    const textos = [];
    const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let m;
    while ((m = re.exec(inner)) !== null) {
      textos.push(m[1]);
    }
    const valorCompleto = textos.join('');
    if (valorCompleto === texto || valorCompleto === escaped) {
      return i - 1; // índice 0-based
    }
  }
  return -1;
}

/**
 * Adiciona texto às shared strings se não existir.
 * Retorna [xmlAtualizado, índice].
 */
function addSharedString(xml, texto) {
  const idx = buscarSharedString(xml, texto);
  if (idx !== -1) return [xml, idx];

  const escaped = texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const nova = `<si><t xml:space="preserve">${escaped}</t></si>`;
  xml = xml.replace('</sst>', nova + '</sst>');

  const novoTotal = contarSharedStrings(xml);
  xml = xml.replace(/count="\d+"/, `count="${novoTotal}"`);
  xml = xml.replace(/uniqueCount="\d+"/, `uniqueCount="${novoTotal}"`);

  return [xml, novoTotal - 1];
}

function setCellStr(sheetXml, cref, strIdx) {
  const novaCell = `<c r="${cref}" s="2" t="s"><v>${strIdx}</v></c>`;
  const selfClose = new RegExp(`<c r="${cref}"[^/]*/>`);
  if (selfClose.test(sheetXml)) return sheetXml.replace(selfClose, novaCell);
  const withContent = new RegExp(`<c r="${cref}"[^>]*>[\\s\\S]*?<\\/c>`);
  if (withContent.test(sheetXml)) return sheetXml.replace(withContent, novaCell);
  return sheetXml;
}

function setCellNum(sheetXml, cref, value) {
  const novaCell = `<c r="${cref}" s="2"><v>${value}</v></c>`;
  const selfClose = new RegExp(`<c r="${cref}"[^/]*/>`);
  if (selfClose.test(sheetXml)) return sheetXml.replace(selfClose, novaCell);
  const withContent = new RegExp(`<c r="${cref}"[^>]*>[\\s\\S]*?<\\/c>`);
  if (withContent.test(sheetXml)) return sheetXml.replace(withContent, novaCell);
  return sheetXml;
}

export async function preencherExcel({ nome, prontuario, maeNome, idade, sexo, data }) {
  const JSZip = await carregarJSZip();

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
