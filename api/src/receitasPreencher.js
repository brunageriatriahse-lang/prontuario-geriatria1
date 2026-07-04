/**
 * receitasPreencher.js
 * Preenche os content controls do RECEITAS_HSE_OFICIAL.docx
 * com os dados do paciente, via edição cirúrgica do ZIP no browser.
 *
 * Content controls mapeados (w:alias):
 *   BM_PACIENTE  → nome em maiúsculas
 *   BM_PRONTUARIO → prontuário
 *   BM_MAE       → nome da mãe em maiúsculas
 *   BM_IDADE     → idade calculada
 *   BM_SEXO      → sexo (M/F)
 *   BM_SETOR     → GERIATRIA (fixo)
 */

import { RECEITAS_DOCX_B64 } from './receitasModelo.js';

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
 * Substitui o texto dos content controls com w:alias correspondente.
 * Cada SDT pode ter múltiplos <w:t> dentro de sdtContent —
 * preserva o primeiro e zera os demais para evitar duplicatas.
 */
function substituirSDT(xml, alias, novoValor) {
  // Escapa valor para XML
  const valorEscapado = (novoValor || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Regex que captura cada w:sdt com o alias desejado
  const sdtRe = new RegExp(
    '(<w:sdt>[\\s\\S]*?w:alias w:val="' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[\\s\\S]*?<w:sdtContent>)([\\s\\S]*?)(</w:sdtContent>\\s*</w:sdt>)',
    'g'
  );

  return xml.replace(sdtRe, (match, antes, content, depois) => {
    // Substitui o primeiro <w:t> com o novo valor, zera os demais
    let first = true;
    const novoContent = content.replace(
      /(<w:t[^>]*>)([^<]*?)(<\/w:t>)/g,
      (m, open, _texto, close) => {
        if (first) { first = false; return open + valorEscapado + close; }
        return open + close;
      }
    );
    return antes + novoContent + depois;
  });
}

export async function preencherReceitasDocx({ nome, prontuario, maeNome, idade, sexo }) {
  const JSZip = await carregarJSZip();

  // Decodifica base64 → ArrayBuffer
  const bin = atob(RECEITAS_DOCX_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const zip = await JSZip.loadAsync(bytes.buffer);
  let docXml = await zip.file('word/document.xml').async('string');

  // Preenche cada campo
  docXml = substituirSDT(docXml, 'BM_PACIENTE',   (nome || '').toUpperCase());
  docXml = substituirSDT(docXml, 'BM_PRONTUARIO', String(prontuario || ''));
  docXml = substituirSDT(docXml, 'BM_MAE',        (maeNome || '').toUpperCase());
  docXml = substituirSDT(docXml, 'BM_IDADE',      String(idade != null ? idade : ''));
  docXml = substituirSDT(docXml, 'BM_SEXO',       sexo || '');
  docXml = substituirSDT(docXml, 'BM_SETOR',      'GERIATRIA');

  zip.file('word/document.xml', docXml);

  const outBuf = await zip.generateAsync({
    type: 'arraybuffer',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return new Blob([outBuf], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
