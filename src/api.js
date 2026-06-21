import { API_URL } from './config.js';

// O Google Apps Script, ao receber um POST com Content-Type "application/json",
// faz um preflight CORS que o Apps Script não responde corretamente.
// Por isso, enviamos como "text/plain" — o Apps Script ainda consegue
// fazer JSON.parse no corpo recebido (ver Code.gs: e.postData.contents).

async function callApi(action, payload) {
  const isList = action === "list" || action === "ping";

  if (isList) {
    const res = await fetch(`${API_URL}?action=${action}`, { method: "GET" });
    if (!res.ok) throw new Error("Falha na requisição: " + res.status);
    return res.json();
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) throw new Error("Falha na requisição: " + res.status);
  return res.json();
}

export async function listPatients() {
  const data = await callApi("list");
  if (!data.ok) throw new Error(data.error || "Erro ao listar pacientes");
  return data.patients || [];
}

export async function savePatient(patient) {
  const data = await callApi("save", { patient });
  if (!data.ok) throw new Error(data.error || "Erro ao salvar paciente");
  return data.patient;
}

export async function deletePatient(id) {
  const data = await callApi("delete", { id });
  if (!data.ok) throw new Error(data.error || "Erro ao excluir paciente");
  return data.deleted;
}

export async function pingApi() {
  return callApi("ping");
}
