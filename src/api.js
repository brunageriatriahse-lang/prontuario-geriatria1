import { API_URL } from './config.js';

async function callApiGet(action, params) {
  const url = new URL(API_URL);
  url.searchParams.set("action", action);
  if (params) Object.keys(params).forEach(key => url.searchParams.set(key, params[key]));
  let res;
  try {
    res = await fetch(url.toString(), { method: "GET" });
  } catch (err) {
    throw new Error("Não foi possível conectar à API (" + err.message + "). Verifique sua conexão ou a URL em src/config.js.");
  }
  if (!res.ok) throw new Error("Falha na requisição: " + res.status);
  return res.json();
}

export async function listPatients(ambulatorio) {
  const data = await callApiGet("list", ambulatorio ? { ambulatorio } : {});
  if (!data.ok) throw new Error(data.error || "Erro ao listar pacientes");
  return data.patients || [];
}

export async function savePatient(patient, ambulatorio) {
  try {
    await fetch(API_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "save", patient, ambulatorio: ambulatorio || "cempre" }),
    });
  } catch (err) {
    throw new Error("Não foi possível conectar à API (" + err.message + ").");
  }
  return patient;
}

export async function deletePatient(id, ambulatorio) {
  try {
    await fetch(API_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "delete", id, ambulatorio: ambulatorio || "cempre" }),
    });
  } catch (err) {
    throw new Error("Não foi possível conectar à API (" + err.message + ").");
  }
  return true;
}

export async function purgePatient(id) {
  const data = await callApiGet("purge", { id });
  if (!data.ok) throw new Error(data.error || "Erro ao excluir definitivamente");
  return true;
}

export async function pingApi() {
  return callApiGet("ping");
}
