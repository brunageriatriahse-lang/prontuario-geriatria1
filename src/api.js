import { API_URL } from './config.js';

// Helper interno: faz POST com o corpo em JSON (sem usar query string),
// evitando o limite de tamanho de URL que causava o "Erro ao salvar"
// intermitente conforme o paciente acumulava mais consultas/dados.
async function postAction(body) {
  const res = await fetch(API_URL, {
    method: 'POST',
    // Usamos text/plain para evitar o preflight CORS de OPTIONS, que o
    // Google Apps Script (doPost) não responde por padrão.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function listPatients() {
  // "list" não tem payload, então GET simples continua funcionando bem aqui.
  const url = `${API_URL}?action=list`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erro ao listar');
  return data.patients;
}

export async function savePatient(patient) {
  const data = await postAction({ action: 'save', patient });
  if (!data.ok) throw new Error(data.error || 'Erro ao salvar');
  return data.patient;
}

export async function deletePatient(id) {
  const data = await postAction({ action: 'delete', id });
  if (!data.ok) throw new Error(data.error || 'Erro ao deletar');
  return data.deleted;
}
