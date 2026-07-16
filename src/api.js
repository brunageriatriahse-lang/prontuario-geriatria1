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

export async function purgePatient(id, ambulatorio) {
  const params = { id };
  if (ambulatorio) params.ambulatorio = ambulatorio;
  const data = await callApiGet("purge", params);
  if (!data.ok) throw new Error(data.error || "Erro ao excluir definitivamente");
  return true;
}

export async function pingApi() {
  return callApiGet("ping");
}

export async function listarFavoritosMedicacoes() {
  const data = await callApiGet("listarFavoritos");
  if (!data.ok) throw new Error(data.error || "Erro ao listar favoritos");
  return data.favoritos || [];
}

export async function salvarFavoritoMedicacao(favorito) {
  try {
    await fetch(API_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "salvarFavorito", favorito }),
    });
  } catch (err) {
    throw new Error("Não foi possível conectar à API (" + err.message + ").");
  }
  return favorito;
}

export async function removerFavoritoMedicacao(id) {
  const data = await callApiGet("removerFavorito", { id });
  if (!data.ok) throw new Error(data.error || "Erro ao remover favorito");
  return true;
}
