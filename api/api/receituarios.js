// api/receituarios.js
// Função serverless Vercel — gera o Excel preenchido com dados do paciente
// usando ExcelJS, preservando formatação e fórmulas do modelo original.

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

// Caminho do modelo Excel dentro da pasta api/
const MODELO_PATH = path.join(__dirname, 'modelo.xlsm');

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { nome, prontuario, maeNome, idade, sexo, data } = req.body || {};

    // Verifica se o modelo existe
    if (!fs.existsSync(MODELO_PATH)) {
      return res.status(500).json({
        error: 'Modelo Excel não encontrado',
        path: MODELO_PATH,
        dir: fs.readdirSync(__dirname),
      });
    }

    // Carrega o workbook preservando fórmulas e formatação
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(MODELO_PATH);

    // Preenche apenas a aba Cadastro — as outras abas buscam via fórmula
    const ws = wb.getWorksheet('Cadastro');
    if (!ws) {
      return res.status(500).json({ error: 'Aba Cadastro não encontrada no modelo' });
    }

    ws.getCell('C7').value = (nome || '').toUpperCase();
    ws.getCell('C8').value = String(prontuario || '');
    ws.getCell('C9').value = (maeNome || '').toUpperCase();
    ws.getCell('C12').value = idade ? Number(idade) : '';
    ws.getCell('C13').value = sexo || '';
    ws.getCell('C14').value = 'GERIATRIA';
    ws.getCell('C16').value = data || '';

    // Gera o buffer do arquivo
    const buffer = await wb.xlsx.writeBuffer();

    const nomeArquivo = `Receituarios_${(nome || 'paciente').replace(/[^a-zA-Z\u00C0-\u00FF0-9 ]/g, '').trim()}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.status(200).send(Buffer.from(buffer));

  } catch (err) {
    console.error('Erro ao gerar Excel:', err);
    return res.status(500).json({
      error: err.message,
      stack: err.stack,
    });
  }
};
