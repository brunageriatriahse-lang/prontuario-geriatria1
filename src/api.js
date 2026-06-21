import { API_URL } from './config.js';

export async function listPatients() {
  const url = `${API_URL}?action=list`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erro ao listar');
  return data.patients;
}

export async function savePatient(patient) {
  const url = `${API_URL}?action=save&patient=${encodeURIComponent(JSON.stringify(patient))}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erro ao salvar');
  return data.patient;
}

export async function deletePatient(id) {
  const url = `${API_URL}?action=delete&id=${encodeURIComponent(id)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erro ao deletar');
  return data.deleted;
}
