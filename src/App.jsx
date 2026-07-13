import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { listPatients, savePatient, deletePatient as apiDeletePatient, purgePatient } from './api.js';
import { API_URL } from './config.js';
import { LOGO_HSE_BASE64, LOGO_GERIATRIA_BASE64 } from './logos.js';
import { preencherExcel } from './excelPreencher.js';

// ============================================================
// GOOGLE DRIVE OAUTH2 — Upload direto sem intermediário
// ============================================================
const GOOGLE_CLIENT_ID = "467817041013-amr370inb53rdqr6eoarme46m03bo4a7.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const PASTA_RAIZ = "PRONTUÁRIO CEMPRE - PACIENTES BRUNA";

function getNomeAmbulatorio(ambulatorio) {
  return ambulatorio === 'residencia' ? 'AMBULATÓRIO DE GERIATRIA - HSE' : 'AMBULATÓRIO DE GERIATRIA - CEMPRE';
}

let _driveToken = null;
let _driveTokenExpiry = 0;

// Carrega Google Identity Services via script tag
function _carregarGIS() {
  if (window.google && window.google.accounts) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Falha ao carregar Google Identity Services'));
    document.head.appendChild(s);
  });
}

async function getDriveToken() {
  // Verifica token em memória
  if (_driveToken && Date.now() < _driveTokenExpiry) return _driveToken;

  await _carregarGIS();

  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error) { reject(new Error(response.error)); return; }
        _driveToken = response.access_token;
        _driveTokenExpiry = Date.now() + (parseInt(response.expires_in || 3600) - 60) * 1000;
        resolve(_driveToken);
      },
    });
    client.requestAccessToken({ prompt: 'consent' });
  });
}

// Busca ou cria pasta no Drive
async function getDriveFolder(token, nomePasta, parentId) {
  // Busca pasta existente
  const q = parentId
    ? `name="${nomePasta}" and mimeType="application/vnd.google-apps.folder" and "${parentId}" in parents and trashed=false`
    : `name="${nomePasta}" and mimeType="application/vnd.google-apps.folder" and trashed=false`;

  const searchResp = await fetch(
    "https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({ q, fields: "files(id,name)" }),
    { headers: { Authorization: "Bearer " + token } }
  );
  const searchData = await searchResp.json();
  if (searchData.files && searchData.files.length > 0) return searchData.files[0].id;

  // Cria pasta
  const meta = { name: nomePasta, mimeType: "application/vnd.google-apps.folder" };
  if (parentId) meta.parents = [parentId];
  const createResp = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(meta),
  });
  const createData = await createResp.json();
  return createData.id;
}

// Upload direto para o Drive — rápido e definitivo
async function salvarNoDrive(blob, nomePaciente, nomeArquivo) {
  try {
    const token = await getDriveToken();

    // Cria/busca pasta raiz e subpasta do paciente
    const pastaRaizId = await getDriveFolder(token, PASTA_RAIZ, null);
    const pastaPacId  = await getDriveFolder(token, (nomePaciente || "SEM_NOME").toUpperCase(), pastaRaizId);

    // Remove arquivo anterior com mesmo nome
    const q = `name="${nomeArquivo}" and "${pastaPacId}" in parents and trashed=false`;
    const listResp = await fetch(
      "https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({ q, fields: "files(id)" }),
      { headers: { Authorization: "Bearer " + token } }
    );
    const listData = await listResp.json();
    if (listData.files) {
      for (const f of listData.files) {
        await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, {
          method: "DELETE",
          headers: { Authorization: "Bearer " + token },
        });
      }
    }

    // Upload multipart
    const metadata = JSON.stringify({ name: nomeArquivo, parents: [pastaPacId] });
    const boundary = "drive_upload_boundary";
    const arrayBuf = await blob.arrayBuffer();

    const metaBytes = new TextEncoder().encode(
      "--" + boundary + "\r\n" +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      metadata + "\r\n" +
      "--" + boundary + "\r\n" +
      "Content-Type: " + (blob.type || "application/octet-stream") + "\r\n\r\n"
    );
    const endBytes = new TextEncoder().encode("\r\n--" + boundary + "--");
    const body = new Uint8Array(metaBytes.length + arrayBuf.byteLength + endBytes.length);
    body.set(metaBytes, 0);
    body.set(new Uint8Array(arrayBuf), metaBytes.length);
    body.set(endBytes, metaBytes.length + arrayBuf.byteLength);

    const uploadResp = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "multipart/related; boundary=" + boundary,
        },
        body: body,
      }
    );

    if (!uploadResp.ok) {
      const err = await uploadResp.text();
      return { ok: false, error: "Drive API: " + err };
    }

    const fileData = await uploadResp.json();
    return { ok: true, link: fileData.webViewLink, nome: fileData.name, pasta: nomePaciente.toUpperCase() };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}


// salvarNoDrive definido acima via OAuth2
async function salvarReceitasNoDrive() { return { ok:false, error:"deprecated" }; }


async function preencherReceitasDocx({ nome, prontuario, maeNome, idade, sexo }) {
  if (!window.JSZip) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = res;
      s.onerror = () => rej(new Error('Falha ao carregar JSZip'));
      document.head.appendChild(s);
    });
  }
  const resp = await fetch('/receitas.docx');
  if (!resp.ok) throw new Error('Modelo Word nao encontrado');
  const buf = await resp.arrayBuffer();
  const zip = await window.JSZip.loadAsync(buf);
  let xml = await zip.file('word/document.xml').async('string');

  const campos = {
    BM_PACIENTE:   (nome || '').toUpperCase(),
    BM_PRONTUARIO: String(prontuario || ''),
    BM_MAE:        (maeNome || '').toUpperCase(),
    BM_IDADE:      String(idade != null ? idade : ''),
    BM_SEXO:       sexo || '',
    BM_SETOR:      'GERIATRIA',
  };

  Object.entries(campos).forEach(([alias, valor]) => {
    const esc = valor.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    // Substitui texto dentro de cada SDT com o alias correspondente
    // usando split para evitar regex complexa
    const partes = xml.split('<w:sdt>');
    xml = partes.map((parte, i) => {
      if (i === 0) return parte;
      if (!parte.includes('w:alias w:val="' + alias + '"')) return '<w:sdt>' + parte;
      // Encontra sdtContent e substitui o primeiro w:t
      const sdtContentIdx = parte.indexOf('<w:sdtContent>');
      const sdtEndIdx = parte.indexOf('</w:sdtContent>');
      if (sdtContentIdx === -1 || sdtEndIdx === -1) return '<w:sdt>' + parte;
      const antes = parte.slice(0, sdtContentIdx + 14);
      const content = parte.slice(sdtContentIdx + 14, sdtEndIdx);
      const depois = parte.slice(sdtEndIdx);
      // Substitui o primeiro <w:t...>...</w:t>
      let first = true;
      const novoContent = content.replace(/<w:t([^>]*)>[^<]*<\/w:t>/g, (m, attrs) => {
        if (first) { first = false; return '<w:t' + attrs + '>' + esc + '</w:t>'; }
        return '<w:t' + attrs + '></w:t>';
      });
      return '<w:sdt>' + antes + novoContent + depois;
    }).join('');
  });

  zip.file('word/document.xml', xml);
  const out = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}



const PROBLEMAS = ["HAS","DM2","Dislipidemia","Obesidade","Esteatose hepática","DRC","DAC","IC","FA","AVC","DPOC","Asma","HPB","Incontinência urinária","DRGE","Constipação crônica","Osteoporose","Osteoartrose","Hipotireoidismo","Transtorno depressivo","TAG","Insônia","Síndrome demencial","Doença de Parkinson","Neoplasia","DHC","Insuficiência venosa crônica","DAOP","Catarata","Glaucoma","Déficit auditivo A/E"];

const PREVENCAO_ESPECIFICA = {
  "HAS": ["MAPA 24h","ECG (anual)","ECOTT (se HVE ou IC; a cada 2 anos)","BNP (se suspeita de IC)","Polissonografia (se suspeita de SAOS)"],
  "DM2": ["Fundoscopia (anual)","ECG (anual)","Exame dos pés (toda consulta)"],
  "Dislipidemia": ["ECG (anual)"],
  "Obesidade": ["USG de abdome total (anual)","Elastografia hepática (se FIB-4 ≥ 1,3)"],
  "Esteatose hepática": ["USG de abdome total (anual)","Elastografia hepática (se FIB-4 ≥ 1,3)"],
  "DHC": ["USG de abdome total (6/6 meses)","AFP (6/6 meses)","Elastografia hepática","EDA"],
  "DRC": ["USG de rins e vias urinárias com resíduo pós-miccional","PSA total e livre"],
  "DAC": ["ECG (anual)","ECOTT (a cada 2 anos)","Teste ergométrico","Cintilografia miocárdica (repouso e estresse farmacológico)"],
  "IC": ["ECG (anual)","ECOTT (a cada 2 anos)","RX de tórax PA e perfil"],
  "FA": ["ECG","Holter 24h","ECOTT"],
  "AVC": ["ECG","Holter 24h","ECOTT","USG Doppler de artérias carótidas e vertebrais","TC de crânio s/ contraste","RNM de crânio s/ contraste"],
  "DPOC": ["Espirometria com prova broncodilatadora (anual)","RX de tórax PA e perfil","TC de tórax s/ contraste"],
  "Asma": ["Espirometria com prova broncodilatadora (anual)","RX de tórax PA e perfil"],
  "HPB": ["USG de rins e vias urinárias com resíduo pós-miccional","PSA total e livre"],
  "Incontinência urinária": ["USG de rins e vias urinárias com resíduo pós-miccional","Urocultura","Urofluxometria"],
  "DRGE": ["EDA (se sintomas de alarme ou > 5 anos de sintomas)"],
  "Constipação crônica": ["Colonoscopia (se > 45 anos sem rastreio prévio)"],
  "Osteoporose": ["Densitometria mineral óssea (a cada 1-2 anos)","RX de coluna (se dor ou suspeita de fratura)"],
  "Osteoartrose": ["RX das articulações acometidas","USG articular (se derrame)"],
  "Hipotireoidismo": ["TSH, T4 livre (a cada 6-12 meses ou após ajuste de dose)","ECG (anual)"],
  "Transtorno depressivo": ["GDS-15 (toda consulta)"],
  "TAG": ["GDS-15 (toda consulta)"],
  "Insônia": ["Polissonografia (se suspeita de SAOS ou síndrome das pernas inquietas)"],
  "Síndrome demencial": ["MEEM / MoCA (toda consulta)","RNM de crânio s/ contraste","TC de crânio s/ contraste","Vitamina B12, ácido fólico, TSH, VDRL"],
  "Doença de Parkinson": ["RNM de crânio s/ contraste","Avaliação neuropsicológica"],
  "Neoplasia": ["Seguimento com oncologista"],
  "Insuficiência venosa crônica": ["USG Doppler venoso de MMII"],
  "DAOP": ["USG Doppler arterial de MMII"],
  "Catarata": ["Avaliação oftalmológica anual"],
  "Glaucoma": ["Avaliação oftalmológica anual"],
  "Déficit auditivo A/E": ["Avaliação otorrinolaringológica"],
};

const VACINAS = [
  { nome: "Influenza", esquema: "Anual" },
  { nome: "COVID-19", esquema: "Reforço a cada 6 meses" },
  { nome: "Pneumocócica", esquema: "VPC20 dose única OU VPC13/15 → (≥2m) → VPP23 → (5a) → VPP23" },
  { nome: "dT / dTpa", esquema: "0-2-4 meses; reforço dTpa a cada 10 anos" },
  { nome: "Herpes-zóster (VZR)", esquema: "2 doses (0-2 meses)" },
  { nome: "VSR", esquema: "Dose única" },
  { nome: "Hepatite B", esquema: "3 doses (0-1-6 meses)" },
];

const VACINAS_DOC = ["Influenza", "COVID-19", "Pneumocócica", "dT/dTpa", "Hepatite B", "Vírus sincicial respiratório (VSR)", "Herpes-zóster (VZR recombinante)"];

const RASTREIO_GERAL = [
  { nome: "Colonoscopia", criterio: "45–75 anos (75–85 individualizar); a cada 10 anos" },
  { nome: "Pesquisa de sangue oculto nas fezes", criterio: "45–75 anos (75–85 individualizar); anual" },
  { nome: "Densitometria óssea", criterio: "Homem ≥70 / Mulher ≥65 anos; a cada 2–5 anos" },
  { nome: "Mamografia bilateral", criterio: "50–75 anos ou expectativa de vida >10 anos; bianual", sexo: "F" },
  { nome: "Citologia oncótica", criterio: "25–64 anos; a cada 3 anos (suspender com 2 exames prévios normais)", sexo: "F" },
  { nome: "PSA total e livre", criterio: "55–69 anos; a cada 2 anos", sexo: "M" },
  { nome: "TC tórax baixa dose", criterio: "Tabagista ≥20 maços-ano, cessação <15 anos, 50–80 anos; anual", requerTabagismo: true },
  { nome: "USG aorta abdominal", criterio: "Tabagista 65–75 anos; única vez", requerTabagismo: true, sexo: "M" },
];

const BEERS_LIST = [
  // Anticolinérgicos
  "amitriptilina","nortriptilina","imipramina","clorpromazina","tioridazina","prometazina",
  "hidroxizina","difenidramina","dexclorfeniramina","clorfeniramina","ciproeptadina",
  "oxibutinina","solifenacina","tolterodina","darifenacina","fesoterodina","flavoxato",
  "escopolamina","atropina","ipratrópio oral",
  // Benzodiazepínicos e Z-drugs
  "diazepam","clonazepam","alprazolam","lorazepam","midazolam","bromazepam",
  "clobazam","clorazepato","nitrazepam","flurazepam","triazolam",
  "zolpidem","zopiclona","eszopiclona",
  // Cardiovascular
  "amiodarona","digoxina","nifedipina","doxazosina","alfuzosina","terazosina",
  "espironolactona","ticlopidina","dipiridamol",
  // Hipoglicemiantes
  "glibenclamida","clorpropamida","glipizida","tolbutamida",
  // AINEs e analgésicos
  "indometacina","cetorolaco","ibuprofeno","diclofenaco","naproxeno","piroxicam",
  "meloxicam","nimesulida","celecoxibe","meperidina","tramadol","pentazocina",
  // Antipsicóticos
  "olanzapina","quetiapina","risperidona","haloperidol","clorpromazina","tioridazina",
  "aripiprazol","ziprasidona","paliperidona","clozapina",
  // Antidepressivos
  "fluoxetina","paroxetina","amitriptilina","nortriptilina","imipramina","doxepina",
  // Outros
  "metoclopramida","domperidona","óleo mineral","mineral oil","aas","ácido acetilsalicílico",
  "sulfato ferroso","hidróxido de alumínio","baclofeno","carisoprodol","ciclobenzaprina",
  "metaxalona","metocarbamol","orfenadrina","relaxantes musculares",
  "clonidina","metildopa","reserpina","guanetidina",
  "estrogênio oral","androgênio","testosterona oral","medroxiprogesterona oral",
  "cimetidina","ranitidina","indinavir","insulina detemir","insulina glargina",
];

// Cada interação tem grupos: a interação dispara quando há ≥1 match em cada grupo distinto.
// Isso evita falsos positivos de duas drogas do mesmo grupo.
const INTERACOES = [
  {
    grupos: [
      ["aas","ácido acetilsalicílico","aspirina"],
      ["varfarina","warfarina","acenocumarol"]
    ],
    msg: "AAS + Varfarina: risco aumentado de sangramento"
  },
  {
    grupos: [
      ["aas","ácido acetilsalicílico","aspirina"],
      ["clopidogrel","ticagrelor","prasugrel"]
    ],
    msg: "AAS + Clopidogrel/Ticagrelor: dupla antiagregação — risco de sangramento"
  },
  {
    grupos: [
      ["varfarina","warfarina","acenocumarol"],
      ["fluconazol","metronidazol","amiodarona","eritromicina","claritromicina","sulfametoxazol","ciprofloxacino","levofloxacino"]
    ],
    msg: "Varfarina + inibidor enzimático: potencialização do anticoagulante — monitorar INR"
  },
  {
    grupos: [
      ["captopril","enalapril","lisinopril","ramipril","perindopril","benazepril","quinapril","trandolapril","fosinopril"],
      ["espironolactona","eplerenona"]
    ],
    msg: "IECA + Espironolactona: risco de hipercalemia"
  },
  {
    grupos: [
      ["captopril","enalapril","lisinopril","ramipril","perindopril","losartana","valsartana","irbesartana","olmesartana","telmisartana","candesartana"],
      ["ibuprofeno","diclofenaco","naproxeno","indometacina","piroxicam","meloxicam","nimesulida","cetorolaco","celecoxibe"]
    ],
    msg: "IECA/BRA + AINE: risco de lesão renal aguda e hiperpotassemia"
  },
  {
    grupos: [
      ["metformina"],
      ["contraste iodado"]
    ],
    msg: "Metformina + Contraste iodado: risco de acidose lática — suspender 48h antes"
  },
  {
    grupos: [
      ["digoxina"],
      ["amiodarona"]
    ],
    msg: "Digoxina + Amiodarona: aumento dos níveis de digoxina — risco de toxicidade"
  },
  {
    grupos: [
      ["digoxina"],
      ["claritromicina","eritromicina","azitromicina"]
    ],
    msg: "Digoxina + Macrolídeo: aumento dos níveis de digoxina"
  },
  {
    grupos: [
      ["sinvastatina","atorvastatina","rosuvastatina","pravastatina","lovastatina"],
      ["claritromicina","eritromicina"]
    ],
    msg: "Estatina + Macrolídeo (claritromicina/eritromicina): risco de miopatia/rabdomiólise"
  },
  {
    grupos: [
      ["furosemida","hidroclorotiazida","indapamida","clortalidona","bumetanida"],
      ["ibuprofeno","diclofenaco","naproxeno","indometacina","piroxicam","meloxicam","nimesulida","cetorolaco"]
    ],
    msg: "Diurético + AINE: risco de insuficiência renal e redução do efeito diurético"
  },
  {
    grupos: [
      ["propranolol","metoprolol","atenolol","carvedilol","bisoprolol","nebivolol"],
      ["verapamil","diltiazem"]
    ],
    msg: "Betabloqueador + Verapamil/Diltiazem: risco de bloqueio AV e bradicardia grave"
  },
  {
    grupos: [
      ["fluoxetina","sertralina","paroxetina","escitalopram","citalopram","fluvoxamina"],
      ["ibuprofeno","diclofenaco","naproxeno","indometacina","piroxicam","meloxicam","nimesulida","aas","ácido acetilsalicílico","aspirina","varfarina","warfarina","acenocumarol"]
    ],
    msg: "ISRS + AINE/Anticoagulante: risco aumentado de sangramento digestivo"
  },
  {
    grupos: [
      ["morfina","codeína","tramadol","oxicodona","fentanil","meperidina","buprenorfina","hidromorfona"],
      ["diazepam","clonazepam","alprazolam","lorazepam","midazolam","bromazepam","nitrazepam","zolpidem","zopiclona"]
    ],
    msg: "Opioide + Benzodiazepínico/Z-drug: risco de depressão respiratória grave"
  },
  {
    grupos: [
      ["metoclopramida","haloperidol","risperidona","olanzapina","quetiapina","clorpromazina"],
      ["levodopa","pramipexol","ropinirol","rotigotina"]
    ],
    msg: "Antiemético/Antipsicótico + Antiparkinsônico: antagonismo farmacológico"
  },
  {
    grupos: [
      ["lítio"],
      ["captopril","enalapril","lisinopril","ramipril","losartana","valsartana","ibuprofeno","diclofenaco","naproxeno","furosemida","hidroclorotiazida","indapamida"]
    ],
    msg: "Lítio + IECA/BRA/AINE/Diurético: risco de toxicidade por lítio"
  },
  {
    grupos: [
      ["sildenafila","tadalafila","vardenafila","avanafila"],
      ["nitroglicerina","isossorbida","mononitrato","dinitrato","nitrato"]
    ],
    msg: "Inibidor de PDE5 + Nitrato: risco de hipotensão grave"
  },
  {
    grupos: [
      ["levotiroxina"],
      ["omeprazol","pantoprazol","lansoprazol","rabeprazol","esomeprazol","dexlansoprazol"]
    ],
    msg: "Levotiroxina + IBP: redução da absorção — administrar com 30-60 min de intervalo"
  },
  {
    grupos: [
      ["levotiroxina"],
      ["carbonato de cálcio","cálcio","sulfato ferroso","ferro"]
    ],
    msg: "Levotiroxina + Cálcio/Ferro: redução da absorção — administrar com 4h de intervalo"
  },
  {
    grupos: [
      ["ciprofloxacino","levofloxacino","moxifloxacino"],
      ["amiodarona","haloperidol","azitromicina","claritromicina","ondansetrona","metadona"]
    ],
    msg: "Fluorquinolona + Fármaco que prolonga QT: risco de Torsades de Pointes"
  },
  {
    grupos: [
      ["aas","ácido acetilsalicílico","aspirina","ibuprofeno","diclofenaco","naproxeno","indometacina","piroxicam","meloxicam","nimesulida"],
      ["varfarina","warfarina","acenocumarol","rivaroxabana","apixabana","dabigatrana","edoxabana"]
    ],
    msg: "AINE + Anticoagulante oral: risco elevado de sangramento — evitar combinação"
  },
];

function checkBeers(nomeMedicacao) {
  if (!nomeMedicacao) return null;
  const lower = nomeMedicacao.toLowerCase();
  // Busca palavra inteira ou início de palavra para evitar falsos positivos
  const found = BEERS_LIST.find(b => {
    const regex = new RegExp(`(^|\\s|,|;|\\+|-)${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    return regex.test(lower);
  });
  return found || null;
}

function checkInteracoes(texto) {
  if (!texto) return [];
  const lower = texto.toLowerCase();
  const alerts = [];
  INTERACOES.forEach(({ grupos, msg }) => {
    const todosGruposPresentes = grupos.every(grupo =>
      grupo.some(drug => {
        const regex = new RegExp(`(^|\\s|,|;|\\+|-|\\()${drug.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`, 'i');
        return regex.test(lower);
      })
    );
    if (todosGruposPresentes) alerts.push(msg);
  });
  return alerts;
}

function checkAlertasEspeciais(texto) {
  if (!texto) return [];
  const lower = texto.toLowerCase();
  const alerts = [];

  function temAlgum(lista) {
    return lista.some(drug => {
      const regex = new RegExp("(^|\\s|,|;|\\+|-|\\()" + drug.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&"), "i");
      return regex.test(lower);
    });
  }

  const IECA     = ["captopril","enalapril","lisinopril","ramipril","perindopril","benazepril","quinapril","trandolapril"];
  const BRA      = ["losartana","valsartana","irbesartana","olmesartana","telmisartana","candesartana"];
  const AINE     = ["ibuprofeno","diclofenaco","naproxeno","indometacina","piroxicam","meloxicam","nimesulida","cetorolaco","celecoxibe"];
  const DIUR     = ["furosemida","hidroclorotiazida","indapamida","clortalidona","bumetanida","espironolactona"];
  const ANTICOAG = ["varfarina","warfarina","acenocumarol","rivaroxabana","apixabana","dabigatrana","edoxabana"];
  const ANTIAGR  = ["aas","ácido acetilsalicílico","aspirina","clopidogrel","ticagrelor","prasugrel"];
  const IBP      = ["omeprazol","pantoprazol","lansoprazol","rabeprazol","esomeprazol","dexlansoprazol"];
  const BZD      = ["diazepam","clonazepam","alprazolam","lorazepam","midazolam","bromazepam","nitrazepam","zolpidem","zopiclona"];
  const BETABLOQ = ["propranolol","metoprolol","atenolol","carvedilol","bisoprolol","nebivolol"];
  const ANTIHIPER = ["captopril","enalapril","lisinopril","ramipril","losartana","valsartana","anlodipino","nifedipina","hidroclorotiazida","indapamida","furosemida","espironolactona","doxazosina","alfuzosina","clonidina","metildopa"];
  const QT_DRUGS = ["amiodarona","sotalol","haloperidol","tioridazina","clorpromazina","quetiapina","ziprasidona","metadona","azitromicina","claritromicina","eritromicina","ciprofloxacino","levofloxacino","moxifloxacino","ondansetrona","domperidona","citalopram","escitalopram","fluconazol"];

  // 1. Tríplice whammy
  if ((temAlgum(IECA) || temAlgum(BRA)) && temAlgum(AINE) && temAlgum(DIUR)) {
    alerts.push({ tipo: "danger", msg: "⚠ TRÍPLICE WHAMMY: IECA/BRA + AINE + Diurético — risco alto de insuficiência renal aguda. Monitorar função renal e evitar AINEs." });
  }

  // 2. Prolongamento de QT (≥2 fármacos)
  const qtMeds = QT_DRUGS.filter(drug => {
    const regex = new RegExp("(^|\\s|,|;|\\+|-|\\()" + drug.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&"), "i");
    return regex.test(lower);
  });
  if (qtMeds.length >= 2) {
    alerts.push({ tipo: "warning", msg: "⚠ PROLONGAMENTO DE QT: " + qtMeds.length + " fármacos de risco (" + qtMeds.slice(0,3).join(", ") + (qtMeds.length > 3 ? "..." : "") + "). Risco de Torsades de Pointes — considerar ECG." });
  }

  // 3. Anticoagulação sem proteção gástrica
  if ((temAlgum(ANTICOAG) || temAlgum(ANTIAGR)) && !temAlgum(IBP)) {
    alerts.push({ tipo: "warning", msg: "⚠ ANTICOAGULAÇÃO SEM PROTEÇÃO GÁSTRICA: considerar IBP (omeprazol, pantoprazol) para reduzir risco de sangramento digestivo." });
  }

  // 4. Risco de queda por medicamentos
  const medsCaida = [];
  if (temAlgum(BETABLOQ)) medsCaida.push("betabloqueador");
  if (temAlgum(DIUR)) medsCaida.push("diurético");
  if (temAlgum(BZD)) medsCaida.push("benzodiazepínico/Z-drug");
  if (temAlgum(ANTIHIPER) && !medsCaida.includes("diurético")) medsCaida.push("anti-hipertensivo");
  if (temAlgum(["amitriptilina","nortriptilina","trazodona","mirtazapina","olanzapina","quetiapina","haloperidol"])) medsCaida.push("psicotrópico");
  if (medsCaida.length >= 2) {
    alerts.push({ tipo: "warning", msg: "⚠ RISCO DE QUEDA POR MEDICAMENTOS: " + medsCaida.join(", ") + ". Revisar doses, horários e necessidade — especialmente se histórico de quedas." });
  }

  return alerts;
}

function calcIMC(peso, altura) {
  const p = parseFloat(peso);
  const a = parseFloat(altura);
  if (!p || !a) return null;
  return (p / (a * a)).toFixed(1);
}

function calcIdade(dn) {
  if (!dn) return null;
  // Força interpretação em horário local (evita o "Date('AAAA-MM-DD')" ser lido como
  // UTC meia-noite, o que em fusos negativos como o do Brasil pode voltar a data um dia
  // e gerar erro de 1 ano perto do aniversário).
  const birth = new Date(dn + "T00:00:00");
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age >= 0 ? age : null;
}

function uid() {
  return 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function fmtDate(iso) {
  if (!iso) return "";
  try {
    // Datas puras "AAAA-MM-DD" (sem horário) são interpretadas pelo JS como UTC meia-noite;
    // em fusos negativos (como o do Brasil) isso faz a data exibida "voltar" um dia.
    // Forçar horário local resolve. Se vier um valor já com horário (ex: timestamp completo),
    // o "T00:00:00" extra é ignorado por já haver um "T" na string.
    const temHorario = iso.includes("T");
    const d = new Date(temHorario ? iso : iso + "T00:00:00");
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch (e) { return iso; }
}

function fmtDateShort() {
  const d = new Date();
  return d.toLocaleDateString("pt-BR");
}

const RECEITA_BLOCOS = [
  { categoria: "PARA REFLUXO / ESTÔMAGO", itens: [
    { nome: "PANTOPRAZOL 40MG", qtd: "30CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO PELA MANHÃ, EM JEJUM, 30 MINUTOS ANTES DO CAFÉ DA MANHÃ." },
    { nome: "LUFTAGASTROPRO SUSPENSÃO ORAL", qtd: "01 FRASCO", posologia: "TOMAR 10ML APÓS AS 3 PRINCIPAIS REFEIÇÕES E ANTES DE DORMIR SE SINTOMAS DE REFLUXO." },
  ]},
  { categoria: "PARA TIREÓIDE", itens: [
    { nome: "PURAN T4 25MCG", qtd: "30CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO PELA MANHÃ, EM JEJUM, 30 MINUTOS ANTES DO CAFÉ DA MANHÃ. NÃO TOMAR JUNTO COM CÁLCIO, FERRO OU ANTIÁCIDOS. SE USAR OMEPRAZOL/PANTOPRAZOL: TOMAR PRIMEIRO PURAN, ESPERAR 30 MINUTOS PARA TOMAR OMEPRAZOL/PANTOPRAZOL E DEPOIS MAIS 30 MINUTOS PARA ALIMENTAÇÃO." },
  ]},
  { categoria: "PARA DIABETES", itens: [
    { nome: "GLIFAGE XR 500MG", qtd: "60CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO APÓS CAFÉ DA MANHÃ E JANTAR." },
    { nome: "FORXIGA (DAPAGLIFLOZINA) 10MG", qtd: "30CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO PELA MANHÃ." },
  ]},
  { categoria: "PARA PRESSÃO ALTA / CORAÇÃO", itens: [
    { nome: "LOSARTANA 50MG", qtd: "60CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO PELA MANHÃ E À NOITE." },
    { nome: "ENALAPRIL 5MG", qtd: "60CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO PELA MANHÃ E À NOITE." },
    { nome: "ANLODIPINO 10MG", qtd: "30CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO À NOITE." },
    { nome: "HIDROCLOROTIAZIDA 25MG", qtd: "30CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO PELA MANHÃ." },
    { nome: "SUCCINATO DE METOPROLOL 25MG", qtd: "30CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO PELA MANHÃ." },
    { nome: "ESPIRONOLACTONA 25MG", qtd: "30CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO À TARDE." },
    { nome: "AAS 100MG", qtd: "30CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO APÓS ALMOÇO." },
    { nome: "CLOPIDOGREL 75MG", qtd: "30CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO APÓS ALMOÇO." },
    { nome: "APIXABANA 5MG", qtd: "60CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO PELA MANHÃ E À NOITE. Usar 2,5 mg VO 12/12h se ≥2: Idade ≥ 80 anos, Peso ≤ 60 kg, Creatinina ≥ 1,5 mg/dL" },
  ]},
  { categoria: "PARA COLESTEROL ALTO", itens: [
    { nome: "SINVASTATINA 40MG", qtd: "30CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO À NOITE." },
    { nome: "ROSUVASTATINA 20MG", qtd: "30CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO À NOITE." },
    { nome: "EZETIMIBA 10MG", qtd: "30CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO À NOITE." },
  ]},
  { categoria: "PARA PRÓSTATA", itens: [
    { nome: "TANSULOSINA 0,4MG", qtd: "30CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO À NOITE." },
    { nome: "TANSULOSINA 0,4MG + DUTASTERIDA 0,5MG", qtd: "30CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO À NOITE." },
  ]},
  { categoria: "PARA BEXIGA / INCONTINÊNCIA URINÁRIA", itens: [
    { nome: "MIRABEGRONA 25MG", qtd: "30CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO À NOITE." },
  ]},
  { categoria: "PARA PRISÃO DE VENTRE / CONSTIPAÇÃO", itens: [
    { nome: "TAMARINE FIBRAS", qtd: "01 CAIXA", posologia: "DISSOLVER 01 MEDIDOR PRÓPRIO EM 200ML DE ÁGUA OU OUTROS LÍQUIDOS/ALIMENTOS (SUCO, IOGURTE, PURÊ). TOMAR 1 VEZ AO DIA, DE PREFERÊNCIA PELA MANHÃ. INGERIR 2-3L DE ÁGUA MINERAL DIARIAMENTE. OBS: DOSE MÁXIMA = 03 MEDIDORES/DIA." },
    { nome: "MUVINLAX", qtd: "01 CAIXA", posologia: "DILUIR 01 SACHÊ EM 125ML DE ÁGUA, CHÁ OU SUCO, À NOITE. INGERIR 2-3L DE ÁGUA MINERAL DIARIAMENTE. SUSPENDER MOMENTANEAMENTE SE DIARREIA." },
    { nome: "LACTULOSE 667 MG/ML", qtd: "01 CAIXA", posologia: "TOMAR 15ML, VIA ORAL, DE 12 EM 12 HORAS. INGERIR 2-3L DE ÁGUA MINERAL DIARIAMENTE. SUSPENDER MOMENTANEAMENTE SE DIARREIA." },
    { nome: "BISACODIL 5MG", qtd: "01 CAIXA", posologia: "TOMAR 01 COMPRIMIDO À NOITE. INGERIR 2-3L DE ÁGUA MINERAL DIARIAMENTE. SUSPENDER MOMENTANEAMENTE SE DIARREIA." },
  ]},
  { categoria: "PARA HEMORRÓIDA", usoTopico: true, itens: [
    { nome: "PROCTYL POMADA RETAL", qtd: "01 FRASCO", posologia: "APLICAR NA REGIÃO AFETADA, MASSAGEANDO O LOCAL, 2 VEZES AO DIA, ATÉ MELHORA DOS SINTOMAS." },
  ]},
  { categoria: "PARA OSTEOPOROSE", itens: [
    { nome: "COLECALCIFEROL (VITAMINA D) 50.000 UI", qtd: "8 COMPRIMIDOS", posologia: "TOMAR 1 COMPRIMIDO PELA MANHÃ, 1 VEZ POR SEMANA, POR 8 SEMANAS. APÓS, TROCAR PARA DOSAGEM DE 10.000 UI." },
    { nome: "COLECALCIFEROL (VITAMINA D) 10.000 UI", qtd: "4 COMPRIMIDOS/MÊS", posologia: "TOMAR 1 COMPRIMIDO PELA MANHÃ, 1 VEZ POR SEMANA. CONTÍNUO." },
    { nome: "CARBONATO DE CÁLCIO 500MG", qtd: "60CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO JUNTO AO CAFÉ DA MANHÃ E JANTAR." },
    { nome: "ALENDRONATO DE SÓDIO 70MG", qtd: "4 COMPRIMIDOS/MÊS", posologia: "TOMAR 1 COMPRIMIDO 1 VEZ POR SEMANA, EM JEJUM, COM COPO DE ÁGUA FERVIDA CHEIO (250ML). ESPERAR 30 MINUTOS PARA TOMAR CAFÉ DA MANHÃ. NÃO DEITAR POR PELO MENOS 2 HORAS APÓS USO." },
    { nome: "RISEDRONATO DE SÓDIO 150MG", qtd: "1 COMPRIMIDO/MÊS", posologia: "TOMAR 1 COMPRIMIDO 1 VEZ POR MÊS, EM JEJUM, COM COPO DE ÁGUA FERVIDA CHEIO (250ML). ESPERAR 30 MINUTOS PARA TOMAR CAFÉ DA MANHÃ. NÃO DEITAR POR PELO MENOS 2 HORAS APÓS USO." },
    { nome: "DENOSUMABE 60MG/ML", qtd: "1 UNIDADE/SEMESTRE", via: "USO SUBCUTÂNEO", posologia: "APLICAR 1 UNIDADE, VIA SUBCUTÂNEA EM BRAÇO, COXA OU ABDOME, 1 VEZ A CADA 6 MESES, POR TOTAL DE 3 ANOS. NÃO INTERROMPER MEDICAÇÃO DURANTE TRATAMENTO." },
    { nome: "TERIPARATIDA 20MCG", qtd: "30 UNIDADES/MÊS", posologia: "APLICAR 1 UNIDADE, VIA SUBCUTÂNEA EM COXA OU ABDOME, 1 VEZ AO DIA, POR TOTAL DE 2 ANOS." },
    { nome: "ÁCIDO ZOLEDRÔNICO 5MG", qtd: "1 UNIDADE/ANO", via: "USO ENDOVENOSO", posologia: "APLICAR 1 AMPOLA + 100ML SF 0,9%, EV, CORRER EM 30 MINUTOS. DOSE ANUAL. TOTAL DE 3 ANOS. É COMUM SENTIR SINTOMAS SEMELHANTES À QUADRO GRIPAL 24-72 HORAS APÓS APLICAÇÃO DA MEDICAÇÃO." },
  ]},
  { categoria: "PARA DEPRESSÃO / ANSIEDADE / INSÔNIA", itens: [
    { nome: "DULOXETINA 30MG", qtd: "30CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO PELA MANHÃ." },
    { nome: "TRAZODONA 50MG", qtd: "30CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO À NOITE." },
    { nome: "MIRTAZAPINA 15MG", qtd: "30CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO À NOITE." },
    { nome: "SERTRALINA 25MG", qtd: "30CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO PELA MANHÃ." },
    { nome: "ESCITALOPRAM 10MG", qtd: "30CP/MÊS", posologia: "TOMAR MEIO COMPRIMIDO PELA MANHÃ POR 7 DIAS. APÓS, TOMAR 1 COMPRIMIDO PELA MANHÃ." },
  ]},
  { categoria: "PARA VARIZES", itens: [
    { nome: "DIOSMIN 450 + 50MG", qtd: "60 CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO PELA MANHÃ E À NOITE." },
  ]},
  { categoria: "PARA DOENÇA ARTERIAL OBSTRUTIVA PERIFÉRICA NAS PERNAS", itens: [
    { nome: "CILOSTAZOL 100MG", qtd: "60 CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO PELA MANHÃ E À NOITE." },
    { nome: "AAS 100MG", qtd: "30 CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO APÓS ALMOÇO." },
    { nome: "CLOPIDOGREL 75MG", qtd: "30CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO APÓS ALMOÇO." },
    { nome: "ROSUVASTATINA 20MG", qtd: "30CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO À NOITE." },
  ]},
  { categoria: "PARA DEMÊNCIA", itens: [
    { nome: "DONEPEZILA 5MG", qtd: "30 CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO À NOITE." },
    { nome: "MEMANTINA 10MG", qtd: "30 CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO PELA MANHÃ." },
  ]},
  { categoria: "PARA DOENÇA DE PARKINSON / PARKINSONISMO", itens: [
    { nome: "PROLOPA 100/25MG", qtd: "90 CP/MÊS", posologia: "TOMAR 1 COMPRIMIDO, PELA MANHÃ, À TARDE E À NOITE, 30 MINUTOS ANTES DAS REFEIÇÕES OU 2 HORAS APÓS REFEIÇÕES." },
  ]},
  { categoria: "PARA DOR", itens: [
    { nome: "DIPIRONA 1G", qtd: "01 CAIXA", via: "USO ORAL", posologia: "TOMAR 1 COMPRIMIDO ATÉ DE 6/6 HORAS SE DOR." },
    { nome: "CAPSAICINA 0,025%", qtd: "1 UNIDADE", via: "USO TÓPICO", posologia: "APLICAR EM REGIÃO DOLOROSA, 3 VEZES AO DIA, SE DOR. LAVAR AS MÃOS APÓS APLICAÇÃO. A SENSAÇÃO DE ARDOR INICIAL É ESPERADA." },
  ]},
  { categoria: "PARA NÁUSEAS/VÔMITOS/DOR ABDOMINAL", itens: [
    { nome: "ONDANSETRONA 8MG", qtd: "01 CAIXA", posologia: "TOMAR 1 COMPRIMIDO ATÉ DE 8/8 HORAS SE NÁUSEAS OU VÔMITOS." },
    { nome: "BUSCOPAN COMPOSTO", qtd: "01 CAIXA", posologia: "TOMAR 1 COMPRIMIDO ATÉ DE 8/8 HORAS SE DOR ABDOMINAL." },
    { nome: "LUFTAL 125MG", qtd: "01 CAIXA", posologia: "TOMAR 1 COMPRIMIDO ATÉ DE 8/8 HORAS SE EMPACHAMENTO OU GASES." },
  ]},
  { categoria: "PARA PULMÃO", usoInalatorio: true, itens: [
    { nome: "ALÊNIA 6/200MCG", qtd: "1 UNIDADE", posologia: "ASPIRAR 1 CÁPSULA DE 12/12 HORAS. LAVAR A BOCA E ESCOVAR OS DENTES APÓS USO." },
    { nome: "SERETIDE DISKUS 50-250MCG", qtd: "1 UNIDADE", posologia: "ASPIRAR 1 DOSE DE 12/12 HORAS. LAVAR A BOCA E ESCOVAR OS DENTES APÓS USO." },
    { nome: "RELVAR 100-25MCG", qtd: "1 UNIDADE", posologia: "ASPIRAR 1 DOSE 1 VEZ AO DIA. LAVAR A BOCA E ESCOVAR OS DENTES APÓS USO." },
    { nome: "SPIRIVA 2,5MCG", qtd: "1 UNIDADE", posologia: "ASPIRAR 2 DOSES 1 VEZ AO DIA." },
    { nome: "SPIOLTO 2,5/2,5MCG", qtd: "1 UNIDADE", posologia: "ASPIRAR 2 DOSES 1 VEZ AO DIA." },
    { nome: "TRIMBOW 100/6/12,5 MCG", qtd: "1 UNIDADE", posologia: "ASPIRAR 2 JATOS DE 12/12 HORAS. LAVAR A BOCA E ESCOVAR OS DENTES APÓS USO." },
    { nome: "TRELLEGY 92/55/22 MCG", qtd: "1 UNIDADE", posologia: "ASPIRAR 1 DOSE 1 VEZ AO DIA. LAVAR A BOCA E ESCOVAR OS DENTES APÓS USO." },
  ]},
];

const EXAMES_LABORATORIAIS_PADRAO = [
  "HEMOGRAMA COMPLETO","PCR","UREIA E CREATININA","SÓDIO, POTÁSSIO, CLORO, MAGNÉSIO, FÓSFORO, CÁLCIO","BICARBONATO","PTH",
  "TGO, TGP","BILIRRUBINA TOTAL E FRAÇÕES","TP","TTPA, FIBRINOGÊNIO","FOSFATASE ALCALINA E GGT","AMILASE, LIPASE",
  "ÁCIDO ÚRICO","PROTEÍNA TOTAL E FRAÇÕES","GLICEMIA DE JEJUM","HEMOGLOBINA GLICADA","COLESTEROL TOTAL E FRAÇÕES",
  "TRIGLICERÍDEOS","TSH, T4 LIVRE","VITAMINA B12","ÁCIDO FÓLICO","VITAMINA D","CPK","RETICULÓCITOS","FERRO","FERRITINA",
  "IST","TIBIC","DHL","ELETROFORESE DE PROTEÍNAS","ANTI-HIV","ANTI-HBS","HBSAG","ANTI HBC IGG E IGM","ANTI HCV","VDRL",
  "PSA LIVRE E TOTAL","SUMÁRIO DE URINA","RELAÇÃO ALBUMINA CREATININA - URINA ISOLADA","UROCULTURA"
];

function emptyConsulta(base) {
  if (base) {
    const copy = JSON.parse(JSON.stringify(base));
    copy.id = uid();
    copy.data = new Date().toISOString().slice(0, 10);
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = new Date().toISOString();
    copy.pendenciasConsultaAtual = "";
    // Zera apenas os sinais vitais — mantém o restante do exame físico
    if (copy.exameFisico) {
      copy.exameFisico.paSentado = "";
      copy.exameFisico.paEmPe = "";
      copy.exameFisico.fc = "";
      copy.exameFisico.fr = "";
      copy.exameFisico.sato2 = "";
      copy.exameFisico.temp = "";
      copy.exameFisico.peso = "";
      copy.exameFisico.hgt = "";
    }
    return copy;
  }
  return {
    id: uid(),
    data: new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    problemas: {},
    problemasNotas: {},
    problemasCustom: [],
    antecedentes: { tabagismo: "", tabagismoInicio: "", tabagismoCessou: "", macosDia: "", macosAno: "", etilismo: "", etilismoTipo: "", etilismoFrequencia: "", etilismoInicio: "", etilismoCessou: "", cirurgias: "", internamentos: "", alergias: "", historicoFamiliar: "" },
    medicacoesTexto: "",
    medicacoesPrevias: "",
    queixas: "",
    aga: {
      aivd: {"Telefone":true,"Transporte":true,"Compras":true,"Preparar refeições":true,"Tarefas domésticas":true,"Trabalhos manuais":true,"Lavar roupas":true,"Medicações":true,"Finanças":true},
      abvd: {"Banho":true,"Vestir-se":true,"Higiene pessoal":true,"Transferência":true,"Continência":true,"Alimentação":true},
      marcha: "", dispositivo: "",
      quedas: "nao", quedasNum: "", quedasDescricao: "", fraturas: "nao", fraturasDescricao: "", tce: "nao", tceDescricao: "",
      frail: {}, semQueixasCognitivas: false, queixasCognitivasDescricao: "", minicog: "", meem: "", moca: "",
      semQueixasHumor: false, queixasHumorDescricao: "", gds15: "",
      semQueixasSono: false, roncos: "", sonolenciaDiurna: "", higieneSono: "",
      visao: "preservada", visaoLentes: "nao", audicao: "preservada", audicaoAparelho: "nao",
      incontinenciaUrinaria: "nao", incontinenciaUrinariaDes: "", incontinenciaFecal: "nao", incontinenciaFecalDes: "", constipacao: "nao", constipacaoDescricao: "",
      peso: "", pesoHabitual: "", altura: "", perdaPeso: "nao", perdaPesoKg: "", perdaPesoTempo: "",
      apetite: "preservado", disfagia: "ausente", disfagiaDieta: "",
      problemasDentarios: "nao", problemasDentariosDes: "", proteseDentaria: "nao",
      testeForca: "", circPanturrilha: "",
      atividadeFisica: "",
      sonoObservacoes: "",
    },
    vacinas: {},
    rastreioGeral: {},
    rastreioEspecifico: {},
    exameFisico: {
      paSentado: "", paEmPe: "", fc: "", fr: "", sato2: "", temp: "",
      geral: "EG bom, consciente, orientado, eupneico, corado, hidratado, anictérico, acianótico, afebril ao toque.",
      acv: "RCR em 2T, BNF, S/S.",
      ar: "MV+ em AHT, S/RA.",
      abd: "Semigloboso, depressível, normotimpânico, indolor à palpação, sem VMG ou massas palpáveis, RHA+.",
      ext: "Sem edemas, TEC 2s, panturrilhas livres.",
      sn: "Glasgow 15, PIFR, sem déficits focais.",
      pele: "",
    },
    labsTexto: "",
    imagemTexto: "",
    plano: { ajuste: "", solicito: "", orientacoes: "", encaminhamentos: "", retorno: "" },
    pendencias: [],
    pendenciasConsultaAtual: "",
    docs: {
      receitas: [],
      receitasEspeciais: [],
      examesSimplesLista: [],
      examesEspeciais: [],
      vacinacao: { selecionados: { "Influenza": true, "COVID-19": true, "Pneumocócica": true, "dT/dTpa": true, "Hepatite B": true, "Vírus sincicial respiratório (VSR)": true, "Herpes-zóster (VZR recombinante)": true } },
    },
  };
}

function emptyPatient() {
  return {
    id: uid(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ident: { prontuario: "", nome: "", cpf: "", sexo: "", dn: "", maeNome: "", natural: "", procedente: "", profissao: "", escolaridade: "", estadoCivil: "", religiao: "", acompanhante: "", cuidador: "", moraCom: "", podeContarCom: "", telefone: "" },
    consultas: [emptyConsulta()],
  };
}

const TABS = [
  { id: "ident", label: "Identificação", icon: "ti-id" },
  { id: "problemas", label: "Lista de problemas", icon: "ti-list-check" },
  { id: "antecedentes", label: "Antecedentes", icon: "ti-history" },
  { id: "medicacoes", label: "Medicações", icon: "ti-pill" },
  { id: "queixas", label: "Queixas", icon: "ti-message" },
  { id: "aga", label: "AGA", icon: "ti-clipboard-heart" },
  { id: "prevencao", label: "Prevenção", icon: "ti-shield-check" },
  { id: "exame", label: "Exame físico", icon: "ti-stethoscope" },
  { id: "exames", label: "Exames", icon: "ti-flask" },
  { id: "plano", label: "Plano", icon: "ti-target-arrow" },
];



function Field({ label, children, hint }) {
  return (
    <div style={{ marginBottom: "14px" }}>
      <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: "4px" }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "4px" }}>{hint}</div>}
    </div>
  );
}

function Row({ children, cols }) {
  return <div style={{ display: "grid", gridTemplateColumns: cols || "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>{children}</div>;
}

function SectionCard({ title, icon, children, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen !== false);
  return (
    <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "12px", marginBottom: "12px", background: "var(--color-background-primary)" }}>
      <button onClick={() => setOpen(!open)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 500, fontSize: "15px" }}>
          {icon && <i className={"ti " + icon} style={{ fontSize: "18px" }} aria-hidden="true"></i>}
          {title}
        </span>
        <i className={"ti " + (open ? "ti-chevron-up" : "ti-chevron-down")} style={{ fontSize: "16px", color: "var(--color-text-tertiary)" }} aria-hidden="true"></i>
      </button>
      {open && <div style={{ padding: "0 16px 16px" }}>{children}</div>}
    </div>
  );
}

function Pill({ children, color }) {
  const c = color || "gray";
  return <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px", padding: "2px 10px", borderRadius: "8px", background: `var(--color-background-${c})`, color: `var(--color-text-${c})`, fontWeight: 500 }}>{children}</span>;
}

function Alert({ type, children }) {
  const colors = { danger: "danger", warning: "warning", info: "info", success: "success" };
  const c = colors[type] || "info";
  const icons = { danger: "ti-alert-triangle", warning: "ti-alert-circle", info: "ti-info-circle", success: "ti-check" };
  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", padding: "10px 12px", borderRadius: "8px", background: `var(--color-background-${c})`, color: `var(--color-text-${c})`, fontSize: "13px", marginBottom: "10px" }}>
      <i className={"ti " + icons[type]} style={{ fontSize: "16px", marginTop: "1px", flexShrink: 0 }} aria-hidden="true"></i>
      <span>{children}</span>
    </div>
  );
}

function RadioGroup({ value, onChange, options, name }) {
  return (
    <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
      {options.map(opt => (
        <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px" }}>
          <input type="radio" name={name} checked={value === opt.value} onChange={() => onChange(opt.value)} />{opt.label}
        </label>
      ))}
    </div>
  );
}

function PrintShell({ title, children, onClose, fileName, patient, consulta }) {
  function handlePrint() {
    const titleAnterior = document.title;
    if (fileName) document.title = fileName;
    window.print();
    document.title = titleAnterior;
  }

  async function handlePrintEDrive() {
    if (!patient || !consulta) { handlePrint(); return; }
    const nomePaciente = patient.ident?.nome || 'Paciente';
    const hoje = new Date().toLocaleDateString('pt-BR');
    const salvar = confirm('Deseja salvar também no Google Drive como PDF?\n\nPasta: PRONTUÁRIO CEMPRE - PACIENTES BRUNA / ' + nomePaciente.toUpperCase());

    handlePrint();
    if (!salvar) return;

    try {
      async function carregarScript(src) {
        if (document.querySelector(`script[src="${src}"]`)) return;
        return new Promise((res, rej) => {
          const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
      }
      await carregarScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
      await carregarScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');

      const conteudo = document.getElementById('print-content');
      if (!conteudo) { alert('Conteúdo não encontrado'); return; }

      alert('Gerando PDF... Aguarde.');

      // Cria um iframe oculto com largura A4 (794px = 210mm a 96dpi)
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;height:auto;border:none;';
      document.body.appendChild(iframe);

      // Copia estilos da página principal
      const estilos = Array.from(document.styleSheets)
        .map(ss => { try { return Array.from(ss.cssRules).map(r => r.cssText).join('\n'); } catch(e) { return ''; } })
        .join('\n');

      iframe.contentDocument.open();
      iframe.contentDocument.write(`<!DOCTYPE html><html><head>
        <meta charset="UTF-8">
        <style>
          ${estilos}
          body { margin: 12mm; font-size: 11px; width: 186mm; background: white; color: black; }
          * { -webkit-print-color-adjust: exact; }
        </style>
      </head><body>${conteudo.innerHTML}</body></html>`);
      iframe.contentDocument.close();

      // Aguarda o iframe renderizar
      await new Promise(r => setTimeout(r, 800));

      const iframeBody = iframe.contentDocument.body;

      const canvas = await window.html2canvas(iframeBody, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        width: 794,
        windowWidth: 794,
      });

      document.body.removeChild(iframe);

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

      const pageW = 210, pageH = 297, margin = 12;
      const contentW = pageW - margin * 2;
      const contentH = pageH - margin * 2;
      const canvasH = (canvas.height / canvas.width) * contentW;

      let srcY = 0;
      let page = 0;
      while (srcY < canvasH) {
        if (page > 0) pdf.addPage();
        const sliceH = Math.min(canvasH - srcY, contentH);
        const sliceHpx = (sliceH / canvasH) * canvas.height;
        const srcYpx = (srcY / canvasH) * canvas.height;
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = Math.ceil(sliceHpx);
        const ctx = sliceCanvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        ctx.drawImage(canvas, 0, srcYpx, canvas.width, sliceHpx, 0, 0, canvas.width, sliceHpx);
        pdf.addImage(sliceCanvas.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, contentW, sliceH);
        srcY += contentH;
        page++;
      }

      const nomeArq = 'CONSULTA - ' + nomePaciente.replace(/[^a-zA-ZÀ-ÿ0-9 ]/g, '').trim() + ' ' + hoje.replace(/\//g, '-') + '.pdf';
      const pdfBlob = pdf.output('blob');

      const result = await salvarNoDrive(pdfBlob, nomePaciente, nomeArq);
      if (result.ok) {
        if (confirm('PDF salvo no Drive!\nPasta: PRONTUÁRIO CEMPRE - PACIENTES BRUNA / ' + nomePaciente.toUpperCase() + '\n\nClicar em OK para abrir?')) {
          window.open(result.link, '_blank');
        }
      } else {
        alert('Erro ao salvar no Drive: ' + result.error);
      }
    } catch(e) {
      alert('Erro ao gerar PDF: ' + e.message);
    }
  }
  return (
    <div id="print-shell-overlay" style={{ position: "fixed", inset: 0, zIndex: 50 }}>
      <style>{`
        @media print {
          #app-main-content { display: none !important; }
          #print-shell-overlay {
            position: static !important;
            inset: auto !important;
          }
          #print-shell-backdrop {
            position: static !important;
            min-height: 0 !important;
            background: none !important;
            padding: 0 !important;
            display: block !important;
            overflow: visible !important;
          }
          #print-shell-card {
            max-width: 100% !important;
            width: 100% !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            margin: 0 !important;
          }
          #print-shell-toolbar { display: none !important; }
          #print-shell-content {
            padding: 6px 10px !important;
          }
          #print-shell-content, #print-shell-content * {
            font-size: 9px !important;
            line-height: 1.3 !important;
          }
        }
      `}</style>
      <div id="print-shell-backdrop" style={{ minHeight: "100vh", background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 12px", overflowY: "auto" }}>
        <div id="print-shell-card" style={{ background: "#ffffff", color: "#111111", width: "100%", maxWidth: "680px", borderRadius: "12px", padding: "0", boxSizing: "border-box" }}>
          <div id="print-shell-toolbar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #e0e0e0" }}>
            <div style={{ fontWeight: 500, fontSize: "14px", color: "#333" }}>Pré-visualização — {title}</div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={handlePrintEDrive} style={{ fontSize: "13px", padding: "5px 12px", border: "1px solid #4285f4", borderRadius: "6px", background: "#e8f0fe", color: "#1a73e8", cursor: "pointer", marginRight: "6px" }}>
                🖨️+Drive
              </button>
              <button onClick={handlePrint} style={{ fontSize: "13px", padding: "5px 12px", border: "1px solid #ccc", borderRadius: "6px", background: "#f5f5f5", cursor: "pointer" }}>
                <i className="ti ti-printer" aria-hidden="true" style={{ marginRight: "4px" }}></i>Imprimir
              </button>
              <button onClick={onClose} style={{ fontSize: "13px", padding: "5px 12px", border: "1px solid #ccc", borderRadius: "6px", background: "#f5f5f5", cursor: "pointer" }}>
                <i className="ti ti-x" aria-hidden="true"></i>
              </button>
            </div>
          </div>
          <div id="print-shell-content" style={{ padding: "28px 32px", fontFamily: "Arial, sans-serif", fontSize: "13px", lineHeight: 1.45, color: "#111" }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function DocHeader({ title }) {
  return (
    <div style={{ marginBottom: "18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
        <div style={{ width: "34px", height: "34px", borderRadius: "4px", background: "#1F4E79", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "13px" }}>HSE</div>
        <div style={{ fontSize: "11px", color: "#555" }}>Hospital dos Servidores do Estado</div>
      </div>
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: "14px", letterSpacing: "0.3px" }}>{title}</div>
    </div>
  );
}

function DocFooter() {
  return (
    <div style={{ marginTop: "26px", paddingTop: "8px", borderTop: "1px solid #ddd", textAlign: "center", fontSize: "10px", color: "#666" }}>
      Av. Conselheiro Rosa e Silva, 36 - Aflitos - Recife - PE<br />
      CNPJ nº 11944899/0001-17 Telefone: 3183-4500
    </div>
  );
}

export default function App() {
  const [autenticado, setAutenticado] = useState(() => sessionStorage.getItem('auth') === '1');
  const [ambulatorio, setAmbulatorio] = useState(() => sessionStorage.getItem('ambulatorio') || null);
  const [senhaDigitada, setSenhaDigitada] = useState('');
  const [erroSenha, setErroSenha] = useState(false);
  const [patients, setPatients] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [activeConsultaId, setActiveConsultaId] = useState(null);
  const [view, setView] = useState("list");
  const [mode, setMode] = useState("prontuario");
  const [activeTab, setActiveTab] = useState("ident");
  const [saveStatus, setSaveStatus] = useState("idle");
  const [search, setSearch] = useState("");
  const [printDoc, setPrintDoc] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const saveTimers = useRef({});

  useEffect(() => {
    if (!autenticado || !ambulatorio) return;
    setPatients(null); // reset ao trocar ambulatório
    (async () => {
      try {
        const list = await listPatients(ambulatorio);
        let anyMigrated = false;
        const migrated = list.map(p => {
          if (p.consultas) return p;
          anyMigrated = true;
          const { id, createdAt, updatedAt, ident, ...rest } = p;
          return { id, createdAt, updatedAt, ident, consultas: [{ id: uid(), data: (createdAt || new Date().toISOString()).slice(0,10), createdAt: createdAt || new Date().toISOString(), updatedAt: updatedAt || new Date().toISOString(), ...rest }] };
        });

        // Expurgo automático: pacientes excluídos há mais de 30 dias somem de vez;
        // consultas excluídas há mais de 30 dias são removidas do array de consultas.
        const TRINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;
        const agora = Date.now();
        const expurgados = [];
        const limpos = migrated
          .filter(p => {
            if (p.deletedAt && (agora - new Date(p.deletedAt).getTime()) > TRINTA_DIAS_MS) {
              expurgados.push({ type: "patient", id: p.id });
              return false;
            }
            return true;
          })
          .map(p => {
            const consultasLimpas = (p.consultas || []).filter(c => {
              if (c.deletedAt && (agora - new Date(c.deletedAt).getTime()) > TRINTA_DIAS_MS) return false;
              return true;
            });
            if (consultasLimpas.length !== (p.consultas || []).length) {
              const atualizado = { ...p, consultas: consultasLimpas, updatedAt: new Date().toISOString() };
              savePatient(atualizado, ambulatorio).catch(e => console.error("Falha ao expurgar consultas antigas", e));
              return atualizado;
            }
            return p;
          });

        // Migração: rastreioGeral/rastreioEspecifico passaram de "um registro único por exame"
        // para "lista de registros por exame" (suporte a múltiplas datas/resultados ao longo do tempo).
        function migrarParaArray(obj) {
          if (!obj) return {};
          const novo = {};
          Object.keys(obj).forEach(chave => {
            const valor = obj[chave];
            if (Array.isArray(valor)) {
              novo[chave] = valor;
            } else if (valor && (valor.data || valor.resultado)) {
              novo[chave] = [{ id: uid(), data: valor.data || "", resultado: valor.resultado || "" }];
            } else {
              novo[chave] = [];
            }
          });
          return novo;
        }
        let algumMigradoRastreio = false;
        const comRastreioMigrado = limpos.map(p => {
          let mudouPaciente = false;
          const consultasMigradas = (p.consultas || []).map(c => {
            const precisaMigrarRg = c.rastreioGeral && Object.values(c.rastreioGeral).some(v => v && !Array.isArray(v));
            const precisaMigrarRe = c.rastreioEspecifico && Object.values(c.rastreioEspecifico).some(v => v && !Array.isArray(v));
            if (precisaMigrarRg || precisaMigrarRe) {
              mudouPaciente = true;
              algumMigradoRastreio = true;
              return { ...c, rastreioGeral: migrarParaArray(c.rastreioGeral), rastreioEspecifico: migrarParaArray(c.rastreioEspecifico) };
            }
            return c;
          });
          if (mudouPaciente) {
            const atualizado = { ...p, consultas: consultasMigradas };
            savePatient(atualizado, ambulatorio).catch(e => console.error("Falha ao migrar rastreio para array", e));
            return atualizado;
          }
          return p;
        });

        // Saneamento: campos de data de vacina com ano fora de uma faixa plausível
        // (ex: salvos por um bug de cálculo anterior) são limpos automaticamente.
        function dataPlausivel(s) {
          if (!s) return true;
          const ano = parseInt(String(s).slice(0, 4), 10);
          return !isNaN(ano) && ano >= 2015 && ano <= 2100;
        }

        // Migração: a Receita passou de "um único conjunto de campos por consulta"
        // para "lista de receitas", permitindo gerar mais de uma receita por consulta.
        let algumMigradoReceita = false;
        const comReceitasMigradas = comRastreioMigrado.map(p => {
          let mudouPaciente = false;
          const consultasMigradas = (p.consultas || []).map(c => {
            const docs = c.docs || {};
            const temConteudo = (obj) => obj && typeof obj === "object" && Object.keys(obj).length > 0;
            const temCamposAntigosPresentes = "receitaSelecionados" in docs || "receitaItensEditados" in docs || "receitaExtras" in docs || "receitaTitulosEditados" in docs;
            const temFormatoAntigo = temConteudo(docs.receitaSelecionados) || temConteudo(docs.receitaItensEditados) || (docs.receitaExtras && docs.receitaExtras.trim()) || temConteudo(docs.receitaTitulosEditados);
            const jaTemArray = Array.isArray(docs.receitas);
            if (temFormatoAntigo && !jaTemArray) {
              mudouPaciente = true;
              algumMigradoReceita = true;
              const receitaMigrada = {
                id: uid(),
                nome: "Receita 1",
                selecionados: docs.receitaSelecionados || {},
                itensEditados: docs.receitaItensEditados || {},
                extras: docs.receitaExtras || "",
                titulosEditados: docs.receitaTitulosEditados || {},
              };
              const { receitaSelecionados, receitaItensEditados, receitaExtras, receitaTitulosEditados, ...restoDocs } = docs;
              return { ...c, docs: { ...restoDocs, receitas: [receitaMigrada] } };
            }
            if (temCamposAntigosPresentes && !jaTemArray) {
              // Campos antigos existem mas estão vazios (consulta nunca usou a receita) — só limpa.
              mudouPaciente = true;
              const { receitaSelecionados, receitaItensEditados, receitaExtras, receitaTitulosEditados, ...restoDocs } = docs;
              return { ...c, docs: { ...restoDocs, receitas: [] } };
            }
            if (!jaTemArray) {
              return { ...c, docs: { ...docs, receitas: [] } };
            }
            return c;
          });
          if (mudouPaciente) {
            const atualizado = { ...p, consultas: consultasMigradas };
            savePatient(atualizado, ambulatorio).catch(e => console.error("Falha ao migrar receitas para array", e));
            return atualizado;
          }
          return p;
        });

        // Migração genérica: Receita Especial, Exame Simples e Exame Especial também
        // passaram de "um único documento por consulta" para "lista de documentos",
        // permitindo gerar mais de um de cada por consulta.
        function migrarDocUnicoParaLista(docs, campoAntigo, campoNovo, nomeBase, defaults) {
          const valorAntigo = docs[campoAntigo];
          const jaTemArray = Array.isArray(docs[campoNovo]);
          if (jaTemArray) return null;
          const temConteudoReal = valorAntigo && typeof valorAntigo === "object" &&
            Object.entries(valorAntigo).some(([k, v]) => {
              const padrao = defaults[k];
              return v !== undefined && v !== padrao && (typeof v === "string" ? v.trim() !== "" && v !== padrao : true);
            });
          if (temConteudoReal) {
            return [{ id: uid(), nome: `${nomeBase} 1`, ...defaults, ...valorAntigo }];
          }
          return [];
        }
        let algumMigradoDocsUnicos = false;
        const comDocsUnicosMigrados = comReceitasMigradas.map(p => {
          let mudouPaciente = false;
          const consultasMigradas = (p.consultas || []).map(c => {
            const docs = c.docs || {};
            const reEspecialLista = migrarDocUnicoParaLista(docs, "receitaEspecial", "receitasEspeciais", "Receita especial",
              { medicoNome: "", crm: "", crmUf: "PE", crmNum: "", enderecoMedico: "", cidadeMedico: "Recife", ufMedico: "PE", prescricao: "" });
            const exSimplesLista = migrarDocUnicoParaLista(docs, "examesSimples", "examesSimplesLista", "Exame simples",
              { texto: EXAMES_LABORATORIAIS_PADRAO.join("\n") });
            const exEspecialLista = migrarDocUnicoParaLista(docs, "examesEspecial", "examesEspeciais", "Exame especial",
              { registro: "", enf: "", leito: "", setorSolicitante: "GERIATRIA", examesRealizados: "", dadosClinicos: "", hipoteseDiagnostica: "", exameSolicitado: "", carater: "rotina", observacoes: "" });
            if (reEspecialLista === null && exSimplesLista === null && exEspecialLista === null) return c;
            mudouPaciente = true;
            algumMigradoDocsUnicos = true;
            const { receitaEspecial, examesSimples, examesEspecial, ...restoDocs } = docs;
            return {
              ...c,
              docs: {
                ...restoDocs,
                receitasEspeciais: reEspecialLista !== null ? reEspecialLista : (docs.receitasEspeciais || []),
                examesSimplesLista: exSimplesLista !== null ? exSimplesLista : (docs.examesSimplesLista || []),
                examesEspeciais: exEspecialLista !== null ? exEspecialLista : (docs.examesEspeciais || []),
              },
            };
          });
          if (mudouPaciente) {
            const atualizado = { ...p, consultas: consultasMigradas };
            savePatient(atualizado, ambulatorio).catch(e => console.error("Falha ao migrar documentos únicos para lista", e));
            return atualizado;
          }
          return p;
        });

        let algumSaneado = false;
        const sanitizados = comDocsUnicosMigrados.map(p => {
          let mudouPaciente = false;
          const consultasSaneadas = (p.consultas || []).map(c => {
            if (!c.vacinas) return c;
            let mudouConsulta = false;
            const vacinasLimpas = {};
            Object.keys(c.vacinas).forEach(nomeVacina => {
              const campos = c.vacinas[nomeVacina] || {};
              const camposLimpos = {};
              Object.keys(campos).forEach(campo => {
                if (dataPlausivel(campos[campo])) {
                  camposLimpos[campo] = campos[campo];
                } else {
                  mudouConsulta = true;
                }
              });
              vacinasLimpas[nomeVacina] = camposLimpos;
            });
            if (mudouConsulta) { mudouPaciente = true; algumSaneado = true; return { ...c, vacinas: vacinasLimpas }; }
            return c;
          });
          if (mudouPaciente) {
            const atualizado = { ...p, consultas: consultasSaneadas };
            savePatient(atualizado, ambulatorio).catch(e => console.error("Falha ao sanear datas de vacina", e));
            return atualizado;
          }
          return p;
        });

        setPatients(sanitizados);
        if (anyMigrated) {
          sanitizados.forEach(p => { savePatient(p, ambulatorio).catch(e => console.error("Falha ao persistir migração", e)); });
        }
        expurgados.forEach(({ id }) => { apiDeletePatient(id, ambulatorio).catch(e => console.error("Falha ao expurgar paciente antigo", e)); });
      } catch (e) {
        console.error(e);
        setLoadError(e.message);
        setPatients([]);
      }
    })();
  }, [autenticado, ambulatorio]);

  const [lastSaved, setLastSaved] = useState(null);

  const persistPatient = useCallback((patient) => {
    clearTimeout(saveTimers.current[patient.id]);
    setSaveStatus("saving");
    saveTimers.current[patient.id] = setTimeout(async () => {
      try {
        await savePatient(patient, ambulatorio);
        setSaveStatus("saved");
        setLastSaved(new Date());
        setTimeout(() => setSaveStatus("idle"), 1200);
      } catch (e) {
        console.error(e);
        setSaveStatus("error");
      }
    }, 700);
  }, []);

  // Ctrl+S para salvar imediatamente
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (activePatient) persistPatient(activePatient);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePatient, persistPatient]);

  const activePatient = useMemo(() => (patients || []).find(p => p.id === activeId) || null, [patients, activeId]);
  const activeConsulta = useMemo(() => (activePatient?.consultas || []).find(c => c.id === activeConsultaId) || null, [activePatient, activeConsultaId]);

  const updateActivePatient = useCallback((updater) => {
    if (!activeId) return;
    setPatients(prev => {
      const next = prev.map(p => {
        if (p.id !== activeId) return p;
        const updated = { ...updater(p), updatedAt: new Date().toISOString() };
        persistPatient(updated);
        return updated;
      });
      return next;
    });
  }, [activeId, persistPatient]);

  const updateActiveConsulta = useCallback((updater) => {
    if (!activeId || !activeConsultaId) return;
    updateActivePatient(p => ({
      ...p,
      consultas: p.consultas.map(c => c.id === activeConsultaId ? { ...updater(c), updatedAt: new Date().toISOString() } : c)
    }));
  }, [activeId, activeConsultaId, updateActivePatient]);

  function tentarLogin(e) {
    e.preventDefault();
    if (senhaDigitada === '2266') {
      sessionStorage.setItem('auth', '1');
      setAutenticado(true);
      setErroSenha(false);
    } else {
      setErroSenha(true);
      setSenhaDigitada('');
    }
  }

  function selecionarAmbulatorio(amb) {
    sessionStorage.setItem('ambulatorio', amb);
    setAmbulatorio(amb);
    setPatients(null);
    setActiveId(null);
    setView("list");
  }

  if (!autenticado) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-background-secondary)' }}>
        <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: '16px', padding: '40px 36px', width: '100%', maxWidth: '360px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={{ fontWeight: 700, fontSize: '17px', marginBottom: '4px' }}>Prontuário de Geriatria</div>
            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>HSE-PE</div>
          </div>
          <form onSubmit={tentarLogin}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>Senha de acesso</label>
              <input
                type="password"
                value={senhaDigitada}
                onChange={e => { setSenhaDigitada(e.target.value); setErroSenha(false); }}
                placeholder="Digite a senha"
                autoFocus
                style={{ width: '100%', fontSize: '15px' }}
              />
              {erroSenha && (
                <div style={{ fontSize: '13px', color: 'var(--color-text-danger)', marginTop: '6px' }}>
                  Senha incorreta. Tente novamente.
                </div>
              )}
            </div>
            <button type="submit" style={{ width: '100%', padding: '10px', fontSize: '15px', fontWeight: 500 }}>
              Entrar
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Tela de seleção de ambulatório
  if (!ambulatorio) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-background-secondary)' }}>
        <div style={{ width: '100%', maxWidth: '560px', padding: '0 16px' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{ fontWeight: 700, fontSize: '20px', marginBottom: '6px' }}>Prontuário de Geriatria</div>
            <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>HSE-PE — Selecione o ambulatório</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {[
              {
                id: 'cempre',
                titulo: 'CEMPRE',
                subtitulo: 'Centro de Medicina Preventiva',
                descricao: 'Ambulatório de geriatria — consultas ambulatoriais de seguimento',
                icon: 'ti-building-hospital',
                cor: 'var(--color-text-info)',
                bg: 'var(--color-background-info)',
                border: 'var(--color-border-info)',
              },
              {
                id: 'residencia',
                titulo: 'Residência',
                subtitulo: 'Ambulatório de Geriatria',
                descricao: 'Pacientes da residência médica em geriatria — HSE-PE',
                icon: 'ti-school',
                cor: 'var(--color-text-success)',
                bg: 'var(--color-background-success)',
                border: 'var(--color-border-success)',
              },
            ].map(amb => (
              <button
                key={amb.id}
                onClick={() => selecionarAmbulatorio(amb.id)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  padding: '32px 20px', borderRadius: '16px', cursor: 'pointer', textAlign: 'center',
                  background: amb.bg, border: `1.5px solid ${amb.border}`,
                  transition: 'transform 0.1s', gap: '10px',
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
              >
                <i className={`ti ${amb.icon}`} style={{ fontSize: '40px', color: amb.cor }} aria-hidden="true" />
                <div style={{ fontWeight: 700, fontSize: '18px', color: amb.cor }}>{amb.titulo}</div>
                <div style={{ fontSize: '13px', fontWeight: 500, color: amb.cor, opacity: 0.8 }}>{amb.subtitulo}</div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>{amb.descricao}</div>
              </button>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <button
              onClick={() => { sessionStorage.removeItem('auth'); sessionStorage.removeItem('ambulatorio'); setAutenticado(false); setAmbulatorio(null); }}
              style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              Sair
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (patients === null) {
    return (
      <div style={{ padding: "3rem 1rem", textAlign: "center", color: "var(--color-text-secondary)" }}>
        <i className="ti ti-loader-2" style={{ fontSize: "28px", display: "block", marginBottom: "10px" }} aria-hidden="true"></i>
        Carregando pacientes...
      </div>
    );
  }

  async function createPatient() {
    const p = emptyPatient();
    setPatients(prev => [p, ...prev]);
    setActiveId(p.id);
    setActiveConsultaId(p.consultas[0].id);
    setActiveTab("ident");
    setMode("prontuario");
    setView("record");
    try {
      await savePatient(p, ambulatorio);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDeletePatient(id) {
    const now = new Date().toISOString();
    setPatients(prev => prev.map(p => p.id === id ? { ...p, deletedAt: now, updatedAt: now } : p));
    if (activeId === id) { setActiveId(null); setView("list"); }
    const target = (patients || []).find(p => p.id === id);
    if (target) {
      try { await savePatient({ ...target, deletedAt: now, updatedAt: now }, ambulatorio); } catch (e) { console.error(e); }
    }
  }

  async function restorePatient(id) {
    const now = new Date().toISOString();
    setPatients(prev => prev.map(p => p.id === id ? { ...p, deletedAt: null, updatedAt: now } : p));
    const target = (patients || []).find(p => p.id === id);
    if (target) {
      try { await savePatient({ ...target, deletedAt: null, updatedAt: now }, ambulatorio); } catch (e) { console.error(e); }
    }
  }

  async function permanentlyDeletePatient(id) {
    setPatients(prev => prev.filter(p => p.id !== id));
    try {
      await purgePatient(id);
    } catch (e) {
      console.error("Erro ao excluir permanentemente:", e);
    }
  }

  function openPatient(id) {
    setActiveId(id);
    setView("consultas");
  }

  function openConsulta(consultaId, m) {
    setActiveConsultaId(consultaId);
    setMode(m || "prontuario");
    setActiveTab("ident");
    setView("record");
  }

  function baixarReceitasWord(patient) {
    const idade = calcIdade(patient.ident.dn);
    const hoje = new Date().toLocaleDateString('pt-BR');
    const nomePaciente = patient.ident.nome || 'paciente';
    const nomeArquivo = 'RECEITAS - ' + nomePaciente.replace(/[^a-zA-ZÀ-ÿ0-9 ]/g, '').trim() + ' ' + hoje.replace(/\//g, '-') + '.docx';
    const salvarDrive = confirm('Deseja salvar também no Google Drive?\n\nPasta: PRONTUÁRIO CEMPRE - PACIENTES BRUNA / ' + nomePaciente.toUpperCase());

    preencherReceitasDocx({
      nome: nomePaciente,
      prontuario: patient.ident.prontuario || '',
      maeNome: patient.ident.maeNome || '',
      idade: idade != null ? idade : '',
      sexo: patient.ident.sexo || '',
    }).then(async blob => {
      // Download local
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nomeArquivo;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      // Upload Drive se confirmado
      if (salvarDrive) {
        try {
          alert('Enviando para o Drive... Aguarde alguns segundos.');
          const result = await salvarNoDrive(blob, nomePaciente, nomeArquivo);
          if (result.ok) {
            if (confirm('Salvo no Drive!\nPasta: PRONTUÁRIO CEMPRE - PACIENTES BRUNA / ' + nomePaciente.toUpperCase() + '\n\nClicar em OK para abrir o arquivo no Drive?')) {
              window.open(result.link, '_blank');
            }
          } else {
            alert('Erro ao salvar no Drive: ' + result.error);
          }
        } catch(e) {
          alert('Erro ao salvar no Drive: ' + e.message);
        }
      }
    }).catch(e => {
      console.error('Erro ao gerar receitas Word:', e);
      alert('Erro ao gerar o arquivo Word: ' + e.message);
    });
  }

  function baixarReceituarios(patient) {
    const idade = calcIdade(patient.ident.dn);
    const hoje = new Date().toLocaleDateString('pt-BR');
    const nomePaciente = patient.ident.nome || 'paciente';

    preencherExcel({
      nome: nomePaciente,
      prontuario: patient.ident.prontuario || '',
      maeNome: patient.ident.maeNome || '',
      idade: idade != null ? idade : '',
      sexo: patient.ident.sexo || '',
      data: hoje,
    }).then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Receituarios_' + nomePaciente.replace(/[^a-zA-ZÀ-ÿ0-9 ]/g, '').trim() + '_' + hoje.replace(/\//g, '-') + '.xlsm';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }).catch(e => {
      console.error('Erro ao gerar Excel:', e);
      alert('Erro ao gerar o arquivo: ' + e.message);
    });
  }

  function createConsulta() {
    if (!activePatient) return;
    const ativas = activePatient.consultas.filter(c => !c.deletedAt);
    const sorted = [...ativas].sort((a, b) => new Date(b.data) - new Date(a.data));
    const ultima = sorted[0];
    const nova = emptyConsulta(ultima);
    updateActivePatient(p => ({ ...p, consultas: [...p.consultas, nova] }));
    openConsulta(nova.id, "prontuario");
  }

  function removeConsulta(consultaId) {
    const now = new Date().toISOString();
    updateActivePatient(p => ({ ...p, consultas: p.consultas.map(c => c.id === consultaId ? { ...c, deletedAt: now, updatedAt: now } : c) }));
  }

  function restoreConsulta(consultaId) {
    const now = new Date().toISOString();
    updateActivePatient(p => ({ ...p, consultas: p.consultas.map(c => c.id === consultaId ? { ...c, deletedAt: null, updatedAt: now } : c) }));
  }

  function restoreConsultaById(patientId, consultaId) {
    const now = new Date().toISOString();
    setPatients(prev => prev.map(p => p.id === patientId ? { ...p, consultas: p.consultas.map(c => c.id === consultaId ? { ...c, deletedAt: null, updatedAt: now } : c) } : p));
    const target = (patients || []).find(p => p.id === patientId);
    if (target) {
      const updated = { ...target, consultas: target.consultas.map(c => c.id === consultaId ? { ...c, deletedAt: null, updatedAt: now } : c) };
      savePatient(updated, ambulatorio).catch(e => console.error(e));
    }
  }

  function permanentlyDeleteConsulta(patientId, consultaId) {
    setPatients(prev => prev.map(p => p.id === patientId ? { ...p, consultas: p.consultas.filter(c => c.id !== consultaId) } : p));
    const target = (patients || []).find(p => p.id === patientId);
    if (target) {
      const updated = { ...target, consultas: target.consultas.filter(c => c.id !== consultaId) };
      savePatient(updated, ambulatorio).catch(e => console.error(e));
    }
  }

  const filteredPatients = (patients || []).filter(p => !p.deletedAt).filter(p => {
    const q = search.toLowerCase();
    return !q || (p.ident.nome || "").toLowerCase().includes(q) || (p.ident.prontuario || "").toLowerCase().includes(q);
  });

  const trashedPatients = (patients || []).filter(p => p.deletedAt);
  const trashedConsultasCount = (patients || []).reduce((acc, p) => acc + (p.consultas || []).filter(c => c.deletedAt).length, 0);

  return (
    <>
    <div id="app-main-content" style={{ width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem", flexWrap: "wrap", gap: "8px" }}>
        <div>
          <h1 style={{ margin: 0 }}>{ambulatorio === 'cempre' ? 'AMBULATÓRIO DE GERIATRIA — CEMPRE' : 'AMBULATÓRIO DE GERIATRIA — HSE'}</h1>
          <p style={{ margin: "2px 0 0", fontSize: "13px", color: "var(--color-text-secondary)" }}>HSE-PE · dados salvos no Google Sheets</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {saveStatus === "saving" && <Pill color="info"><i className="ti ti-loader-2" aria-hidden="true"></i>Salvando...</Pill>}
          {saveStatus === "saved" && <Pill color="success"><i className="ti ti-check" aria-hidden="true"></i>Salvo</Pill>}
          {saveStatus === "idle" && lastSaved && <span style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>Salvo às {lastSaved.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>}
          {saveStatus === "error" && <Pill color="danger"><i className="ti ti-alert-triangle" aria-hidden="true"></i>Erro ao salvar</Pill>}
          <button onClick={() => { sessionStorage.removeItem('ambulatorio'); setAmbulatorio(null); setPatients(null); setActiveId(null); setView("list"); }} style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}>
            <i className="ti ti-switch-horizontal" aria-hidden="true"></i>Trocar
          </button>
          {view === "list" && (trashedPatients.length > 0 || trashedConsultasCount > 0) && (
            <button onClick={() => setView("trash")} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <i className="ti ti-trash" aria-hidden="true"></i>Lixeira
              <span style={{ fontSize: "11px", background: "var(--color-background-secondary)", borderRadius: "999px", padding: "1px 7px" }}>{trashedPatients.length + trashedConsultasCount}</span>
            </button>
          )}
          {view === "trash" && <button onClick={() => setView("list")}><i className="ti ti-arrow-left" aria-hidden="true" style={{marginRight:"4px"}}></i>Lista de pacientes</button>}
          {view === "consultas" && <button onClick={() => setView("list")}><i className="ti ti-arrow-left" aria-hidden="true" style={{marginRight:"4px"}}></i>Lista de pacientes</button>}
          {view === "record" && <button onClick={() => setView("consultas")}><i className="ti ti-arrow-left" aria-hidden="true" style={{marginRight:"4px"}}></i>Consultas do paciente</button>}
        </div>
      </div>

      {loadError && (
        <Alert type="danger">
          Não foi possível carregar os pacientes ({loadError}). Verifique se a URL da API em src/config.js está correta e se o Apps Script está implantado como "Qualquer pessoa pode acessar".
        </Alert>
      )}

      {view === "list" && (
        <PatientList
          patients={filteredPatients}
          allPatients={patients}
          search={search}
          setSearch={setSearch}
          onOpen={openPatient}
          onCreate={createPatient}
          onDelete={handleDeletePatient}
        />
      )}

      {view === "trash" && (
        <TrashView
          trashedPatients={trashedPatients}
          patients={patients}
          onRestorePatient={restorePatient}
          onPermanentlyDeletePatient={permanentlyDeletePatient}
          onRestoreConsulta={restoreConsultaById}
          onPermanentlyDeleteConsulta={permanentlyDeleteConsulta}
        />
      )}

      {view === "consultas" && activePatient && (
        <ConsultasView
          patient={activePatient}
          onOpenConsulta={openConsulta}
          onCreateConsulta={createConsulta}
          onRemoveConsulta={removeConsulta}
          updatePatient={updateActivePatient}
        />
      )}

      {view === "record" && activePatient && activeConsulta && (
        <div>
          <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={() => setMode("prontuario")} style={{
              padding: "8px 16px", borderRadius: "8px", fontSize: "14px",
              border: mode === "prontuario" ? "0.5px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
              background: mode === "prontuario" ? "var(--color-background-info)" : "transparent",
              color: mode === "prontuario" ? "var(--color-text-info)" : "var(--color-text-primary)",
              display: "flex", alignItems: "center", gap: "6px"
            }}>
              <i className="ti ti-clipboard-text" aria-hidden="true"></i>Prontuário completo
            </button>
            <button
              onClick={() => baixarReceitasWord(activePatient)}
              style={{
                padding: "8px 16px", borderRadius: "8px", fontSize: "14px",
                border: "0.5px solid var(--color-border-tertiary)",
                background: "transparent",
                color: "var(--color-text-primary)",
                display: "flex", alignItems: "center", gap: "6px"
              }}
            >
              <i className="ti ti-file-word" aria-hidden="true"></i>Receitas (Word)
            </button>
            <button
              onClick={() => baixarReceituarios(activePatient)}
              style={{
                padding: "8px 16px", borderRadius: "8px", fontSize: "14px",
                border: "0.5px solid var(--color-border-tertiary)",
                background: "transparent",
                color: "var(--color-text-primary)",
                display: "flex", alignItems: "center", gap: "6px"
              }}
            >
              <i className="ti ti-file-spreadsheet" aria-hidden="true"></i>Receituários (Excel)
            </button>
          </div>
          <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "10px" }}>
            {activePatient.ident.nome || "Paciente sem nome"}
            {activePatient.ident.prontuario && <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400 }}> · prontuário {activePatient.ident.prontuario}</span>}
            <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400 }}> · consulta de {fmtDate(activeConsulta.data)}</span>
          </div>

          {mode === "prontuario" && (
            <RecordView patient={activePatient} updatePatient={updateActivePatient} consulta={activeConsulta} updateConsulta={updateActiveConsulta} activeTab={activeTab} setActiveTab={setActiveTab} onPrint={setPrintDoc} onSave={() => activePatient && persistPatient(activePatient)} />
          )}
        </div>
      )}
    </div>

      {printDoc && <PrintDocRenderer doc={printDoc} patient={activePatient} consulta={activeConsulta} onClose={() => setPrintDoc(null)} />}
    </>
  );
}

function ConsultasView({ patient, onOpenConsulta, onCreateConsulta, onRemoveConsulta, updatePatient }) {
  const consultas = [...(patient.consultas || [])].filter(c => !c.deletedAt).sort((a, b) => new Date(b.data) - new Date(a.data));
  return (
    <div>
      <div style={{ fontSize: "15px", fontWeight: 500, marginBottom: "4px" }}>{patient.ident.nome || "Paciente sem nome"}</div>
      <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginBottom: "16px" }}>
        {patient.ident.prontuario ? `Prontuário ${patient.ident.prontuario}` : "Sem prontuário"}
        {calcIdade(patient.ident.dn) != null && ` · ${calcIdade(patient.ident.dn)} anos`}
      </div>
      <button onClick={onCreateConsulta} style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "14px" }}>
        <i className="ti ti-plus" aria-hidden="true"></i>Nova consulta
      </button>
      <GraficoEvolucao patient={patient} />
      <div style={{ display: "grid", gap: "8px" }}>
        {consultas.map(c => {
          const numProblemas = Object.values(c.problemas || {}).filter(Boolean).length + (c.problemasCustom || []).filter(x => x.checked).length;
          const numPendencias = (c.pendencias || []).filter(x => !x.done).length;
          return (
            <div key={c.id} style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "12px", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--color-background-primary)" }}>
              <div onClick={() => onOpenConsulta(c.id, "prontuario")} style={{ cursor: "pointer", flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: "15px" }}>Consulta de {fmtDate(c.data)}</div>
                <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginTop: "2px" }}>
                  {numProblemas > 0 && `${numProblemas} comorbidade(s)`}
                  {numPendencias > 0 && ` · ${numPendencias} pendência(s)`}
                  {numProblemas === 0 && numPendencias === 0 && "Sem dados preenchidos ainda"}
                </div>
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <button onClick={() => onOpenConsulta(c.id, "prontuario")} aria-label="Abrir consulta"><i className="ti ti-clipboard-text" aria-hidden="true"></i></button>
                <button onClick={() => onOpenConsulta(c.id, "prontuario")} aria-label="Abrir consulta"><i className="ti ti-edit" aria-hidden="true"></i></button>
                <button onClick={() => { if (confirm("Mover esta consulta para a lixeira? Você poderá restaurá-la em até 30 dias.")) onRemoveConsulta(c.id); }} aria-label="Excluir"><i className="ti ti-trash" aria-hidden="true"></i></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function diasRestantes(deletedAt) {
  const TRINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;
  const decorrido = Date.now() - new Date(deletedAt).getTime();
  const restante = TRINTA_DIAS_MS - decorrido;
  return Math.max(0, Math.ceil(restante / (24 * 60 * 60 * 1000)));
}

function TrashView({ trashedPatients, patients, onRestorePatient, onPermanentlyDeletePatient, onRestoreConsulta, onPermanentlyDeleteConsulta }) {
  const patientesComConsultasNaLixeira = (patients || [])
    .filter(p => !p.deletedAt)
    .map(p => ({ patient: p, consultasLixeira: (p.consultas || []).filter(c => c.deletedAt) }))
    .filter(x => x.consultasLixeira.length > 0);

  const vazio = trashedPatients.length === 0 && patientesComConsultasNaLixeira.length === 0;

  return (
    <div>
      <Alert type="info">Itens excluídos ficam aqui por 30 dias antes de serem removidos definitivamente. Você pode restaurá-los a qualquer momento dentro desse prazo.</Alert>

      {vazio && (
        <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--color-text-secondary)" }}>
          <i className="ti ti-trash" style={{ fontSize: "32px", display: "block", marginBottom: "8px" }} aria-hidden="true"></i>
          A lixeira está vazia.
        </div>
      )}

      {trashedPatients.length > 0 && (
        <SectionCard title="Pacientes excluídos" icon="ti-user-off">
          <div style={{ display: "grid", gap: "8px" }}>
            {trashedPatients.map(p => {
              const dias = diasRestantes(p.deletedAt);
              return (
                <div key={p.id} style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "12px", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--color-background-primary)" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: "15px" }}>{p.ident.nome || "Paciente sem nome"}</div>
                    <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginTop: "2px" }}>
                      {p.ident.prontuario ? `Prontuário ${p.ident.prontuario}` : "Sem prontuário"} · {(p.consultas || []).length} consulta(s)
                      {" · "}
                      <span style={{ color: dias <= 5 ? "var(--color-text-danger)" : "inherit" }}>
                        {dias > 0 ? `exclusão definitiva em ${dias} dia(s)` : "será removido em breve"}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button onClick={() => onRestorePatient(p.id)} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <i className="ti ti-rotate" aria-hidden="true"></i>Restaurar
                    </button>
                    <button onClick={() => { if (confirm("Excluir definitivamente este paciente? Essa ação não pode ser desfeita.")) onPermanentlyDeletePatient(p.id); }} aria-label="Excluir definitivamente">
                      <i className="ti ti-trash-x" aria-hidden="true"></i>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {patientesComConsultasNaLixeira.length > 0 && (
        <SectionCard title="Consultas excluídas" icon="ti-calendar-off">
          <div style={{ display: "grid", gap: "8px" }}>
            {patientesComConsultasNaLixeira.map(({ patient, consultasLixeira }) => (
              <div key={patient.id}>
                <div style={{ fontWeight: 500, fontSize: "14px", marginBottom: "6px" }}>{patient.ident.nome || "Paciente sem nome"}</div>
                {consultasLixeira.map(c => {
                  const dias = diasRestantes(c.deletedAt);
                  return (
                    <div key={c.id} style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "12px", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--color-background-primary)", marginBottom: "8px" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: "14px" }}>Consulta de {fmtDate(c.data)}</div>
                        <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginTop: "2px" }}>
                          <span style={{ color: dias <= 5 ? "var(--color-text-danger)" : "inherit" }}>
                            {dias > 0 ? `exclusão definitiva em ${dias} dia(s)` : "será removida em breve"}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button onClick={() => onRestoreConsulta(patient.id, c.id)} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <i className="ti ti-rotate" aria-hidden="true"></i>Restaurar
                        </button>
                        <button onClick={() => { if (confirm("Excluir definitivamente esta consulta? Essa ação não pode ser desfeita.")) onPermanentlyDeleteConsulta(patient.id, c.id); }} aria-label="Excluir definitivamente">
                          <i className="ti ti-trash-x" aria-hidden="true"></i>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

function PatientList({ patients, allPatients, search, setSearch, onCreate, onOpen, onDelete }) {
  const [filtroComorbidade, setFiltroComorbidade] = useState("");
  const [filtroFragilidade, setFiltroFragilidade] = useState("");
  const [showDashboard, setShowDashboard] = useState(false);

  const filtrados = patients.filter(p => {
    if (filtroComorbidade) {
      const consultas = (p.consultas || []).filter(c => !c.deletedAt).sort((a, b) => new Date(b.data) - new Date(a.data));
      const ult = consultas[0] || {};
      const temComorbidade = (ult.problemas || {})[filtroComorbidade] ||
        (ult.problemasCustom || []).some(c => c.checked && c.nome.toLowerCase().includes(filtroComorbidade.toLowerCase()));
      if (!temComorbidade) return false;
    }
    if (filtroFragilidade) {
      const consultas = (p.consultas || []).filter(c => !c.deletedAt).sort((a, b) => new Date(b.data) - new Date(a.data));
      const ult = consultas[0] || {};
      const frail = Object.values((ult.aga || {}).frail || {}).filter(Boolean).length;
      if (filtroFragilidade === "robusto" && frail !== 0) return false;
      if (filtroFragilidade === "prefragil" && (frail < 1 || frail > 2)) return false;
      if (filtroFragilidade === "fragil" && frail < 3) return false;
    }
    return true;
  });

  return (
    <div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
        <input type="text" placeholder="Buscar por nome ou prontuário..." value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, minWidth: "200px" }} />
        <button onClick={onCreate} style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}>
          <i className="ti ti-plus" aria-hidden="true"></i>Novo paciente
        </button>
        <button onClick={() => setShowDashboard(!showDashboard)} style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}>
          <i className="ti ti-chart-bar" aria-hidden="true"></i>Dashboard
        </button>
      </div>

      <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap", alignItems: "center" }}>
        <select value={filtroComorbidade} onChange={e => setFiltroComorbidade(e.target.value)} style={{ fontSize: "13px" }}>
          <option value="">Filtrar por comorbidade...</option>
          {PROBLEMAS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filtroFragilidade} onChange={e => setFiltroFragilidade(e.target.value)} style={{ fontSize: "13px" }}>
          <option value="">Filtrar por fragilidade...</option>
          <option value="robusto">Robusto</option>
          <option value="prefragil">Pré-frágil</option>
          <option value="fragil">Frágil</option>
        </select>
        {(filtroComorbidade || filtroFragilidade) && (
          <button onClick={() => { setFiltroComorbidade(""); setFiltroFragilidade(""); }} style={{ fontSize: "12px", padding: "4px 8px" }}>
            <i className="ti ti-x" aria-hidden="true"></i> Limpar filtros
          </button>
        )}
        {(filtroComorbidade || filtroFragilidade) && (
          <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>{filtrados.length} de {patients.length} paciente(s)</span>
        )}
      </div>

      {showDashboard && (
        <div style={{ marginBottom: "20px" }}>
          <Dashboard patients={allPatients} />
        </div>
      )}

      {filtrados.length === 0 && (
        <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--color-text-secondary)" }}>
          <i className="ti ti-users" style={{ fontSize: "32px", display: "block", marginBottom: "8px" }} aria-hidden="true"></i>
          {patients.length === 0 ? "Nenhum paciente cadastrado ainda." : "Nenhum paciente encontrado com esses filtros."}
        </div>
      )}

      <div style={{ display: "grid", gap: "8px" }}>
        {filtrados.map(p => {
          const idade = calcIdade(p.ident.dn);
          const numConsultas = (p.consultas || []).filter(c => !c.deletedAt).length;
          const ult = [...(p.consultas || [])].filter(c => !c.deletedAt).sort((a, b) => new Date(b.data) - new Date(a.data))[0];
          const frail = ult ? Object.values((ult.aga || {}).frail || {}).filter(Boolean).length : null;
          const frailLabel = frail === null ? null : frail === 0 ? null : frail <= 2 ? "Pré-frágil" : "Frágil";
          const frailCor = frail >= 3 ? "danger" : "warning";
          return (
            <div key={p.id} onClick={() => onOpen(p.id)} style={{ cursor: "pointer", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "12px", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--color-background-primary)" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: "15px", display: "flex", alignItems: "center", gap: "8px" }}>
                  {p.ident.nome || "Paciente sem nome"}
                  {frailLabel && <Pill color={frailCor}>{frailLabel}</Pill>}
                </div>
                <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginTop: "2px" }}>
                  {p.ident.prontuario ? `Prontuário ${p.ident.prontuario}` : "Sem prontuário"}
                  {idade != null && ` · ${idade} anos`}
                  {` · ${numConsultas} consulta(s)`}
                  {ult && ` · Última: ${fmtDate(ult.data)}`}
                </div>
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <button onClick={(e) => { e.stopPropagation(); if (confirm("Mover este paciente para a lixeira? Você poderá restaurá-lo em até 30 dias.")) onDelete(p.id); }} aria-label="Excluir"><i className="ti ti-trash" aria-hidden="true"></i></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecordView({ patient, updatePatient, consulta, updateConsulta, activeTab, setActiveTab, onPrint, onSave }) {
  return (
    <div>
      <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "8px", marginBottom: "14px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            whiteSpace: "nowrap", fontSize: "13px", padding: "6px 12px",
            border: activeTab === t.id ? "0.5px solid var(--color-border-info)" : "0.5px solid transparent",
            background: activeTab === t.id ? "var(--color-background-info)" : "transparent",
            color: activeTab === t.id ? "var(--color-text-info)" : "var(--color-text-secondary)",
            borderRadius: "8px", display: "flex", alignItems: "center", gap: "5px"
          }}>
            <i className={"ti " + t.icon} aria-hidden="true" style={{ fontSize: "14px" }}></i>{t.label}
          </button>
        ))}
      </div>

      {activeTab === "ident" && <IdentTab patient={patient} updatePatient={updatePatient} />}
      {activeTab === "problemas" && <ProblemasTab consulta={consulta} updateConsulta={updateConsulta} />}
      {activeTab === "antecedentes" && <AntecedentesTab consulta={consulta} updateConsulta={updateConsulta} />}
      {activeTab === "medicacoes" && <MedicacoesTab consulta={consulta} updateConsulta={updateConsulta} />}
      {activeTab === "queixas" && <QueixasTab consulta={consulta} updateConsulta={updateConsulta} />}
      {activeTab === "aga" && <AgaTab consulta={consulta} updateConsulta={updateConsulta} sexoPaciente={patient.ident.sexo || ""} />}
      {activeTab === "prevencao" && <PrevencaoTab patient={patient} consulta={consulta} updateConsulta={updateConsulta} />}
      {activeTab === "exame" && <ExameTab consulta={consulta} updateConsulta={updateConsulta} patient={patient} todasConsultas={patient?.consultas || []} />}
      {activeTab === "exames" && <ExamesTab consulta={consulta} updateConsulta={updateConsulta} patient={patient} />}
      {activeTab === "plano" && <PlanoTab consulta={consulta} updateConsulta={updateConsulta} patient={patient} />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "20px", paddingTop: "16px", borderTop: "0.5px solid var(--color-border-tertiary)", flexWrap: "wrap", gap: "8px" }}>
        <button onClick={onSave} style={{ display: "flex", alignItems: "center", gap: "6px", background: "var(--color-background-success)", color: "var(--color-text-success)", border: "0.5px solid var(--color-border-success)" }}>
          <i className="ti ti-device-floppy" aria-hidden="true"></i>Salvar agora
        </button>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={() => onPrint({ type: "sugestoesIA" })} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", background: "var(--color-background-info)", color: "var(--color-text-info)", border: "0.5px solid var(--color-border-info)" }}>
            <i className="ti ti-sparkles" aria-hidden="true"></i>Sugestões de conduta (IA)
          </button>

          <button onClick={() => onPrint({ type: "consultaCompleta" })} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <i className="ti ti-printer" aria-hidden="true"></i>Imprimir consulta completa
          </button>
        </div>
      </div>
    </div>
  );
}

function IdentTab({ patient, updatePatient }) {
  const i = patient.ident;
  const set = (k, v) => updatePatient(p => ({ ...p, ident: { ...p.ident, [k]: v } }));
  const idade = calcIdade(i.dn);
  return (
    <SectionCard title="Identificação do paciente" icon="ti-id">
      <Row>
        <Field label="Prontuário"><input value={i.prontuario || ""} onChange={e => set("prontuario", e.target.value)} /></Field>
        <Field label="Nome completo"><input value={i.nome || ""} onChange={e => set("nome", e.target.value)} /></Field>
        <Field label="CPF"><input value={i.cpf || ""} onChange={e => set("cpf", e.target.value)} placeholder="000.000.000-00" /></Field>
        <Field label="Sexo">
          <select value={i.sexo || ""} onChange={e => set("sexo", e.target.value)}>
            <option value="">Selecione</option>
            <option value="M">Masculino</option>
            <option value="F">Feminino</option>
          </select>
        </Field>
        <Field label="Data de nascimento" hint={idade != null ? `Idade calculada: ${idade} anos` : null}>
          <input type="date" value={i.dn || ""} onChange={e => set("dn", e.target.value)} />
        </Field>
        <Field label="Nome da mãe"><input value={i.maeNome || ""} onChange={e => set("maeNome", e.target.value)} /></Field>
        <Field label="Naturalidade"><input value={i.natural || ""} onChange={e => set("natural", e.target.value)} /></Field>
        <Field label="Procedência"><input value={i.procedente || ""} onChange={e => set("procedente", e.target.value)} /></Field>
        <Field label="Profissão"><input value={i.profissao || ""} onChange={e => set("profissao", e.target.value)} /></Field>
        <Field label="Escolaridade"><input value={i.escolaridade || ""} onChange={e => set("escolaridade", e.target.value)} /></Field>
        <Field label="Estado civil">
          <select value={i.estadoCivil || ""} onChange={e => set("estadoCivil", e.target.value)}>
            <option value="">Selecione</option>
            <option>Solteiro(a)</option><option>Casado(a)</option><option>Divorciado(a)</option><option>Viúvo(a)</option><option>União estável</option>
          </select>
        </Field>
        <Field label="Religião"><input value={i.religiao || ""} onChange={e => set("religiao", e.target.value)} /></Field>
        <Field label="Acompanhante"><input value={i.acompanhante || ""} onChange={e => set("acompanhante", e.target.value)} /></Field>
        <Field label="Cuidador principal"><input value={i.cuidador || ""} onChange={e => set("cuidador", e.target.value)} /></Field>
        <Field label="Mora com"><input value={i.moraCom || ""} onChange={e => set("moraCom", e.target.value)} /></Field>
        <Field label="Pode contar com"><input value={i.podeContarCom || ""} onChange={e => set("podeContarCom", e.target.value)} placeholder="ex: filha, vizinha, cuidador contratado..." /></Field>
        <Field label="Telefone"><input value={i.telefone || ""} onChange={e => set("telefone", e.target.value)} /></Field>
      </Row>
    </SectionCard>
  );
}

function ComorbidadeItem({ nome, checked, onToggle, nota, onNotaChange, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(nota || "");
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  function startEditing(e) {
    e.preventDefault();
    e.stopPropagation();
    setDraft(nota || "");
    setEditing(true);
  }

  function commit() {
    onNotaChange(draft);
    setEditing(false);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 0" }}>
      <input type="checkbox" checked={!!checked} onChange={onToggle} style={{ width: "16px", height: "16px", flexShrink: 0 }} />
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          placeholder={`${nome} - detalhes (ex: diagnóstico há 3 anos)`}
          style={{ fontSize: "14px", flex: 1 }}
        />
      ) : (
        <span onClick={startEditing} style={{ fontSize: "14px", cursor: "pointer", flex: 1, borderBottom: "1px dashed var(--color-border-secondary)" }} title="Clique para editar">
          {nome}{nota ? ` - ${nota}` : ""}
        </span>
      )}
      {onRemove && (
        <button onClick={onRemove} aria-label="Remover" style={{ flexShrink: 0, padding: "2px 6px" }}><i className="ti ti-x" aria-hidden="true" style={{ fontSize: "13px" }}></i></button>
      )}
    </div>
  );
}

function ProblemasTab({ consulta, updateConsulta }) {
  const problemas = consulta.problemas || {};
  const notas = consulta.problemasNotas || {};
  const custom = consulta.problemasCustom || [];
  const [novoNome, setNovoNome] = useState("");

  const toggle = (nome) => updateConsulta(p => ({ ...p, problemas: { ...p.problemas, [nome]: !p.problemas[nome] } }));
  const setNota = (nome, valor) => updateConsulta(p => ({ ...p, problemasNotas: { ...p.problemasNotas, [nome]: valor } }));

  const toggleCustom = (id) => updateConsulta(p => ({ ...p, problemasCustom: (p.problemasCustom || []).map(c => c.id === id ? { ...c, checked: !c.checked } : c) }));
  const setNotaCustom = (id, valor) => updateConsulta(p => ({ ...p, problemasCustom: (p.problemasCustom || []).map(c => c.id === id ? { ...c, nota: valor } : c) }));
  const removeCustom = (id) => updateConsulta(p => ({ ...p, problemasCustom: (p.problemasCustom || []).filter(c => c.id !== id) }));
  const addCustom = () => {
    if (!novoNome.trim()) return;
    updateConsulta(p => ({ ...p, problemasCustom: [...(p.problemasCustom || []), { id: uid(), nome: novoNome.trim(), checked: true, nota: "" }] }));
    setNovoNome("");
  };

  const ativos = PROBLEMAS.filter(p => problemas[p]);
  const comPrevencao = ativos.filter(p => PREVENCAO_ESPECIFICA[p]);

  return (
    <div>
      <SectionCard title="Lista de problemas" icon="ti-list-check">
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginTop: 0 }}>Marque as comorbidades ativas. Clique no nome de uma comorbidade marcada para adicionar detalhes (ex: "HAS - diagnóstico há 3 anos"). Os itens de prevenção específica correspondentes aparecem automaticamente na aba "Prevenção".</p>
        <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
          <input
            value={novoNome}
            onChange={e => setNovoNome(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addCustom()}
            placeholder="Adicionar comorbidade que não está na lista..."
            style={{ flex: 1 }}
          />
          <button onClick={addCustom}><i className="ti ti-plus" aria-hidden="true"></i></button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "2px" }}>
          {PROBLEMAS.map(nome => (
            <ComorbidadeItem
              key={nome}
              nome={nome}
              checked={problemas[nome]}
              onToggle={() => toggle(nome)}
              nota={notas[nome]}
              onNotaChange={(v) => setNota(nome, v)}
            />
          ))}
          {custom.map(c => (
            <ComorbidadeItem
              key={c.id}
              nome={c.nome}
              checked={c.checked}
              onToggle={() => toggleCustom(c.id)}
              nota={c.nota}
              onNotaChange={(v) => setNotaCustom(c.id, v)}
              onRemove={() => removeCustom(c.id)}
            />
          ))}
        </div>
      </SectionCard>

      {comPrevencao.length > 0 && (
        <Alert type="info">
          <strong style={{ fontWeight: 500 }}>{comPrevencao.length}</strong> comorbidade(s) ativa(s) possuem itens de rastreio específico habilitados na aba Prevenção: {comPrevencao.join(", ")}.
        </Alert>
      )}

      {/* ÍNDICE DE CHARLSON */}
      {(() => {
        const prob = consulta.problemas || {};
        const custom = (consulta.problemasCustom || []).filter(c => c.checked).map(c => c.nome.toLowerCase());
        const has = (k) => prob[k] || custom.some(c => c.includes(k.toLowerCase()));
        const idade = calcIdade(patient?.ident?.dn);

        const charlsonItens = [
          { nome: "IAM prévio", pts: 1, cond: prob["DAC"] },
          { nome: "Insuficiência cardíaca", pts: 1, cond: prob["Insuficiência cardíaca"] || prob["IC"] },
          { nome: "DAOP / Doença vascular periférica", pts: 1, cond: prob["DAOP"] },
          { nome: "AVC / AIT", pts: 1, cond: prob["AVC"] || prob["AIT"] },
          { nome: "Demência", pts: 1, cond: prob["Demência"] || prob["Doença de Alzheimer"] || prob["Síndrome demencial"] },
          { nome: "DPOC", pts: 1, cond: prob["DPOC"] },
          { nome: "Doença do tecido conjuntivo", pts: 1, cond: prob["Artrite reumatoide"] || prob["LES"] || prob["Esclerodermia"] },
          { nome: "Úlcera péptica", pts: 1, cond: has("úlcera") },
          { nome: "DRC leve (Cr 1,5–3,0)", pts: 1, cond: prob["DRC"] },
          { nome: "Diabetes sem complicações", pts: 1, cond: prob["DM2"] || prob["DM1"] },
          { nome: "Hemiplegia", pts: 2, cond: has("hemiplegia") },
          { nome: "DRC moderada/grave (Cr >3,0 ou diálise)", pts: 2, cond: has("diálise") || has("hemodiálise") },
          { nome: "Diabetes com complicações (neuropatia, nefropatia, retinopatia)", pts: 2, cond: has("nefropatia diabética") || has("retinopatia") || has("neuropatia diabética") },
          { nome: "Neoplasia maligna sem metástase", pts: 2, cond: has("neoplasia") || has("câncer") || has("ca ") || has("ca de") },
          { nome: "Leucemia", pts: 2, cond: has("leucemia") },
          { nome: "Linfoma", pts: 2, cond: has("linfoma") },
          { nome: "Hepatopatia moderada/grave (cirrose, HTP)", pts: 3, cond: has("cirrose") || has("hepatopatia") },
          { nome: "Neoplasia maligna com metástase", pts: 6, cond: has("metástase") || has("metastatico") },
          { nome: "AIDS", pts: 6, cond: has("aids") || has("hiv") },
        ];

        const pontosDoencas = charlsonItens.filter(it => it.cond).reduce((s, it) => s + it.pts, 0);
        const pontosIdade = idade ? (idade < 50 ? 0 : idade < 60 ? 1 : idade < 70 ? 2 : idade < 80 ? 3 : 4) : 0;
        const charlsonTotal = pontosDoencas + pontosIdade;
        const mortalidade10a = charlsonTotal === 0 ? 3.3 : charlsonTotal === 1 ? 12 : charlsonTotal === 2 ? 26 : charlsonTotal >= 3 && charlsonTotal <= 4 ? 52 : 85;

        if (charlsonTotal === 0 && pontosDoencas === 0) return null;
        return (
          <div style={{ marginTop: "12px", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "8px", padding: "12px" }}>
            <div style={{ fontWeight: 600, fontSize: "13px", marginBottom: "8px" }}>
              📊 Índice de Charlson — {charlsonTotal} pontos
              <span style={{ fontWeight: 400, fontSize: "12px", color: "var(--color-text-secondary)", marginLeft: "8px" }}>
                (doenças: {pontosDoencas} + idade: {pontosIdade})
              </span>
            </div>
            <div style={{ fontSize: "13px", marginBottom: "6px" }}>
              Mortalidade estimada em 10 anos: <strong>{mortalidade10a}%</strong>
            </div>
            <div style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
              Comorbidades contadas: {charlsonItens.filter(it => it.cond).map(it => `${it.nome} (${it.pts}pt)`).join(", ") || "nenhuma"}
            </div>
          </div>
        );
      })()}

      {/* CHADS2-VASc e HAS-BLED */}
      {(consulta.problemas?.["FA"] || consulta.problemas?.["Flutter atrial"]) && (() => {
        const prob = consulta.problemas || {};
        const idade = calcIdade(patient?.ident?.dn);
        const sexo = patient?.ident?.sexo || "";
        const custom = (consulta.problemasCustom || []).filter(c => c.checked).map(c => c.nome.toLowerCase());

        // CHA2DS2-VASc (2020 ESC)
        const chadsItens = [
          { label: "IC ou FEVE <40%", pts: 1, val: prob["Insuficiência cardíaca"] || prob["IC"] },
          { label: "HAS", pts: 1, val: prob["HAS"] },
          { label: "Idade ≥ 75 anos", pts: 2, val: idade >= 75 },
          { label: "DM", pts: 1, val: prob["DM2"] || prob["DM1"] },
          { label: "AVC/AIT/TE prévio", pts: 2, val: prob["AVC"] || prob["AIT"] },
          { label: "DAP / DAC / placa aórtica", pts: 1, val: prob["DAC"] || prob["DAOP"] },
          { label: "Idade 65–74 anos", pts: 1, val: idade >= 65 && idade < 75 },
          { label: "Sexo feminino", pts: 1, val: sexo === "F" },
        ];
        const chadsTotal = chadsItens.filter(it => it.val).reduce((s, it) => s + it.pts, 0);
        // Pontuação máxima ajustada (sexo F não conta sozinho)
        const chadsEfetivo = sexo === "F" ? Math.max(0, chadsTotal - 1) : chadsTotal;
        const anticoagular = (sexo === "M" && chadsEfetivo >= 1) || (sexo === "F" && chadsEfetivo >= 2);

        // HAS-BLED
        const ef = consulta.exameFisico || {};
        const mPA = (ef.paSentado || "").match(/(\d+)/);
        const PAS = mPA ? parseInt(mPA[1]) : null;
        const labs = consulta.labsTexto || "";
        const meds = (consulta.medicacoesTexto || "").toLowerCase();
        const hasBledItens = [
          { label: "HAS não controlada (PA sistólica >160)", pts: 1, val: PAS && PAS > 160 },
          { label: "Disfunção renal ou hepática", pts: 1, val: prob["DRC"] || custom.some(c => c.includes("hepatopatia") || c.includes("cirrose")) },
          { label: "AVC prévio", pts: 1, val: prob["AVC"] },
          { label: "Sangramento prévio ou predisposição", pts: 1, val: custom.some(c => c.includes("sangramento") || c.includes("hemorragia")) },
          { label: "INR lábil (se em uso de varfarina)", pts: 1, val: meds.includes("varfarina") || meds.includes("warfarina") },
          { label: "Idade > 65 anos", pts: 1, val: idade > 65 },
          { label: "Drogas (AINE, antiplaquetário) ou álcool", pts: 1, val: meds.includes("ibuprofeno") || meds.includes("diclofenaco") || meds.includes("aas") || meds.includes("clopidogrel") },
        ];
        const hasBledTotal = hasBledItens.filter(it => it.val).reduce((s, it) => s + it.pts, 0);

        return (
          <div style={{ marginTop: "12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "8px", padding: "12px" }}>
              <div style={{ fontWeight: 600, fontSize: "13px", marginBottom: "8px" }}>
                🫀 CHA₂DS₂-VASc — {chadsTotal} pontos
              </div>
              {chadsItens.filter(it => it.val).map((it, i) => (
                <div key={i} style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>• {it.label} (+{it.pts})</div>
              ))}
              <div style={{ marginTop: "8px", fontWeight: 600, fontSize: "13px", color: anticoagular ? "var(--color-text-danger)" : "var(--color-text-success)" }}>
                {anticoagular ? "✅ Anticoagulação recomendada" : "⬜ Anticoagulação não indicada"}
              </div>
              <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
                {sexo === "F" ? `Score efetivo (excluindo sexo): ${chadsEfetivo}` : `Score: ${chadsTotal}`}
              </div>
            </div>
            <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "8px", padding: "12px" }}>
              <div style={{ fontWeight: 600, fontSize: "13px", marginBottom: "8px" }}>
                🩸 HAS-BLED — {hasBledTotal} pontos
              </div>
              {hasBledItens.filter(it => it.val).map((it, i) => (
                <div key={i} style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>• {it.label} (+{it.pts})</div>
              ))}
              <div style={{ marginTop: "8px", fontWeight: 600, fontSize: "13px", color: hasBledTotal >= 3 ? "var(--color-text-warning)" : "var(--color-text-success)" }}>
                {hasBledTotal >= 3 ? `⚠ Alto risco de sangramento (${hasBledTotal}≥3) — não contraindicação, mas aumentar vigilância` : `Risco baixo/moderado de sangramento`}
              </div>
              <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>Fatores modificáveis devem ser corrigidos</div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function AntecedentesTab({ consulta, updateConsulta }) {
  const a = consulta.antecedentes || {};
  const set = (k, v) => updateConsulta(p => ({ ...p, antecedentes: { ...p.antecedentes, [k]: v } }));
  return (
    <SectionCard title="Antecedentes pessoais e familiares" icon="ti-history">
      <Field label="Tabagismo">
        <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
          {["Nunca fumou", "Ex-tabagista", "Tabagista atual"].map(opt => (
            <label key={opt} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px" }}>
              <input type="radio" name="tabagismo" checked={a.tabagismo === opt} onChange={() => set("tabagismo", opt)} />{opt}
            </label>
          ))}
        </div>
      </Field>
      {a.tabagismo && a.tabagismo !== "Nunca fumou" && (
        <Row cols="repeat(4, 1fr)">
          <Field label="Início (ano)"><input value={a.tabagismoInicio || ""} onChange={e => set("tabagismoInicio", e.target.value)} /></Field>
          {a.tabagismo === "Ex-tabagista" && <Field label="Cessou (ano)"><input value={a.tabagismoCessou || ""} onChange={e => set("tabagismoCessou", e.target.value)} /></Field>}
          <Field label="Maços/dia"><input type="number" step="0.1" value={a.macosDia || ""} onChange={e => set("macosDia", e.target.value)} /></Field>
          <Field label="Maços/ano"><input type="number" value={a.macosAno || ""} onChange={e => set("macosAno", e.target.value)} /></Field>
        </Row>
      )}
      <Field label="Etilismo">
        <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
          {["Nega", "Social", "Abuso/dependência", "Etilista inativo"].map(opt => (
            <label key={opt} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px" }}>
              <input type="radio" name="etilismo" checked={a.etilismo === opt} onChange={() => set("etilismo", opt)} />{opt}
            </label>
          ))}
        </div>
      </Field>
      {a.etilismo && a.etilismo !== "Nega" && (
        <Row cols="repeat(4, 1fr)">
          <Field label="Tipo de bebida"><input value={a.etilismoTipo || ""} onChange={e => set("etilismoTipo", e.target.value)} placeholder="ex: cerveja, vinho..." /></Field>
          <Field label="Frequência"><input value={a.etilismoFrequencia || ""} onChange={e => set("etilismoFrequencia", e.target.value)} placeholder="ex: diário, fins de semana..." /></Field>
          <Field label="Início (ano)"><input value={a.etilismoInicio || ""} onChange={e => set("etilismoInicio", e.target.value)} /></Field>
          {a.etilismo === "Etilista inativo" && <Field label="Cessou (ano)"><input value={a.etilismoCessou || ""} onChange={e => set("etilismoCessou", e.target.value)} /></Field>}
        </Row>
      )}
      <Field label="Cirurgias prévias"><textarea rows={2} value={a.cirurgias || ""} onChange={e => set("cirurgias", e.target.value)} /></Field>
      <Field label="Internamentos no último ano"><textarea rows={2} value={a.internamentos || ""} onChange={e => set("internamentos", e.target.value)} /></Field>
      <Field label="Alergias"><input value={a.alergias || ""} onChange={e => set("alergias", e.target.value)} /></Field>
      <Field label="Histórico familiar"><textarea rows={2} value={a.historicoFamiliar || ""} onChange={e => set("historicoFamiliar", e.target.value)} /></Field>
    </SectionCard>
  );
}

function MedicacoesTab({ consulta, updateConsulta }) {
  const texto = consulta.medicacoesTexto || "";
  const linhas = texto.split("\n").map(l => l.trim()).filter(Boolean);
  const beersAlerts = linhas.filter(l => checkBeers(l));
  const interacoes = checkInteracoes(texto);
  const alertasEspeciais = checkAlertasEspeciais(texto);
  const numMeds = linhas.length;
  const polifarmacia = numMeds >= 5;
  const polimedicacao = numMeds >= 10;

  // Sugestões de deprescrição baseadas nos fármacos detectados
  const DEPRESC = [
    { drug: ["omeprazol","pantoprazol","lansoprazol","rabeprazol","esomeprazol"], msg: "IBP: reavaliar indicação — uso prolongado aumenta risco de infecção, hipomagnesemia e fratura. Tentar desmame se sem indicação formal." },
    { drug: ["aas","ácido acetilsalicílico"], msg: "AAS em prevenção primária: benefício não supera risco de sangramento em idosos ≥ 70 anos — considerar suspensão." },
    { drug: ["zolpidem","zopiclona","eszopiclona"], msg: "Z-drug: associado a quedas, fraturas e declínio cognitivo em idosos — substituir por CBT-I ou trazodona se insônia." },
    { drug: ["diazepam","clonazepam","alprazolam","lorazepam","midazolam","bromazepam"], msg: "Benzodiazepínico: evitar em idosos — risco de quedas, delirium e dependência. Planejar desmame gradual." },
    { drug: ["glibenclamida","clorpropamida"], msg: "Sulfonilureia de longa ação: alto risco de hipoglicemia grave em idosos — substituir por glicazida MR ou inibidor de DPP-4." },
    { drug: ["metoclopramida"], msg: "Metoclopramida: risco de sintomas extrapiramidais — evitar uso crônico em idosos, especialmente parkinsonianos." },
    { drug: ["nifedipina"], msg: "Nifedipina de ação curta: associada a hipotensão e risco cardiovascular — substituir por anlodipino ou outro BCC de longa ação." },
    { drug: ["amiodarona"], msg: "Amiodarona: múltiplos efeitos adversos em idosos (tireóide, pulmão, fígado) — reavaliar indicação e alternativas." },
    { drug: ["digoxina"], msg: "Digoxina: janela terapêutica estreita em idosos, risco de toxicidade — considerar suspensão se FC controlada com betabloqueador." },
  ];

  const sugestoesDepresc = DEPRESC.filter(d =>
    d.drug.some(drug => linhas.some(l => l.toLowerCase().includes(drug)))
  );

  // Alertas de desprescrição avançados com planos detalhados
  const alertasDesprescricao = [];

  // 1. IBP sem indicação clara (uso crônico)
  const temIBP = linhas.some(l => /omeprazol|pantoprazol|lansoprazol|rabeprazol|esomeprazol/i.test(l));
  const temIndicacaoIBP = (consulta.problemas?.["DRGE"] || consulta.problemas?.["Úlcera péptica"] || consulta.problemas?.["Esofagite"] ||
    (consulta.medicacoesTexto || "").toLowerCase().match(/aas|ácido acetilsalicílico|aspirina|clopidogrel|varfarina|ibuprofeno|diclofenaco|prednisona|dexametasona|corticoide/));
  if (temIBP && !temIndicacaoIBP) {
    alertasDesprescricao.push({
      titulo: "⚠ IBP sem indicação clara — sugerir tentativa de desmame",
      tipo: "warning",
      itens: [
        "Uso crônico de IBP (>3 meses) sem indicação documentada (DRGE, úlcera, uso de AINE/AAS/anticoagulante)",
        "Riscos do uso prolongado: deficiência de B12, Mg, Ca; infecções intestinais (C. diff); pneumonia; osteoporose",
        "Plano de desmame sugerido:",
        "→ Semanas 1–2: manter dose atual",
        "→ Semanas 3–4: reduzir para dose mínima (omeprazol 20mg/dia)",
        "→ Semanas 5–8: tentar uso em dias alternados",
        "→ Após 8 semanas: tentar suspensão com uso por demanda se sintomas retornarem",
        "Orientar: elevar cabeceira, evitar alimentos ácidos, refeições menores",
      ]
    });
  }

  // 2. Benzodiazepínico em uso (>4 semanas implícito pelo uso continuado)
  const temBZD = linhas.some(l => /diazepam|clonazepam|alprazolam|lorazepam|midazolam|bromazepam|nitrazepam|zolpidem|zopiclona/i.test(l));
  if (temBZD) {
    alertasDesprescricao.push({
      titulo: "⚠ Benzodiazepínico / Z-drug — plano de retirada gradual",
      tipo: "danger",
      itens: [
        "Benzodiazepínicos e Z-drugs são potencialmente inapropriados em idosos (Critérios de Beers 2023)",
        "Riscos: quedas, fraturas de quadril, delirium, declínio cognitivo, dependência física",
        "Plano de retirada gradual sugerido (nunca suspender abruptamente):",
        "→ Converter para benzodiazepínico de meia-vida longa (diazepam) se necessário",
        "→ Reduzir 10–25% da dose a cada 1–2 semanas conforme tolerância",
        "→ Nas últimas etapas (doses baixas), reduzir mais lentamente",
        "→ Oferecer alternativa não farmacológica: TCC para insônia (CBT-I), higiene do sono",
        "→ Para ansiedade: considerar ISRS, buspirona ou pregabalina como substitutos",
        "Duração total do desmame: 4–16 semanas dependendo da dose e tempo de uso",
      ]
    });
  }

  // 3. Antipsicótico para demência
  const temAntipsicótico = linhas.some(l => /haloperidol|risperidona|quetiapina|olanzapina|aripiprazol|ziprasidona|clozapina|clorpromazina/i.test(l));
  const temDemência = consulta.problemas?.["Demência"] || consulta.problemas?.["Doença de Alzheimer"] || consulta.problemas?.["Síndrome demencial"];
  if (temAntipsicótico && temDemência) {
    alertasDesprescricao.push({
      titulo: "⚠ Antipsicótico em demência — reavaliar e tentar redução de dose",
      tipo: "warning",
      itens: [
        "Antipsicóticos em demência aumentam risco de AVC, morte súbita, sedação e piora cognitiva",
        "Indicação deve ser reavaliada a cada 3 meses — sintomas comportamentais frequentemente remitem",
        "Antes de manter/aumentar: esgotar medidas não farmacológicas (ambiente estruturado, rotina, estimulação)",
        "Plano de redução sugerido:",
        "→ Reduzir 25–50% da dose atual",
        "→ Aguardar 2–4 semanas observando recorrência dos sintomas",
        "→ Se estável: tentar suspensão",
        "→ Se piora: retornar à dose mínima eficaz",
        "Exceção: psicose grave ou agressividade com risco para si ou outros — reavaliar em 3 meses",
      ]
    });
  }

  return (
    <div>
      <SectionCard title="Medicações em uso" icon="ti-pill">
        {alertasDesprescricao.length > 0 && (
          <div style={{ marginBottom: "10px" }}>
            {alertasDesprescricao.map((a, i) => (
              <div key={i} style={{ background: `var(--color-background-${a.tipo})`, border: `0.5px solid var(--color-border-${a.tipo})`, borderRadius: "8px", padding: "12px 14px", fontSize: "13px", marginBottom: "10px" }}>
                <div style={{ fontWeight: 700, color: `var(--color-text-${a.tipo})`, marginBottom: "6px" }}>{a.titulo}</div>
                {a.itens.map((item, j) => (
                  <div key={j} style={{ fontSize: "12px", padding: "2px 0", color: item.startsWith("→") ? "var(--color-text-info)" : "var(--color-text-primary)", fontWeight: item.startsWith("→") ? 500 : 400 }}>
                    {item.startsWith("→") ? item : `• ${item}`}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {polifarmacia && (
          <div style={{ background: "var(--color-background-warning)", border: "0.5px solid var(--color-border-warning)", borderRadius: "8px", padding: "12px 14px", fontSize: "13px", marginBottom: "10px" }}>
            <div style={{ fontWeight: 700, color: "var(--color-text-warning)", marginBottom: "6px" }}>
              ⚠ {polimedicacao ? "Polimedicação" : "Polifarmácia"}: {numMeds} medicamentos
              {polimedicacao ? " (≥ 10 — risco muito elevado)" : " (≥ 5 — reavaliar indicações)"}
            </div>
            {sugestoesDepresc.length > 0 && (
              <div>
                <div style={{ fontWeight: 600, marginBottom: "4px" }}>Oportunidades de deprescrição identificadas:</div>
                {sugestoesDepresc.map((s, i) => (
                  <div key={i} style={{ marginBottom: "4px" }}>• {s.msg}</div>
                ))}
              </div>
            )}
          </div>
        )}
        {beersAlerts.length > 0 && (
          <Alert type="warning">
            <strong>⚠ Critérios de Beers 2023:</strong> {beersAlerts.length} medicação(ões) potencialmente inapropriada(s) para idosos: <em>{beersAlerts.join(", ")}</em>. Avalie risco/benefício individualmente.
          </Alert>
        )}
        {alertasEspeciais.length > 0 && (
          <div style={{ marginBottom: "10px" }}>
            {alertasEspeciais.map((a, i) => (
              <Alert key={i} type={a.tipo}>{a.msg}</Alert>
            ))}
          </div>
        )}
        {interacoes.length > 0 && (
          <div style={{ marginBottom: "10px" }}>
            {interacoes.map((msg, i) => (
              <Alert key={i} type="warning"><strong>⚠ Interação:</strong> {msg}</Alert>
            ))}
          </div>
        )}
        <textarea
          rows={10}
          value={texto}
          onChange={e => updateConsulta(p => ({ ...p, medicacoesTexto: e.target.value }))}
          placeholder={"Liste as medicações em uso, uma por linha. Ex:\nLosartana 50mg - 1cp pela manhã e à noite\nAAS 100mg - 1cp após almoço"}
        />
      </SectionCard>
      <SectionCard title="Histórico de medicações — linha do tempo" icon="ti-history" defaultOpen={false}>
        <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "10px" }}>
          Registre medicações iniciadas ou suspensas com data e motivo. Use para rastrear a evolução do tratamento ao longo das consultas.
        </div>
        {(() => {
          const historico = Array.isArray(consulta.historicoMedicacoes) ? consulta.historicoMedicacoes : [];
          function addItem() {
            updateConsulta(p => ({ ...p, historicoMedicacoes: [...(p.historicoMedicacoes || []), { id: uid(), medicacao: "", evento: "iniciado", data: "", motivo: "" }] }));
          }
          function updItem(id, k, v) {
            updateConsulta(p => ({ ...p, historicoMedicacoes: (p.historicoMedicacoes || []).map(x => x.id === id ? { ...x, [k]: v } : x) }));
          }
          function remItem(id) {
            updateConsulta(p => ({ ...p, historicoMedicacoes: (p.historicoMedicacoes || []).filter(x => x.id !== id) }));
          }
          return (
            <div>
              {historico.map(item => (
                <div key={item.id} style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "flex-start", marginBottom: "10px", padding: "10px", background: "var(--color-background-secondary)", borderRadius: "8px" }}>
                  <div style={{ flex: "1 1 180px" }}>
                    <Field label="Medicação"><input value={item.medicacao || ""} onChange={e => updItem(item.id, "medicacao", e.target.value)} placeholder="Nome e dose..." /></Field>
                  </div>
                  <div>
                    <Field label="Evento">
                      <select value={item.evento || "iniciado"} onChange={e => updItem(item.id, "evento", e.target.value)}>
                        <option value="iniciado">Iniciado</option>
                        <option value="suspenso">Suspenso</option>
                        <option value="ajustado">Dose ajustada</option>
                        <option value="substituido">Substituído</option>
                      </select>
                    </Field>
                  </div>
                  <div>
                    <Field label="Data"><input type="date" value={item.data || ""} onChange={e => updItem(item.id, "data", e.target.value)} /></Field>
                  </div>
                  <div style={{ flex: "1 1 160px" }}>
                    <Field label="Motivo"><input value={item.motivo || ""} onChange={e => updItem(item.id, "motivo", e.target.value)} placeholder="Ex: efeito adverso, sem indicação..." /></Field>
                  </div>
                  <button onClick={() => remItem(item.id)} style={{ marginTop: "20px" }}><i className="ti ti-trash" aria-hidden="true"></i></button>
                </div>
              ))}
              <button onClick={addItem} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
                <i className="ti ti-plus" aria-hidden="true"></i>Adicionar evento
              </button>
            </div>
          );
        })()}
      </SectionCard>
      <SectionCard title="Medicações de uso prévio / descontinuadas" icon="ti-notes" defaultOpen={false}>
        <textarea rows={3} value={consulta.medicacoesPrevias || ""} onChange={e => updateConsulta(p => ({ ...p, medicacoesPrevias: e.target.value }))} placeholder="Medicação, motivo da descontinuação..." />
      </SectionCard>
    </div>
  );
}

function QueixasTab({ consulta, updateConsulta }) {
  return (
    <SectionCard title="Queixas" icon="ti-message">
      <textarea rows={8} value={consulta.queixas} onChange={e => updateConsulta(p => ({ ...p, queixas: e.target.value }))} placeholder="Descreva a queixa principal e a história da doença atual..." />
    </SectionCard>
  );
}

function AgaTab({ consulta, updateConsulta, sexoPaciente }) {
  const aga = consulta.aga || {};
  const set = (k, v) => updateConsulta(p => ({ ...p, aga: { ...p.aga, [k]: v } }));

  const AIVD_ITEMS = ["Telefone","Transporte","Compras","Preparar refeições","Tarefas domésticas","Trabalhos manuais","Lavar roupas","Medicações","Finanças"];
  const ABVD_ITEMS = ["Banho","Vestir-se","Higiene pessoal","Transferência","Continência","Alimentação"];
  const FRAIL_ITEMS = [
    { key: "fatigue", label: "Se sente cansado/fadigado na maior parte do tempo na última semana?" },
    { key: "resistance", label: "Tem dificuldade de subir um lance de escadas sozinho?" },
    { key: "ambulation", label: "Tem dificuldade para caminhar um quarteirão sozinho?" },
    { key: "illness", label: "Tem diagnóstico de 5 ou mais doenças (HAS, DM, CA, IC, DAC, DPOC, ASMA, OA, AVC)?" },
    { key: "loss", label: "Teve perda de peso não intencional nos últimos 6 meses (5%)?" },
  ];

  const aivdCount = AIVD_ITEMS.filter(it => aga.aivd && aga.aivd[it]).length;
  const abvdCount = ABVD_ITEMS.filter(it => aga.abvd && aga.abvd[it]).length;
  const frailCount = FRAIL_ITEMS.filter(it => aga.frail && aga.frail[it.key]).length;
  const frailClass = frailCount === 0 ? "Robusto" : frailCount <= 2 ? "Pré-frágil" : "Frágil";
  const frailColor = frailCount === 0 ? "success" : frailCount <= 2 ? "warning" : "danger";

  const imc = calcIMC(aga.peso, aga.altura);
  const imcLabel = imc
    ? (imc <= 22 ? "⚠ Baixo peso (≤ 22,0)" : imc < 27 ? "Eutrofia (> 22,0 e < 27,0)" : "⚠ Sobrepeso (≥ 27,0)")
    : null;

  // Diagnóstico de sarcopenia (item 3)
  const forcaNum = parseFloat(aga.testeForca);
  const circNum = parseFloat(aga.circPanturrilha);
  const alertaForca = aga.testeForca && !isNaN(forcaNum)
    ? (sexoPaciente === "M" ? forcaNum < 27 : forcaNum < 16) : false;
  const alertaCirc = aga.circPanturrilha && !isNaN(circNum) ? circNum < 31 : false;
  const alertaSarcopenia = alertaForca || alertaCirc;
  const gdsNum = parseInt(aga.gds15, 10);
  const gdsPositive = !isNaN(gdsNum) && gdsNum >= 6;

  const toggleAivd = (item) => set("aivd", { ...(aga.aivd || {}), [item]: !(aga.aivd || {})[item] });
  const toggleAbvd = (item) => set("abvd", { ...(aga.abvd || {}), [item]: !(aga.abvd || {})[item] });
  const toggleFrail = (key) => set("frail", { ...(aga.frail || {}), [key]: !(aga.frail || {})[key] });

  return (
    <div>
      <SectionCard title="Funcionalidade" icon="ti-walk">
        <Field label={`AIVD (Lawton) — independente em ${aivdCount}/9`}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "4px" }}>
            {AIVD_ITEMS.map(item => (
              <label key={item} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
                <input type="checkbox" checked={!!(aga.aivd && aga.aivd[item])} onChange={() => toggleAivd(item)} />{item}
              </label>
            ))}
          </div>
          {aivdCount < 9 && (
            <Field label="Justificativa para perda de AIVD">
              <textarea rows={2} value={aga.aivdJustificativa || ""} onChange={e => set("aivdJustificativa", e.target.value)} placeholder="Ex: não faz compras por não sair de casa, não lida com finanças por demência..." />
            </Field>
          )}
        </Field>
        <Field label={`ABVD (Katz) — independente em ${abvdCount}/6`}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "4px" }}>
            {ABVD_ITEMS.map(item => (
              <label key={item} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
                <input type="checkbox" checked={!!(aga.abvd && aga.abvd[item])} onChange={() => toggleAbvd(item)} />{item}
              </label>
            ))}
          </div>
          {abvdCount < 6 && (
            <Field label="Justificativa para perda de ABVD">
              <textarea rows={2} value={aga.abvdJustificativa || ""} onChange={e => set("abvdJustificativa", e.target.value)} placeholder="Ex: dependente para banho por artrose grave, necessita auxílio para transferência por fraqueza..." />
            </Field>
          )}
        </Field>
      </SectionCard>

      <SectionCard title="Mobilidade" icon="ti-wheelchair">
        <Field label="Marcha"><RadioGroup name="marcha" value={aga.marcha} onChange={v => set("marcha", v)} options={[{value:"preservada",label:"Preservada"},{value:"lentificada",label:"Lentificada"},{value:"auxilio",label:"Com auxílio"}]} /></Field>
        <Field label="Dispositivo"><RadioGroup name="disp" value={aga.dispositivo} onChange={v => set("dispositivo", v)} options={[{value:"nenhum",label:"Nenhum"},{value:"bengala",label:"Bengala"},{value:"andador",label:"Andador"},{value:"cadeira",label:"Cadeira de rodas"}]} /></Field>
        <Field label="Queda no último ano">
          <RadioGroup name="quedas" value={aga.quedas} onChange={v => set("quedas", v)} options={[{value:"nao",label:"Não"},{value:"sim",label:"Sim"}]} />
        </Field>
        {aga.quedas === "sim" && (<>
          <Field label="Número de quedas"><input value={aga.quedasNum || ""} onChange={e => set("quedasNum", e.target.value)} style={{ maxWidth: "100px" }} /></Field>
          <Field label="Descrição da queda (circunstância, local, mecanismo, consequências)">
            <textarea rows={2} value={aga.quedasDescricao || ""} onChange={e => set("quedasDescricao", e.target.value)} />
          </Field>
          <Row>
            <div>
              <Field label="Fratura associada">
                <RadioGroup name="fraturas" value={aga.fraturas} onChange={v => set("fraturas", v)} options={[{value:"nao",label:"Não"},{value:"sim",label:"Sim"}]} />
              </Field>
              {aga.fraturas === "sim" && (
                <Field label="Descreva a fratura"><textarea rows={2} value={aga.fraturasDescricao || ""} onChange={e => set("fraturasDescricao", e.target.value)} placeholder="ex: fratura de fêmur proximal, tratamento cirúrgico..." /></Field>
              )}
            </div>
            <div>
              <Field label="TCE associado">
                <RadioGroup name="tce" value={aga.tce} onChange={v => set("tce", v)} options={[{value:"nao",label:"Não"},{value:"sim",label:"Sim"}]} />
              </Field>
              {aga.tce === "sim" && (
                <Field label="Descreva o TCE"><textarea rows={2} value={aga.tceDescricao || ""} onChange={e => set("tceDescricao", e.target.value)} placeholder="ex: perda de consciência, hematoma subdural..." /></Field>
              )}
            </div>
          </Row>
        </>)}
      </SectionCard>

      <SectionCard title="Fragilidade (FRAIL)" icon="ti-heart-rate-monitor">
        <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: 0 }}>Resposta "Sim" = 1 ponto em cada item</p>
        <div style={{ display: "grid", gap: "8px", marginBottom: "10px" }}>
          {FRAIL_ITEMS.map(it => (
            <label key={it.key} style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "14px", cursor: "pointer" }}>
              <input type="checkbox" checked={!!(aga.frail && aga.frail[it.key])} onChange={() => toggleFrail(it.key)} style={{ marginTop: "3px", flexShrink: 0 }} />
              <span>{it.label}</span>
            </label>
          ))}
        </div>
        <Pill color={frailColor}>{frailClass} ({frailCount}/5 critérios)</Pill>
      </SectionCard>

      <SectionCard title="Cognição" icon="ti-brain">
        <Field label="">
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", cursor: "pointer" }}>
            <input type="checkbox" checked={!!aga.semQueixasCognitivas} onChange={e => set("semQueixasCognitivas", e.target.checked)} />
            Sem queixas cognitivas
          </label>
        </Field>
        {!aga.semQueixasCognitivas && (
          <>
            <Field label="Descrição da queixa cognitiva"><textarea rows={2} value={aga.queixasCognitivasDescricao || ""} onChange={e => set("queixasCognitivasDescricao", e.target.value)} placeholder="ex: esquecimento de compromissos, dificuldade para encontrar palavras..." /></Field>

            {/* MEEM estruturado */}
            <SectionCard title="MEEM — Mini Exame do Estado Mental" icon="ti-clipboard-list" defaultOpen={false}>
              {(() => {
                const escolaridade = consulta._escolaridade || "";
                const itens = [
                  { key: "meemOrientacaoTempo", label: "Orientação no tempo (ano, estação, mês, dia, dia da semana)", max: 5 },
                  { key: "meemOrientacaoEspaco", label: "Orientação no espaço (país, estado, cidade, local, andar)", max: 5 },
                  { key: "meemRegistro", label: "Registro (repetir 3 palavras)", max: 3 },
                  { key: "meemAtencao", label: "Atenção e cálculo (serial 7s ou soletrar MUNDO)", max: 5 },
                  { key: "meemEvocacao", label: "Evocação (recordar 3 palavras)", max: 3 },
                  { key: "meemLinguagemNomeacao", label: "Nomeação (relógio e caneta)", max: 2 },
                  { key: "meemLinguagemRepetir", label: "Repetição ('Nem aqui, nem ali, nem lá')", max: 1 },
                  { key: "meemLinguagemComando", label: "Comando de 3 etapas", max: 3 },
                  { key: "meemLinguagemLer", label: "Leitura ('Feche os olhos')", max: 1 },
                  { key: "meemLinguagemEscrever", label: "Escrever uma frase", max: 1 },
                  { key: "meemCopia", label: "Cópia do pentágono", max: 1 },
                ];
                const total = itens.reduce((s, it) => s + (parseInt(aga[it.key]) || 0), 0);
                const maxTotal = 30;
                // Pontos de corte por escolaridade (Bertolucci et al.)
                const cutoff = !escolaridade ? 24 : escolaridade.includes("Analfabeto") ? 13 : escolaridade.includes("1") || escolaridade.includes("Fundamental I") ? 18 : escolaridade.includes("Fundamental") || escolaridade.includes("Médio") ? 24 : 26;
                const alterado = total < cutoff;
                return (
                  <div>
                    {itens.map(it => (
                      <div key={it.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px", gap: "8px" }}>
                        <span style={{ fontSize: "13px", flex: 1 }}>{it.label}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          <input type="number" min="0" max={it.max} value={aga[it.key] ?? ""} onChange={e => set(it.key, e.target.value)} style={{ width: "52px", textAlign: "center" }} />
                          <span style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>/{it.max}</span>
                        </div>
                      </div>
                    ))}
                    <div style={{ marginTop: "10px", padding: "10px", background: alterado ? "var(--color-background-warning)" : "var(--color-background-success)", borderRadius: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 700, color: alterado ? "var(--color-text-warning)" : "var(--color-text-success)" }}>
                        MEEM Total: {total}/{maxTotal} {alterado ? "⚠ Abaixo do ponto de corte" : "✓ Dentro do esperado"}
                      </span>
                      <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>Ponto de corte: {cutoff}</span>
                    </div>
                    {total !== (parseInt(aga.meem) || 0) && (
                      <button onClick={() => set("meem", String(total))} style={{ marginTop: "6px", fontSize: "12px" }}>
                        Salvar pontuação ({total}) no campo MEEM
                      </button>
                    )}
                  </div>
                );
              })()}
            </SectionCard>

            {/* Mini-Cog estruturado */}
            <SectionCard title="Mini-Cog" icon="ti-clock" defaultOpen={false}>
              {(() => {
                const evocacao = parseInt(aga.minicogEvocacao) || 0;
                const relogio = parseInt(aga.minicogRelogio) || 0; // 0=anormal, 1=normal
                let resultado = "";
                if (evocacao === 3) resultado = "Normal (baixo risco de demência)";
                else if (evocacao === 0) resultado = "Alterado (alta suspeita de demência)";
                else if (evocacao <= 2 && relogio === 1) resultado = "Normal (baixo risco)";
                else if (evocacao <= 2 && relogio === 0) resultado = "Alterado (suspeita de demência)";
                const alterado = resultado.includes("Alterado");
                return (
                  <div>
                    <Field label="Evocação das 3 palavras (0–3)">
                      <input type="number" min="0" max="3" value={aga.minicogEvocacao ?? ""} onChange={e => set("minicogEvocacao", e.target.value)} style={{ maxWidth: "80px" }} />
                    </Field>
                    <Field label="Desenho do relógio">
                      <select value={aga.minicogRelogio ?? ""} onChange={e => set("minicogRelogio", e.target.value)}>
                        <option value="">Selecione...</option>
                        <option value="1">Normal (ponteiros e números corretos)</option>
                        <option value="0">Anormal</option>
                      </select>
                    </Field>
                    {resultado && (
                      <Alert type={alterado ? "warning" : "success"}>{resultado}</Alert>
                    )}
                    {resultado && parseInt(aga.minicogEvocacao) !== undefined && (
                      <button onClick={() => set("minicog", alterado ? "Alterado" : "Normal")} style={{ fontSize: "12px" }}>
                        Salvar resultado no campo Mini-Cog
                      </button>
                    )}
                  </div>
                );
              })()}
            </SectionCard>

            {/* MoCA */}
            <SectionCard title="MoCA — Montreal Cognitive Assessment" icon="ti-brain" defaultOpen={false}>
              {(() => {
                const itensMoca = [
                  { key: "mocaVisuoespacial", label: "Visuoespacial/Executivo (trilha, cubo, relógio)", max: 5 },
                  { key: "mocaNomeacao", label: "Nomeação (leão, rinoceronte, camelo)", max: 3 },
                  { key: "mocaMemoria", label: "Memória (evocação das 5 palavras)", max: 5 },
                  { key: "mocaAtencao", label: "Atenção (dígitos, vigilância, serial 7)", max: 6 },
                  { key: "mocaLinguagem", label: "Linguagem (frases, fluência verbal)", max: 3 },
                  { key: "mocaAbstracao", label: "Abstração (semelhanças)", max: 2 },
                  { key: "mocaEvocacao", label: "Evocação tardia (5 palavras)", max: 5 },
                  { key: "mocaOrientacao", label: "Orientação (data, mês, ano, dia, local, cidade)", max: 6 },
                ];
                const total = itensMoca.reduce((s, it) => s + (parseInt(aga[it.key]) || 0), 0);
                // +1 ponto se escolaridade ≤ 12 anos
                const escolaridade = consulta._escolaridade || "";
                const bonus = (!escolaridade || escolaridade.includes("Fundamental") || escolaridade.includes("Médio")) ? 1 : 0;
                const totalCorrigido = Math.min(total + bonus, 30);
                const alterado = totalCorrigido < 26;
                return (
                  <div>
                    {itensMoca.map(it => (
                      <div key={it.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px", gap: "8px" }}>
                        <span style={{ fontSize: "13px", flex: 1 }}>{it.label}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          <input type="number" min="0" max={it.max} value={aga[it.key] ?? ""} onChange={e => set(it.key, e.target.value)} style={{ width: "52px", textAlign: "center" }} />
                          <span style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>/{it.max}</span>
                        </div>
                      </div>
                    ))}
                    <div style={{ marginTop: "10px", padding: "10px", background: alterado ? "var(--color-background-warning)" : "var(--color-background-success)", borderRadius: "8px" }}>
                      <div style={{ fontWeight: 700, color: alterado ? "var(--color-text-warning)" : "var(--color-text-success)" }}>
                        MoCA: {total} {bonus ? `+1 (escolaridade) = ${totalCorrigido}` : ""}/30 {alterado ? "⚠ Abaixo de 26 — rastreio positivo" : "✓ Normal (≥ 26)"}
                      </div>
                    </div>
                    {totalCorrigido !== (parseInt(aga.moca) || 0) && (
                      <button onClick={() => set("moca", String(totalCorrigido))} style={{ marginTop: "6px", fontSize: "12px" }}>
                        Salvar pontuação ({totalCorrigido}) no campo MoCA
                      </button>
                    )}
                  </div>
                );
              })()}
            </SectionCard>

            <Row cols="repeat(3, 1fr)">
              <Field label="Mini-Cog (resultado)"><input value={aga.minicog || ""} onChange={e => set("minicog", e.target.value)} placeholder="Normal / Alterado" /></Field>
              <Field label="MEEM (pontuação)"><input value={aga.meem || ""} onChange={e => set("meem", e.target.value)} /></Field>
              <Field label="MoCA (pontuação)"><input value={aga.moca || ""} onChange={e => set("moca", e.target.value)} /></Field>
            </Row>

            {/* CDR */}
            {(consulta.problemas?.["Demência"] || consulta.problemas?.["Doença de Alzheimer"] || consulta.problemas?.["Síndrome demencial"]) && (
              <SectionCard title="CDR — Clinical Dementia Rating" icon="ti-chart-line" defaultOpen={false}>
                {(() => {
                  const dominios = [
                    { key: "cdrMemoria", label: "Memória" },
                    { key: "cdrOrientacao", label: "Orientação" },
                    { key: "cdrJulgamento", label: "Julgamento e resolução de problemas" },
                    { key: "cdrComunidade", label: "Atividades na comunidade" },
                    { key: "cdrLar", label: "Lar e hobbies" },
                    { key: "cdrCuidado", label: "Cuidados pessoais" },
                  ];
                  const opts = [
                    { value: "0", label: "0 — Normal" },
                    { value: "0.5", label: "0,5 — Questionável" },
                    { value: "1", label: "1 — Leve" },
                    { value: "2", label: "2 — Moderada" },
                    { value: "3", label: "3 — Grave" },
                  ];
                  const cdrGlobal = aga.cdrGlobal || "";
                  return (
                    <div>
                      {dominios.map(d => (
                        <Field key={d.key} label={d.label}>
                          <select value={aga[d.key] || ""} onChange={e => set(d.key, e.target.value)}>
                            <option value="">Selecione...</option>
                            {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </Field>
                      ))}
                      <Field label="CDR Global (clínico)">
                        <select value={cdrGlobal} onChange={e => set("cdrGlobal", e.target.value)}>
                          <option value="">Selecione...</option>
                          {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </Field>
                      {cdrGlobal && (
                        <Alert type={cdrGlobal === "0" ? "success" : cdrGlobal === "0.5" ? "info" : cdrGlobal === "1" ? "warning" : "danger"}>
                          CDR {cdrGlobal}: {cdrGlobal === "0" ? "Sem demência" : cdrGlobal === "0.5" ? "Comprometimento cognitivo leve / Questionável" : cdrGlobal === "1" ? "Demência leve" : cdrGlobal === "2" ? "Demência moderada" : "Demência grave"}
                        </Alert>
                      )}
                    </div>
                  );
                })()}
              </SectionCard>
            )}
          </>
        )}
      </SectionCard>

      <SectionCard title="Humor" icon="ti-mood-sad">
        <Field label="">
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", cursor: "pointer" }}>
            <input type="checkbox" checked={!!aga.semQueixasHumor} onChange={e => set("semQueixasHumor", e.target.checked)} />
            Sem queixas de humor
          </label>
        </Field>
        {!aga.semQueixasHumor && (
          <>
            <Field label="Descrição da queixa de humor"><textarea rows={2} value={aga.queixasHumorDescricao || ""} onChange={e => set("queixasHumorDescricao", e.target.value)} placeholder="ex: tristeza, anedonia, irritabilidade..." /></Field>

            {/* GDS-15 estruturado */}
            <SectionCard title="GDS-15 — Escala de Depressão Geriátrica" icon="ti-clipboard-list" defaultOpen={false}>
              {(() => {
                const GDS_QUESTOES = [
                  { key: "gdsQ1",  texto: "1. Está satisfeito(a) com sua vida?", depressivo: "nao" },
                  { key: "gdsQ2",  texto: "2. Abandonou muitas de suas atividades e interesses?", depressivo: "sim" },
                  { key: "gdsQ3",  texto: "3. Sente que sua vida está vazia?", depressivo: "sim" },
                  { key: "gdsQ4",  texto: "4. Fica com frequência aborrecido(a)?", depressivo: "sim" },
                  { key: "gdsQ5",  texto: "5. Está de bom humor na maior parte do tempo?", depressivo: "nao" },
                  { key: "gdsQ6",  texto: "6. Tem medo de que algo ruim vá lhe acontecer?", depressivo: "sim" },
                  { key: "gdsQ7",  texto: "7. Sente-se feliz na maior parte do tempo?", depressivo: "nao" },
                  { key: "gdsQ8",  texto: "8. Sente-se frequentemente desamparado(a)?", depressivo: "sim" },
                  { key: "gdsQ9",  texto: "9. Prefere ficar em casa a sair e fazer coisas novas?", depressivo: "sim" },
                  { key: "gdsQ10", texto: "10. Acha que tem mais problemas de memória do que a maioria?", depressivo: "sim" },
                  { key: "gdsQ11", texto: "11. Acha que é maravilhoso estar vivo(a)?", depressivo: "nao" },
                  { key: "gdsQ12", texto: "12. Sente-se inútil?", depressivo: "sim" },
                  { key: "gdsQ13", texto: "13. Sente-se cheio(a) de energia?", depressivo: "nao" },
                  { key: "gdsQ14", texto: "14. Sente que sua situação é sem esperança?", depressivo: "sim" },
                  { key: "gdsQ15", texto: "15. Acha que a maioria das pessoas está melhor do que você?", depressivo: "sim" },
                ];
                const pontos = GDS_QUESTOES.reduce((s, q) => {
                  const resp = aga[q.key];
                  if (!resp) return s;
                  return s + (resp === q.depressivo ? 1 : 0);
                }, 0);
                const respondidas = GDS_QUESTOES.filter(q => aga[q.key]).length;
                const positivo = pontos >= 6;
                const nivel = pontos <= 5 ? "Normal" : pontos <= 10 ? "Depressão leve" : "Depressão grave";
                const corNivel = pontos <= 5 ? "success" : pontos <= 10 ? "warning" : "danger";
                return (
                  <div>
                    {GDS_QUESTOES.map(q => (
                      <div key={q.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", gap: "8px", padding: "6px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                        <span style={{ fontSize: "13px", flex: 1 }}>{q.texto}</span>
                        <div style={{ display: "flex", gap: "8px" }}>
                          {["sim", "nao"].map(opt => (
                            <label key={opt} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px", cursor: "pointer" }}>
                              <input type="radio" name={q.key} value={opt} checked={aga[q.key] === opt} onChange={() => set(q.key, opt)} />
                              {opt === "sim" ? "Sim" : "Não"}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                    {respondidas > 0 && (
                      <div style={{ marginTop: "12px", padding: "10px 14px", background: `var(--color-background-${corNivel})`, borderRadius: "8px" }}>
                        <div style={{ fontWeight: 700, color: `var(--color-text-${corNivel})` }}>
                          GDS-15: {pontos}/15 — {nivel}
                          {respondidas < 15 && <span style={{ fontWeight: 400, fontSize: "12px" }}> ({respondidas}/15 respondidas)</span>}
                        </div>
                        {positivo && <div style={{ fontSize: "12px", marginTop: "4px" }}>Rastreio positivo (≥6 pontos) — considerar avaliação clínica detalhada e tratamento</div>}
                      </div>
                    )}
                    {pontos !== (parseInt(aga.gds15) || 0) && respondidas === 15 && (
                      <button onClick={() => set("gds15", String(pontos))} style={{ marginTop: "8px", fontSize: "12px" }}>
                        Salvar pontuação ({pontos}) no campo GDS-15
                      </button>
                    )}
                  </div>
                );
              })()}
            </SectionCard>

            <Field label="GDS-15 (pontuação resumida)" hint="Pontuação ≥6 sugere rastreio positivo para sintomas depressivos">
              <input type="number" min="0" max="15" value={aga.gds15 || ""} onChange={e => set("gds15", e.target.value)} style={{ maxWidth: "100px" }} />
            </Field>
            {gdsPositive && <Alert type="warning">GDS-15 = {gdsNum}: rastreio positivo para sintomas depressivos. Considerar avaliação complementar.</Alert>}
          </>
        )}
      </SectionCard>

      {/* NPI — apenas se demência na lista de problemas */}
      {(consulta.problemas?.["Demência"] || consulta.problemas?.["Doença de Alzheimer"] || consulta.problemas?.["Síndrome demencial"]) && (
        <SectionCard title="NPI — Inventário Neuropsiquiátrico (simplificado)" icon="ti-brain" defaultOpen={false}>
          {(() => {
            const NPI_SINTOMAS = [
              { key: "npiDelirios", label: "Delírios (crenças falsas fixas)" },
              { key: "npiAlucinacoes", label: "Alucinações (visuais, auditivas)" },
              { key: "npiAgitacao", label: "Agitação / Agressividade" },
              { key: "npiDepressao", label: "Depressão / Disforia" },
              { key: "npiAnsiedade", label: "Ansiedade" },
              { key: "npiEuforia", label: "Euforia / Elação" },
              { key: "npiApatia", label: "Apatia / Indiferença" },
              { key: "npiDesinibicao", label: "Desinibição" },
              { key: "npiIrritabilidade", label: "Irritabilidade / Labilidade emocional" },
              { key: "npiMotor", label: "Comportamento motor aberrante (agitação motora)" },
              { key: "npiSono", label: "Distúrbios do sono e comportamento noturno" },
              { key: "npiApetite", label: "Distúrbios do apetite e alimentação" },
            ];
            const presentes = NPI_SINTOMAS.filter(s => aga[s.key] === "sim");
            return (
              <div>
                <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "10px" }}>
                  Marque os sintomas neuropsiquiátricos presentes no último mês. Para cada sintoma presente, descreva a intensidade e o impacto no campo de observações.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "6px", marginBottom: "12px" }}>
                  {NPI_SINTOMAS.map(s => (
                    <label key={s.key} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", cursor: "pointer", padding: "6px 8px", borderRadius: "6px", background: aga[s.key] === "sim" ? "var(--color-background-warning)" : "var(--color-background-secondary)" }}>
                      <input type="checkbox" checked={aga[s.key] === "sim"} onChange={e => set(s.key, e.target.checked ? "sim" : "nao")} />
                      {s.label}
                    </label>
                  ))}
                </div>
                {presentes.length > 0 && (
                  <Alert type="warning">
                    {presentes.length} sintoma(s) neuropsiquiátrico(s) presente(s): {presentes.map(s => s.label).join(", ")}
                  </Alert>
                )}
                <Field label="Observações / Intensidade dos sintomas">
                  <textarea rows={3} value={aga.npiObservacoes || ""} onChange={e => set("npiObservacoes", e.target.value)} placeholder="Ex: agitação vespertina, alucinações visuais noturnas, recusa alimentar..." />
                </Field>
                <Field label="Impacto no cuidador">
                  <select value={aga.npiImpactoCuidador || ""} onChange={e => set("npiImpactoCuidador", e.target.value)}>
                    <option value="">Selecione...</option>
                    <option value="0">Sem impacto</option>
                    <option value="1">Mínimo</option>
                    <option value="2">Leve</option>
                    <option value="3">Moderado</option>
                    <option value="4">Grave</option>
                    <option value="5">Extremo</option>
                  </select>
                </Field>
              </div>
            );
          })()}
        </SectionCard>
      )}

      <SectionCard title="Sono" icon="ti-moon">
        <Field label="">
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", cursor: "pointer" }}>
            <input type="checkbox" checked={!!aga.semQueixasSono} onChange={e => set("semQueixasSono", e.target.checked)} />
            Sem queixas de sono
          </label>
        </Field>
        {!aga.semQueixasSono && (
          <Row>
            <Field label="Roncos"><input value={aga.roncos || ""} onChange={e => set("roncos", e.target.value)} placeholder="Sim / Não / frequência..." /></Field>
            <Field label="Sonolência diurna / Cochilos"><input value={aga.sonolenciaDiurna || ""} onChange={e => set("sonolenciaDiurna", e.target.value)} /></Field>
            <Field label="Higiene do sono"><input value={aga.higieneSono || ""} onChange={e => set("higieneSono", e.target.value)} placeholder="adequada / inadequada..." /></Field>
          </Row>
        )}
        <Field label="Observações sobre o sono">
          <textarea rows={2} value={aga.sonoObservacoes || ""} onChange={e => set("sonoObservacoes", e.target.value)} placeholder="Descreva queixas, padrão de sono, uso de medicações para dormir..." />
        </Field>
      </SectionCard>

      <SectionCard title="Sensorial" icon="ti-eye">
        <Row>
          <Field label="Visão"><RadioGroup name="visao" value={aga.visao} onChange={v => set("visao", v)} options={[{value:"preservada",label:"Preservada"},{value:"alterada",label:"Alterada"}]} /></Field>
          <Field label="Uso de lentes corretivas?"><RadioGroup name="visaoLentes" value={aga.visaoLentes} onChange={v => set("visaoLentes", v)} options={[{value:"nao",label:"Não"},{value:"sim",label:"Sim"}]} /></Field>
        </Row>
        <Row>
          <Field label="Audição"><RadioGroup name="audicao" value={aga.audicao} onChange={v => set("audicao", v)} options={[{value:"preservada",label:"Preservada"},{value:"alterada",label:"Alterada"}]} /></Field>
          <Field label="Uso de aparelho auditivo?"><RadioGroup name="audicaoAparelho" value={aga.audicaoAparelho} onChange={v => set("audicaoAparelho", v)} options={[{value:"nao",label:"Não"},{value:"sim",label:"Sim"}]} /></Field>
        </Row>
      </SectionCard>

      <SectionCard title="Continências" icon="ti-droplet">
        <Row>
          <div>
            <Field label="Incontinência urinária?"><RadioGroup name="incUrin" value={aga.incontinenciaUrinaria} onChange={v => set("incontinenciaUrinaria", v)} options={[{value:"nao",label:"Não"},{value:"sim",label:"Sim"}]} /></Field>
            {aga.incontinenciaUrinaria === "sim" && (
              <Field label="Descreva (tipo, frequência, uso de fralda...)">
                <textarea rows={2} value={aga.incontinenciaUrinariaDes || ""} onChange={e => set("incontinenciaUrinariaDes", e.target.value)} placeholder="ex: urgência, esforço, mista, usa fralda..." />
              </Field>
            )}
          </div>
          <div>
            <Field label="Incontinência fecal?"><RadioGroup name="incFecal" value={aga.incontinenciaFecal} onChange={v => set("incontinenciaFecal", v)} options={[{value:"nao",label:"Não"},{value:"sim",label:"Sim"}]} /></Field>
            {aga.incontinenciaFecal === "sim" && (
              <Field label="Descreva (frequência, consistência...)">
                <textarea rows={2} value={aga.incontinenciaFecalDes || ""} onChange={e => set("incontinenciaFecalDes", e.target.value)} placeholder="ex: episódios frequentes, fezes líquidas..." />
              </Field>
            )}
          </div>
          <div>
            <Field label="Constipação?"><RadioGroup name="constipacao" value={aga.constipacao} onChange={v => set("constipacao", v)} options={[{value:"nao",label:"Não"},{value:"sim",label:"Sim"}]} /></Field>
            {aga.constipacao === "sim" && (
              <Field label="Descreva (frequência, consistência, há quanto tempo...)">
                <textarea rows={2} value={aga.constipacaoDescricao || ""} onChange={e => set("constipacaoDescricao", e.target.value)} placeholder="ex: evacua 1x/semana, fezes ressecadas, há 2 anos..." />
              </Field>
            )}
          </div>
        </Row>
      </SectionCard>

      {/* TUG e SPPB */}
      <SectionCard title="Desempenho físico — TUG e SPPB" icon="ti-run" defaultOpen={false}>
        {/* TUG */}
        <Field label="TUG — Timed Up and Go (segundos)" hint="Paciente levanta, caminha 3m, retorna e senta">
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <input type="number" step="0.1" value={aga.tug || ""} onChange={e => set("tug", e.target.value)} style={{ maxWidth: "100px" }} placeholder="seg" />
            {aga.tug && (() => {
              const t = parseFloat(aga.tug);
              const risco = t < 10 ? { label: "Baixo risco de queda", tipo: "success" } : t <= 20 ? { label: "Risco moderado de queda", tipo: "warning" } : { label: "⚠ Alto risco de queda", tipo: "danger" };
              return <Pill color={risco.tipo}>{risco.label} ({t}s)</Pill>;
            })()}
          </div>
        </Field>

        {/* SPPB */}
        <div style={{ fontWeight: 600, fontSize: "13px", margin: "12px 0 8px" }}>SPPB — Short Physical Performance Battery</div>
        <Row cols="repeat(3, 1fr)">
          <Field label="Teste de equilíbrio (0–4)" hint="0=incapaz, 4=tandem 10s">
            <input type="number" min="0" max="4" value={aga.sppbEquilibrio ?? ""} onChange={e => set("sppbEquilibrio", e.target.value)} />
          </Field>
          <Field label="Velocidade de marcha (0–4)" hint="0=incapaz, 4=<4,82s para 4m">
            <input type="number" min="0" max="4" value={aga.sppbMarcha ?? ""} onChange={e => set("sppbMarcha", e.target.value)} />
          </Field>
          <Field label="Levantar/sentar 5x (0–4)" hint="0=incapaz, 4=<11,2s">
            <input type="number" min="0" max="4" value={aga.sppbLevantarSentar ?? ""} onChange={e => set("sppbLevantarSentar", e.target.value)} />
          </Field>
        </Row>
        {(() => {
          const sppbTotal = (parseInt(aga.sppbEquilibrio) || 0) + (parseInt(aga.sppbMarcha) || 0) + (parseInt(aga.sppbLevantarSentar) || 0);
          if (!aga.sppbEquilibrio && !aga.sppbMarcha && !aga.sppbLevantarSentar) return null;
          const nivel = sppbTotal <= 3 ? { label: "Limitação grave", tipo: "danger" } : sppbTotal <= 6 ? { label: "Limitação moderada", tipo: "warning" } : sppbTotal <= 9 ? { label: "Limitação leve", tipo: "warning" } : { label: "Desempenho preservado", tipo: "success" };
          return (
            <Alert type={nivel.tipo}>
              SPPB Total: {sppbTotal}/12 — {nivel.label}
              {sppbTotal <= 9 && " · Risco aumentado de incapacidade e mortalidade"}
            </Alert>
          );
        })()}
      </SectionCard>

      {/* SARC-F */}
      <SectionCard title="SARC-F — Rastreio de sarcopenia" icon="ti-activity" defaultOpen={false}>
        {(() => {
          const questoes = [
            { key: "sarcfForca", label: "Força: Quanta dificuldade para carregar 4,5 kg?", opts: [["0","Nenhuma"],["1","Alguma"],["2","Muita/incapaz"]] },
            { key: "sarcfCaminhada", label: "Caminhada: Quanta dificuldade para cruzar um cômodo?", opts: [["0","Nenhuma"],["1","Alguma"],["2","Muita/usa apoio/incapaz"]] },
            { key: "sarcfLevantarCadeira", label: "Levantar da cadeira: Quanta dificuldade?", opts: [["0","Nenhuma"],["1","Alguma"],["2","Muita/incapaz sem ajuda"]] },
            { key: "sarcfEscadas", label: "Subir 10 degraus: Quanta dificuldade?", opts: [["0","Nenhuma"],["1","Alguma"],["2","Muita/incapaz"]] },
            { key: "sarcfQuedas", label: "Quedas: Quantas vezes caiu no último ano?", opts: [["0","Nenhuma"],["1","1–3 quedas"],["2","4 ou mais quedas"]] },
          ];
          const total = questoes.reduce((s, q) => s + (parseInt(aga[q.key]) || 0), 0);
          const positivo = total >= 4;
          return (
            <div>
              {questoes.map(q => (
                <Field key={q.key} label={q.label}>
                  <select value={aga[q.key] ?? ""} onChange={e => set(q.key, e.target.value)}>
                    <option value="">Selecione...</option>
                    {q.opts.map(([v, l]) => <option key={v} value={v}>{l} ({v} pt)</option>)}
                  </select>
                </Field>
              ))}
              {questoes.some(q => aga[q.key] !== undefined && aga[q.key] !== "") && (
                <Alert type={positivo ? "warning" : "success"}>
                  SARC-F: {total}/10 — {positivo ? "⚠ Rastreio POSITIVO para sarcopenia (≥4 pontos) — confirmar com força de preensão e circunferência de panturrilha" : "Rastreio negativo (<4 pontos)"}
                </Alert>
              )}
            </div>
          );
        })()}
      </SectionCard>

      <SectionCard title="Nutrição" icon="ti-apple">
        {/* MNA-SF integrado */}
        <SectionCard title="MNA-SF — Mini Avaliação Nutricional" icon="ti-salad" defaultOpen={false}>
          {(() => {
            const imc = parseFloat(calcIMC(aga.peso, aga.altura));
            const questoes = [
              { key: "mnaPerdaApetite", label: "A) Ingestão alimentar diminuiu nos últimos 3 meses por falta de apetite, problemas digestivos ou dificuldade de mastigar/deglutir?", opts: [["0","Diminuição acentuada"],["1","Diminuição moderada"],["2","Sem diminuição"]] },
              { key: "mnaPerdaPeso", label: "B) Perda de peso nos últimos 3 meses?", opts: [["0",">3 kg"],["1","Não sabe"],["2","Entre 1–3 kg"],["3","Sem perda"]] },
              { key: "mnaMobilidade", label: "C) Mobilidade?", opts: [["0","Acamado ou cadeira de rodas"],["1","Levanta mas não sai de casa"],["2","Sai de casa"]] },
              { key: "mnaEstresse", label: "D) Estresse psicológico ou doença aguda nos últimos 3 meses?", opts: [["0","Sim"],["2","Não"]] },
              { key: "mnaCognicao", label: "E) Problemas neuropsicológicos?", opts: [["0","Demência ou depressão grave"],["1","Demência leve"],["2","Sem problemas"]] },
            ];
            const qImc = !isNaN(imc) ? (imc < 19 ? 0 : imc < 21 ? 1 : imc < 23 ? 2 : 3) : null;
            const total = questoes.reduce((s, q) => s + (parseInt(aga[q.key]) || 0), 0) + (qImc !== null ? qImc : 0);
            const status = total <= 7 ? { label: "Desnutrição", tipo: "danger" } : total <= 11 ? { label: "Risco de desnutrição", tipo: "warning" } : { label: "Estado nutricional normal", tipo: "success" };
            return (
              <div>
                {questoes.map(q => (
                  <Field key={q.key} label={q.label}>
                    <select value={aga[q.key] ?? ""} onChange={e => set(q.key, e.target.value)}>
                      <option value="">Selecione...</option>
                      {q.opts.map(([v, l]) => <option key={v} value={v}>{l} ({v} pt)</option>)}
                    </select>
                  </Field>
                ))}
                <Field label="F) IMC (calculado automaticamente)">
                  <div style={{ fontSize: "13px", padding: "6px 0" }}>
                    {!isNaN(imc) ? `IMC ${imc} → ${qImc} ponto(s)` : "Preencha peso e altura para calcular"}
                  </div>
                </Field>
                {questoes.some(q => aga[q.key] !== undefined && aga[q.key] !== "") && (
                  <Alert type={status.tipo}>MNA-SF: {total}/14 — {status.label}</Alert>
                )}
              </div>
            );
          })()}
        </SectionCard>
        <Row cols="repeat(4, 1fr)">
          <Field label="Peso atual (kg)"><input type="number" value={aga.peso || ""} onChange={e => set("peso", e.target.value)} /></Field>
          <Field label="Peso habitual (kg)"><input type="number" value={aga.pesoHabitual || ""} onChange={e => set("pesoHabitual", e.target.value)} /></Field>
          <Field label="Altura (m)"><input type="number" step="0.01" value={aga.altura || ""} onChange={e => set("altura", e.target.value)} /></Field>
          <Field label="IMC calculado" hint={imcLabel}>
            <input value={imc || ""} disabled style={{ background: "var(--color-background-secondary)" }} />
          </Field>
        </Row>
        <Field label="Perda de peso não intencional?">
          <RadioGroup name="perdapeso" value={aga.perdaPeso} onChange={v => set("perdaPeso", v)} options={[{value:"nao",label:"Não"},{value:"sim",label:"Sim"}]} />
        </Field>
        {aga.perdaPeso === "sim" && (
          <Row cols="repeat(2, 1fr)">
            <Field label="Quanto (kg)?"><input type="number" value={aga.perdaPesoKg || ""} onChange={e => set("perdaPesoKg", e.target.value)} /></Field>
            <Field label="Em quanto tempo?"><input value={aga.perdaPesoTempo || ""} onChange={e => set("perdaPesoTempo", e.target.value)} placeholder="ex: 3 meses, 1 ano..." /></Field>
          </Row>
        )}
        <Row>
          <Field label="Apetite"><RadioGroup name="apetite" value={aga.apetite} onChange={v => set("apetite", v)} options={[{value:"preservado",label:"Preservado"},{value:"reduzido",label:"Reduzido"},{value:"aumentado",label:"Aumentado"}]} /></Field>
          <Field label="Disfagia"><RadioGroup name="disfagia" value={aga.disfagia} onChange={v => set("disfagia", v)} options={[{value:"ausente",label:"Ausente"},{value:"presente",label:"Presente"}]} /></Field>
        </Row>
        {aga.disfagia === "presente" && (
          <Field label="Tipo de dieta"><input value={aga.disfagiaDieta || ""} onChange={e => set("disfagiaDieta", e.target.value)} placeholder="ex: pastosa, líquidos espessados" /></Field>
        )}
        <Row cols="repeat(2, 1fr)">
          <div>
            <Field label="Problemas dentários?"><RadioGroup name="dentarios" value={aga.problemasDentarios} onChange={v => set("problemasDentarios", v)} options={[{value:"nao",label:"Não"},{value:"sim",label:"Sim"}]} /></Field>
            {aga.problemasDentarios === "sim" && (
              <Field label="Descreva">
                <textarea rows={2} value={aga.problemasDentariosDes || ""} onChange={e => set("problemasDentariosDes", e.target.value)} placeholder="ex: cáries, edentado, dor..." />
              </Field>
            )}
          </div>
          <Field label="Prótese dentária?"><RadioGroup name="protese" value={aga.proteseDentaria} onChange={v => set("proteseDentaria", v)} options={[{value:"nao",label:"Não"},{value:"sim",label:"Sim"}]} /></Field>
        </Row>
        <Row>
          <Field label="Teste de força de preensão palmar (kgf)" hint={alertaForca ? "⚠ Abaixo do esperado — critério para sarcopenia" : (sexoPaciente === "M" ? "Normal: ≥ 27 kgf (homens)" : "Normal: ≥ 16 kgf (mulheres)")}>
            <input value={aga.testeForca || ""} onChange={e => set("testeForca", e.target.value)} style={alertaForca ? { borderColor: "var(--color-border-warning)" } : {}} />
          </Field>
          <Field label="Circunferência da panturrilha (cm)" hint={alertaCirc ? "⚠ < 31 cm — critério para sarcopenia" : "Normal: ≥ 31 cm"}>
            <input value={aga.circPanturrilha || ""} onChange={e => set("circPanturrilha", e.target.value)} style={alertaCirc ? { borderColor: "var(--color-border-warning)" } : {}} />
          </Field>
          <Field label="Atividade física"><input value={aga.atividadeFisica || ""} onChange={e => set("atividadeFisica", e.target.value)} placeholder="ex: caminhada 3x/semana..." /></Field>
        </Row>
        {alertaSarcopenia && (
          <div style={{ background: "var(--color-background-warning)", border: "0.5px solid var(--color-border-warning)", borderRadius: "8px", padding: "10px 14px", fontSize: "13px", color: "var(--color-text-warning)", marginTop: "4px" }}>
            ⚠ <strong>Possível sarcopenia:</strong> {alertaForca ? `Força de preensão palmar abaixo do ponto de corte (${sexoPaciente === "M" ? "< 27 kgf em homens" : "< 16 kgf em mulheres"})` : ""}{alertaForca && alertaCirc ? " · " : ""}{alertaCirc ? "Circunferência de panturrilha < 31 cm" : ""}. Considere avaliação complementar (velocidade de marcha, SPPB, BIA).
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function addMonths(dateStr, months) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  // Proteção contra valores intermediários inválidos vindos do <input type="date">
  // (alguns navegadores disparam onChange enquanto o usuário ainda está digitando o ano,
  // ex: ao teclar "2026" caractere por caractere, pode passar por "0002", "0020" etc.)
  if (d.getFullYear() < 2015 || d.getFullYear() > 2100) return "";
  const originalDay = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDayOfTargetMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(originalDay, lastDayOfTargetMonth));
  return d.toISOString().slice(0, 10);
}

function addYears(dateStr, years) {
  return addMonths(dateStr, years * 12);
}

// Mapeia, para cada vacina e campo de "dose anterior", qual campo de "próxima dose" deve
// ser sugerido automaticamente e com qual intervalo (em meses).
const VACINA_SUGESTOES = {
  influenza: { dose: { campoDestino: "reforco", meses: 12 } },
  covid: { dose: { campoDestino: "reforco", meses: 6 } },
  pneumo: { vpc13: { campoDestino: "vpp23_1", meses: 2 }, vpp23_1: { campoDestino: "vpp23_2", meses: 60 } },
  dtpa: { dt1: { campoDestino: "dt2", meses: 2 }, dt2: { campoDestino: "dtpa1", meses: 2 }, dtpa1: { campoDestino: "reforco", meses: 120 } },
  hepB: { dose1: { campoDestino: "dose2", meses: 1 }, dose2: { campoDestino: "dose3", meses: 5 } },
  vzr: { dose1: { campoDestino: "dose2", meses: 2 } },
};

function PrevencaoTab({ patient, consulta, updateConsulta }) {
  const vac = consulta.vacinas || {};
  const setVacField = (nome, campo, v) => {
    updateConsulta(p => {
      const vacinaAtual = { ...((p.vacinas || {})[nome] || {}), [campo]: v };
      const sugestao = VACINA_SUGESTOES[nome] && VACINA_SUGESTOES[nome][campo];
      const dataValida = v && /^\d{4}-\d{2}-\d{2}$/.test(v) && parseInt(v.slice(0, 4), 10) >= 2015;
      if (sugestao && dataValida && !vacinaAtual[sugestao.campoDestino]) {
        const sugerida = addMonths(v, sugestao.meses);
        if (sugerida) vacinaAtual[sugestao.campoDestino] = sugerida;
      }
      return { ...p, vacinas: { ...p.vacinas, [nome]: vacinaAtual } };
    });
  };
  const rg = consulta.rastreioGeral || {};
  const addRgRegistro = (nome) => updateConsulta(p => {
    const atuais = Array.isArray((p.rastreioGeral || {})[nome]) ? p.rastreioGeral[nome] : [];
    return { ...p, rastreioGeral: { ...p.rastreioGeral, [nome]: [...atuais, { id: uid(), data: "", resultado: "" }] } };
  });
  const setRgRegistro = (nome, registroId, campo, v) => updateConsulta(p => {
    const atuais = Array.isArray((p.rastreioGeral || {})[nome]) ? p.rastreioGeral[nome] : [];
    return { ...p, rastreioGeral: { ...p.rastreioGeral, [nome]: atuais.map(r => r.id === registroId ? { ...r, [campo]: v } : r) } };
  });
  const removeRgRegistro = (nome, registroId) => updateConsulta(p => {
    const atuais = Array.isArray((p.rastreioGeral || {})[nome]) ? p.rastreioGeral[nome] : [];
    return { ...p, rastreioGeral: { ...p.rastreioGeral, [nome]: atuais.filter(r => r.id !== registroId) } };
  });

  const re = consulta.rastreioEspecifico || {};
  const addReRegistro = (key) => updateConsulta(p => {
    const atuais = Array.isArray((p.rastreioEspecifico || {})[key]) ? p.rastreioEspecifico[key] : [];
    return { ...p, rastreioEspecifico: { ...p.rastreioEspecifico, [key]: [...atuais, { id: uid(), data: "", resultado: "" }] } };
  });
  const setReRegistro = (key, registroId, campo, v) => updateConsulta(p => {
    const atuais = Array.isArray((p.rastreioEspecifico || {})[key]) ? p.rastreioEspecifico[key] : [];
    return { ...p, rastreioEspecifico: { ...p.rastreioEspecifico, [key]: atuais.map(r => r.id === registroId ? { ...r, [campo]: v } : r) } };
  });
  const removeReRegistro = (key, registroId) => updateConsulta(p => {
    const atuais = Array.isArray((p.rastreioEspecifico || {})[key]) ? p.rastreioEspecifico[key] : [];
    return { ...p, rastreioEspecifico: { ...p.rastreioEspecifico, [key]: atuais.filter(r => r.id !== registroId) } };
  });

  const ativos = PROBLEMAS.filter(p => consulta.problemas && consulta.problemas[p] && PREVENCAO_ESPECIFICA[p]);

  const sexoPaciente = patient?.ident?.sexo;
  const tabagismoAtual = consulta.antecedentes?.tabagismo;
  const ehTabagista = tabagismoAtual === "Ex-tabagista" || tabagismoAtual === "Tabagista atual";
  const rastreioGeralVisivel = RASTREIO_GERAL.filter(r => {
    if (r.sexo && sexoPaciente && r.sexo !== sexoPaciente) return false;
    if (r.requerTabagismo && !ehTabagista) return false;
    return true;
  });

  return (
    <div>
      <SectionCard title="Prevenção — rastreio geral" icon="ti-shield-check" defaultOpen={true}>
        {rastreioGeralVisivel.map(r => {
          const registros = Array.isArray(rg[r.nome]) ? rg[r.nome] : [];
          return (
            <div key={r.nome} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)", padding: "10px 0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                <div>
                  <div style={{ fontWeight: 500, fontSize: "14px" }}>{r.nome}</div>
                  <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>{r.criterio}</div>
                </div>
                <button onClick={() => addRgRegistro(r.nome)} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", padding: "4px 8px" }}>
                  <i className="ti ti-plus" aria-hidden="true"></i>Adicionar registro
                </button>
              </div>
              {registros.length === 0 && <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", margin: "4px 0" }}>Nenhum registro ainda.</p>}
              {registros.map((reg, idx) => (
                <div key={reg.id} style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-start", marginBottom: "8px", paddingLeft: "8px", borderLeft: "2px solid var(--color-border-tertiary)" }}>
                  <Field label={`Realizado em (registro ${idx + 1})`}><input type="date" value={reg.data || ""} onChange={e => setRgRegistro(r.nome, reg.id, "data", e.target.value)} /></Field>
                  <div style={{ flex: "1 1 240px" }}>
                    <Field label="Resultado"><textarea rows={3} value={reg.resultado || ""} onChange={e => setRgRegistro(r.nome, reg.id, "resultado", e.target.value)} /></Field>
                  </div>
                  <button onClick={() => removeRgRegistro(r.nome, reg.id)} aria-label="Remover registro" style={{ marginTop: "20px" }}><i className="ti ti-trash" aria-hidden="true"></i></button>
                </div>
              ))}
              {r.nome === "Densitometria óssea" && (
                <div style={{ marginTop: "10px" }}>
                  <FraxCalc consulta={consulta} patient={patient} />
                </div>
              )}
            </div>
          );
        })}
      </SectionCard>

      <SectionCard title="Prevenção específica por comorbidade ativa" icon="ti-stethoscope">
        {ativos.length === 0 && <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>Nenhuma comorbidade com rastreio específico foi marcada na aba Lista de problemas.</p>}
        {ativos.map(comorbidade => (
          <div key={comorbidade} style={{ marginBottom: "14px" }}>
            <div style={{ fontWeight: 500, fontSize: "14px", color: "var(--color-text-info)", marginBottom: "6px" }}>{comorbidade}</div>
            {PREVENCAO_ESPECIFICA[comorbidade].map(item => {
              const key = comorbidade + "::" + item;
              const registros = Array.isArray(re[key]) ? re[key] : [];
              return (
                <div key={key} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)", padding: "8px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                    <div style={{ fontSize: "13px" }}>{item}</div>
                    <button onClick={() => addReRegistro(key)} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", padding: "4px 8px" }}>
                      <i className="ti ti-plus" aria-hidden="true"></i>Adicionar registro
                    </button>
                  </div>
                  {registros.length === 0 && <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", margin: "4px 0" }}>Nenhum registro ainda.</p>}
                  {registros.map((reg, idx) => (
                    <div key={reg.id} style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-start", marginBottom: "8px", paddingLeft: "8px", borderLeft: "2px solid var(--color-border-tertiary)" }}>
                      <Field label={`Data (registro ${idx + 1})`}><input type="date" value={reg.data || ""} onChange={e => setReRegistro(key, reg.id, "data", e.target.value)} /></Field>
                      <div style={{ flex: "1 1 240px" }}>
                        <Field label="Resultado"><textarea rows={3} value={reg.resultado || ""} onChange={e => setReRegistro(key, reg.id, "resultado", e.target.value)} /></Field>
                      </div>
                      <button onClick={() => removeReRegistro(key, reg.id)} aria-label="Remover registro" style={{ marginTop: "20px" }}><i className="ti ti-trash" aria-hidden="true"></i></button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </SectionCard>
      <SectionCard title="Situação vacinal" icon="ti-vaccine">
        <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: 0 }}>Campos de data conforme o esquema completo de cada vacina (calendário de vacinação do idoso). Ao preencher uma dose, a próxima data é sugerida automaticamente — você pode ajustar livremente.</p>

        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontWeight: 500, fontSize: "14px", marginBottom: "6px" }}>Influenza (dose anual)</div>
          <Row cols="repeat(2, 1fr)">
            <Field label="Última dose"><input type="date" value={vac.influenza?.dose || ""} onChange={e => setVacField("influenza", "dose", e.target.value)} /></Field>
            <Field label="Próximo reforço (sugerido)"><input type="date" value={vac.influenza?.reforco || ""} onChange={e => setVacField("influenza", "reforco", e.target.value)} /></Field>
          </Row>
        </div>

        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontWeight: 500, fontSize: "14px", marginBottom: "6px" }}>COVID-19 (reforço a cada 6 meses)</div>
          <Row cols="repeat(2, 1fr)">
            <Field label="Dose"><input type="date" value={vac.covid?.dose || ""} onChange={e => setVacField("covid", "dose", e.target.value)} /></Field>
            <Field label="Próximo reforço (sugerido, 6 meses)"><input type="date" value={vac.covid?.reforco || ""} onChange={e => setVacField("covid", "reforco", e.target.value)} /></Field>
          </Row>
        </div>

        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontWeight: 500, fontSize: "14px", marginBottom: "6px" }}>Pneumocócica</div>
          <Field label="VPC20 (dose única)"><input type="date" value={vac.pneumo?.vpc20 || ""} onChange={e => setVacField("pneumo", "vpc20", e.target.value)} /></Field>
          <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "0 0 8px" }}>Se indisponibilidade de VPC20:</p>
          <Row cols="repeat(3, 1fr)">
            <Field label="VPC13/15"><input type="date" value={vac.pneumo?.vpc13 || ""} onChange={e => setVacField("pneumo", "vpc13", e.target.value)} /></Field>
            <Field label="VPP23 (sugerido, após 2m)"><input type="date" value={vac.pneumo?.vpp23_1 || ""} onChange={e => setVacField("pneumo", "vpp23_1", e.target.value)} /></Field>
            <Field label="VPP23 (sugerido, reforço 5a)"><input type="date" value={vac.pneumo?.vpp23_2 || ""} onChange={e => setVacField("pneumo", "vpp23_2", e.target.value)} /></Field>
          </Row>
        </div>

        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontWeight: 500, fontSize: "14px", marginBottom: "6px" }}>dT / dTpa</div>
          <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "0 0 8px" }}>Sem esquema prévio:</p>
          <Row cols="repeat(3, 1fr)">
            <Field label="dT (1ª dose)"><input type="date" value={vac.dtpa?.dt1 || ""} onChange={e => setVacField("dtpa", "dt1", e.target.value)} /></Field>
            <Field label="dT (sugerido, após 2m)"><input type="date" value={vac.dtpa?.dt2 || ""} onChange={e => setVacField("dtpa", "dt2", e.target.value)} /></Field>
            <Field label="dTpa (sugerido, após 2m da última)"><input type="date" value={vac.dtpa?.dtpa1 || ""} onChange={e => setVacField("dtpa", "dtpa1", e.target.value)} /></Field>
          </Row>
          <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "8px 0" }}>Com esquema prévio:</p>
          <Field label="dTpa (reforço sugerido a cada 10 anos)"><input type="date" value={vac.dtpa?.reforco || ""} onChange={e => setVacField("dtpa", "reforco", e.target.value)} /></Field>
        </div>

        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontWeight: 500, fontSize: "14px", marginBottom: "6px" }}>Hepatite B</div>
          <Row cols="repeat(3, 1fr)">
            <Field label="1ª dose"><input type="date" value={vac.hepB?.dose1 || ""} onChange={e => setVacField("hepB", "dose1", e.target.value)} /></Field>
            <Field label="2ª dose (sugerido, após 1 mês)"><input type="date" value={vac.hepB?.dose2 || ""} onChange={e => setVacField("hepB", "dose2", e.target.value)} /></Field>
            <Field label="3ª dose (sugerido, após 6 meses da 1ª)"><input type="date" value={vac.hepB?.dose3 || ""} onChange={e => setVacField("hepB", "dose3", e.target.value)} /></Field>
          </Row>
        </div>

        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontWeight: 500, fontSize: "14px", marginBottom: "6px" }}>Vírus sincicial respiratório (VSR) — dose única</div>
          <Field label="Dose"><input type="date" value={vac.vsr?.dose || ""} onChange={e => setVacField("vsr", "dose", e.target.value)} /></Field>
        </div>

        <div>
          <div style={{ fontWeight: 500, fontSize: "14px", marginBottom: "6px" }}>Herpes-zóster (VZR recombinante)</div>
          <Row cols="repeat(2, 1fr)">
            <Field label="1ª dose"><input type="date" value={vac.vzr?.dose1 || ""} onChange={e => setVacField("vzr", "dose1", e.target.value)} /></Field>
            <Field label="2ª dose (sugerido, após 2 meses)"><input type="date" value={vac.vzr?.dose2 || ""} onChange={e => setVacField("vzr", "dose2", e.target.value)} /></Field>
          </Row>
        </div>
      </SectionCard>
    </div>
  );
}

function ExameTab({ consulta, updateConsulta, patient, todasConsultas }) {
  const e = consulta.exameFisico || {};
  const set = (k, v) => updateConsulta(p => ({ ...p, exameFisico: { ...p.exameFisico, [k]: v } }));
  const sexo = patient?.ident?.sexo;
  const F = sexo === "F";

  // Consulta anterior para copiar exame físico
  const consultaAnterior = (() => {
    if (!todasConsultas) return null;
    const sorted = [...todasConsultas].filter(c => !c.deletedAt && c.id !== consulta.id).sort((a, b) => new Date(b.data) - new Date(a.data));
    return sorted[0] || null;
  })();

  function copiarExameFisico() {
    if (!consultaAnterior?.exameFisico) return;
    const { peso, hgt, paSentado, paEmPe, fc, sato2, fr, temp, eva, ...segmentar } = consultaAnterior.exameFisico;
    // Copia apenas o segmentar (não copia sinais vitais)
    updateConsulta(p => ({ ...p, exameFisico: { ...p.exameFisico, ...segmentar } }));
  }

  // Perfil do paciente para metas
  const aga = consulta.aga || {};
  const frailScore = Object.values(aga.frail || {}).filter(Boolean).length;
  const ehFragil = frailScore >= 3;
  const ativos = PROBLEMAS.filter(p => consulta.problemas && consulta.problemas[p]);
  const nComorbidades = ativos.length + (consulta.problemasCustom || []).filter(c => c.checked).length;
  const ehMultimorbido = nComorbidades >= 3;
  const idade = calcIdade(patient?.ident?.dn);
  const idade80 = idade != null && idade >= 80;

  // Meta de PA
  let metaPA, perfilPA;
  if (ehFragil) {
    metaPA = "< 150/90 mmHg"; perfilPA = "Idoso frágil";
  } else if (idade80) {
    metaPA = "< 140/90 mmHg"; perfilPA = "Idoso ≥ 80 anos";
  } else {
    metaPA = "< 130/80 mmHg"; perfilPA = "Idoso robusto";
  }

  // Verifica PA atual e rastreio de HAS secundária
  const paValor = e.paSentado || "";
  let alertaPA = null;
  let alertaHASSecundaria = false;
  if (paValor) {
    const match = paValor.match(/(\d+)\s*[xX\/]\s*(\d+)/);
    if (match) {
      const sis = parseInt(match[1]);
      const dia = parseInt(match[2]);
      const metaMatch = metaPA.match(/(\d+)\/(\d+)/);
      if (metaMatch) {
        const metaSis = parseInt(metaMatch[1]);
        const metaDia = parseInt(metaMatch[2]);
        if (sis >= metaSis || dia >= metaDia) {
          alertaPA = `⚠ PA acima da meta para ${perfilPA}: ${metaPA}`;
          // Alerta de rastreio de HAS secundária se for hipertenso com PA fora da meta
          if (consulta.problemas?.["HAS"]) alertaHASSecundaria = true;
        }
      }
    }
  }

  const geralPadrao = F
    ? "EG bom, consciente, orientada, eupneica, corada, hidratada, anictérica, acianótica, afebril ao toque."
    : "EG bom, consciente, orientado, eupneico, corado, hidratado, anictérico, acianótico, afebril ao toque.";
  const acvPadrao = "RCR em 2T, BNF, S/S.";
  const arPadrao = "MV+ em AHT, S/RA.";
  const abdPadrao = "Semigloboso, depressível, normotimpânico, indolor à palpação superficial e profunda, sem VMG ou massas palpáveis, RHA+.";
  const extPadrao = "Sem edemas, TEC 2s, panturrilhas livres.";
  const snPadrao = F
    ? "Glasgow 15, PIFR, sem déficits focais, sem sinais meníngeos."
    : "Glasgow 15, PIFR, sem déficits focais, sem sinais meníngeos.";
  const pelePadrao = F
    ? "Normocorada, hidratada, íntegra."
    : "Xerótica, íntegra.";

  const campos = [
    ["geral", "Geral", geralPadrao],
    ["acv", "ACV", acvPadrao],
    ["ar", "AR", arPadrao],
    ["abd", "ABD", abdPadrao],
    ["ext", "EXT", extPadrao],
    ["sn", "SN", snPadrao],
    ["pele", "Pele", pelePadrao],
    ["outros", "Outros", ""],
  ];

  return (
    <div>
      <SectionCard title="Sinais vitais" icon="ti-heartbeat">
        <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "8px", padding: "6px 10px", background: "var(--color-background-secondary)", borderRadius: "6px" }}>
          🎯 <strong>Meta de PA ({perfilPA}):</strong> {metaPA}
        </div>
        {alertaPA && <Alert type="warning">{alertaPA}</Alert>}
        {alertaHASSecundaria && (
          <div style={{ background: "var(--color-background-warning)", border: "0.5px solid var(--color-border-warning)", borderRadius: "8px", padding: "12px 14px", fontSize: "13px", marginBottom: "10px" }}>
            <div style={{ fontWeight: 700, color: "var(--color-text-warning)", marginBottom: "8px" }}>
              ⚠ Considerar rastreio de Hipertensão Arterial Secundária
            </div>
            <div style={{ color: "var(--color-text-primary)", lineHeight: 1.7 }}>
              <div style={{ fontWeight: 600, marginBottom: "2px" }}>📋 Investigação inicial:</div>
              <div>• Ur, Cr, Na, K, Ca, PTH, Vit D, EAS, RAC (relação albumina/creatinina), USG rins e VVUU</div>
              <div>• TSH, T4 livre</div>
              <div style={{ fontWeight: 600, marginTop: "6px", marginBottom: "2px" }}>📋 Hiperaldosteronismo primário:</div>
              <div>• Aldosterona plasmática, Atividade de renina plasmática, Relação aldosterona/renina</div>
              <div style={{ fontWeight: 600, marginTop: "6px", marginBottom: "2px" }}>📋 Feocromocitoma:</div>
              <div>• Metanefrinas plasmáticas ou urinárias de 24h</div>
              <div style={{ fontWeight: 600, marginTop: "6px", marginBottom: "2px" }}>📋 HAS renovascular:</div>
              <div>• Doppler de artérias renais</div>
              <div style={{ fontWeight: 600, marginTop: "6px", marginBottom: "2px" }}>📋 Síndrome da Apneia Obstrutiva do Sono (SAOS):</div>
              <div>• Polissonografia</div>
              <div style={{ fontWeight: 600, marginTop: "6px", marginBottom: "2px" }}>📋 Síndrome de Cushing:</div>
              <div>• Cortisol sérico 8–9h após supressão com Dexametasona 1mg às 23h</div>
            </div>
          </div>
        )}
        <Row cols="repeat(3, 1fr)">
          <Field label="PA sentado (mmHg)"><input value={e.paSentado || ""} onChange={ev => set("paSentado", ev.target.value)} placeholder="ex: 130/80" /></Field>
          <Field label="PA em pé após 3 min (mmHg)" hint="Triagem de hipotensão ortostática"><input value={e.paEmPe || ""} onChange={ev => set("paEmPe", ev.target.value)} placeholder="ex: 120/75" /></Field>
          <Field label="FC (bpm)"><input value={e.fc || ""} onChange={ev => set("fc", ev.target.value)} /></Field>
        </Row>
        <Row cols="repeat(3, 1fr)">
          <Field label="SatO2 (%)"><input value={e.sato2 || ""} onChange={ev => set("sato2", ev.target.value)} /></Field>
          <Field label="FR (irpm)"><input value={e.fr || ""} onChange={ev => set("fr", ev.target.value)} /></Field>
          <Field label="Temp (°C)"><input value={e.temp || ""} onChange={ev => set("temp", ev.target.value)} /></Field>
        </Row>
        <Row cols="repeat(2, 1fr)">
          <Field label="Peso (kg)" hint="Aferido na consulta"><input value={e.peso || ""} onChange={ev => set("peso", ev.target.value)} /></Field>
          <Field label="HGT (mg/dL)"><input value={e.hgt || ""} onChange={ev => set("hgt", ev.target.value)} /></Field>
        </Row>
        <Field label="Dor (EVA 0–10)" hint="0 = sem dor · 10 = pior dor imaginável">
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <input
              type="number" min="0" max="10" step="1"
              value={e.eva ?? ""}
              onChange={ev => {
                const v = ev.target.value;
                if (v === "" || (parseInt(v) >= 0 && parseInt(v) <= 10)) set("eva", v);
              }}
              style={{ maxWidth: "80px", fontSize: "18px", fontWeight: 700, textAlign: "center" }}
            />
            {e.eva !== "" && e.eva !== undefined && (
              <span style={{
                fontSize: "13px", fontWeight: 600,
                color: e.eva >= 7 ? "var(--color-text-danger)" : e.eva >= 4 ? "var(--color-text-warning)" : "var(--color-text-success)"
              }}>
                {e.eva >= 7 ? "Dor intensa" : e.eva >= 4 ? "Dor moderada" : e.eva > 0 ? "Dor leve" : "Sem dor"}
              </span>
            )}
          </div>
        </Field>
        {(() => {
          // Hipotensão ortostática: queda ≥ 20 sistólica ou ≥ 10 diastólica
          const mSentado = (e.paSentado || "").match(/(\d+)\s*[xX\/]\s*(\d+)/);
          const mEmp = (e.paEmPe || "").match(/(\d+)\s*[xX\/]\s*(\d+)/);
          if (!mSentado || !mEmp) return null;
          const quedaSis = parseInt(mSentado[1]) - parseInt(mEmp[1]);
          const quedaDia = parseInt(mSentado[2]) - parseInt(mEmp[2]);
          if (quedaSis >= 20 || quedaDia >= 10) {
            return (
              <div style={{ background: "var(--color-background-danger)", border: "0.5px solid var(--color-border-danger)", borderRadius: "8px", padding: "10px 14px", fontSize: "13px", marginBottom: "10px" }}>
                <div style={{ fontWeight: 700, color: "var(--color-text-danger)", marginBottom: "4px" }}>
                  ⚠ Hipotensão Ortostática detectada
                </div>
                <div>Queda de {quedaSis > 0 ? quedaSis : 0} mmHg sistólica e {quedaDia > 0 ? quedaDia : 0} mmHg diastólica ao ortostatismo.</div>
                <div style={{ marginTop: "6px", fontSize: "12px" }}>
                  <strong>Causas a investigar:</strong> hipovolemia, medicamentos (anti-hipertensivos, diuréticos, alfa-bloqueadores, antidepressivos), neuropatia autonômica, Parkinson, insuficiência adrenal.<br />
                  <strong>Conduta:</strong> revisar medicações, orientar hidratação, levantar devagar, meias de compressão, elevar cabeceira da cama 30°.
                </div>
              </div>
            );
          }
          return null;
        })()}
      </SectionCard>
      <SectionCard title="Exame físico segmentar" icon="ti-stethoscope">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", margin: 0 }}>
            Achados padrão pré-preenchidos conforme sexo {sexo ? `(${F ? "Feminino" : "Masculino"})` : "— informe o sexo na aba Identificação"} — edite conforme o exame real.
          </p>
          {consultaAnterior?.exameFisico && (
            <button onClick={copiarExameFisico} style={{ fontSize: "12px", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "4px", padding: "4px 10px" }}>
              <i className="ti ti-copy" aria-hidden="true"></i>Sem novidades (copiar anterior)
            </button>
          )}
        </div>
        {campos.map(([k, label, padrao]) => (
          <Field key={k} label={label}>
            <textarea rows={2} value={e[k] !== undefined ? e[k] : padrao} onChange={ev => set(k, ev.target.value)} placeholder={k === "outros" ? "Outros achados relevantes..." : undefined} />
          </Field>
        ))}
      </SectionCard>
    </div>
  );
}

function ExamesTab({ consulta, updateConsulta, patient }) {
  // Perfil para meta de HbA1c
  const temDM2 = consulta.problemas?.["DM2"];
  const aga = consulta.aga || {};
  const frailScore = Object.values(aga.frail || {}).filter(Boolean).length;
  const ehFragil = frailScore >= 3;
  const ativos = PROBLEMAS.filter(p => consulta.problemas && consulta.problemas[p]);
  const nComorbidades = ativos.length + (consulta.problemasCustom || []).filter(c => c.checked).length;
  const ehMultimorbido = nComorbidades >= 3;
  const labs = consulta.labsTexto || "";
  const idade = calcIdade(patient?.ident?.dn);

  // ============================================================
  // ESTRATIFICAÇÃO DE RISCO CARDIOVASCULAR ESC + META DE LDL
  // ============================================================
  const temDAC   = ativos.includes("DAC");
  const temAVC   = ativos.includes("AVC");
  const temDAOP  = ativos.includes("DAOP");
  const temDRC   = ativos.includes("DRC");
  const temHAS   = ativos.includes("HAS");
  const temDislipi = ativos.includes("Dislipidemia");

  // Extrai TFG dos labs — ou calcula por CKD-EPI se tiver creatinina
  const mTFG = labs.match(/(?:tfg|tgf|egfr|taxa de filtra)[^\d]*(\d+)/i);
  let tfg = mTFG ? parseInt(mTFG[1]) : null;

  // CKD-EPI 2021 a partir da creatinina se TFG não estiver nos labs
  if (!tfg && idade) {
    const mCr = labs.match(/(?:cr(?:eatinina)?)[^\d]*(\d+[,.]\d+|\d+)/i);
    if (mCr) {
      const cr = parseFloat(mCr[1].replace(',', '.'));
      const sexo = patient?.ident?.sexo || "";
      if (cr > 0 && cr < 20) {
        // CKD-EPI 2021 (sem raça)
        const kappa = sexo === "F" ? 0.7 : 0.9;
        const alpha = sexo === "F" ? -0.241 : -0.302;
        const crK = cr / kappa;
        const tfgCalc = 142 *
          Math.pow(Math.min(crK, 1), alpha) *
          Math.pow(Math.max(crK, 1), -1.200) *
          Math.pow(0.9938, idade) *
          (sexo === "F" ? 1.012 : 1);
        tfg = Math.round(tfgCalc);
      }
    }
  }

  // Extrai LDL dos labs
  const mLDL = labs.match(/(?:ldl|ld)[^\d]*(\d+)/i);
  const ldlValor = mLDL ? parseInt(mLDL[1]) : null;

  // Extrai CT dos labs
  const mCT = labs.match(/(?:ct|col(?:esterol)?\s*total)[^\d]*(\d+)/i);
  const ctValor = mCT ? parseInt(mCT[1]) : null;

  // Extrai PA sistólica
  const ef = consulta.exameFisico || {};
  const mPA = (ef.paSentado || "").match(/(\d+)/);
  const PAS = mPA ? parseInt(mPA[1]) : null;

  // Estratificação ESC
  function estratificarRiscoESC() {
    // Muito alto risco
    if (temDAC || temAVC || temDAOP) return { nivel: "Muito alto risco", metaLDL: 55, cor: "danger", motivo: "ASCVD documentada (DAC/AVC/DAOP)" };
    if (temDM2 && (temDAC || temAVC || temDAOP)) return { nivel: "Muito alto risco", metaLDL: 55, cor: "danger", motivo: "DM2 com ASCVD" };
    if (tfg !== null && tfg < 30) return { nivel: "Muito alto risco", metaLDL: 55, cor: "danger", motivo: `DRC grave (TFG ${tfg} mL/min/1,73m²)` };
    if (ctValor !== null && ctValor > 310) return { nivel: "Muito alto risco", metaLDL: 55, cor: "danger", motivo: `CT muito elevado (${ctValor} mg/dL)` };
    if (ldlValor !== null && ldlValor > 190) return { nivel: "Muito alto risco", metaLDL: 55, cor: "danger", motivo: `LDL muito elevado (${ldlValor} mg/dL)` };
    if (PAS !== null && PAS >= 180) return { nivel: "Muito alto risco", metaLDL: 55, cor: "danger", motivo: `PA muito elevada (${ef.paSentado})` };

    // Alto risco
    if (temDM2 && (nComorbidades >= 3 || (idade && idade > 50))) return { nivel: "Alto risco", metaLDL: 70, cor: "warning", motivo: "DM2 com fatores de risco adicionais" };
    if (tfg !== null && tfg >= 30 && tfg < 60) return { nivel: "Alto risco", metaLDL: 70, cor: "warning", motivo: `DRC moderada (TFG ${tfg} mL/min/1,73m²)` };
    if (temHAS && nComorbidades >= 3) return { nivel: "Alto risco", metaLDL: 70, cor: "warning", motivo: "HAS com múltiplos fatores de risco" };

    // Moderado risco
    if (temDM2) return { nivel: "Moderado risco", metaLDL: 100, cor: "warning", motivo: "DM2 sem complicações" };
    if (nComorbidades >= 2) return { nivel: "Moderado risco", metaLDL: 100, cor: "warning", motivo: "Múltiplos fatores de risco" };

    // Baixo risco
    return { nivel: "Baixo risco", metaLDL: 116, cor: "success", motivo: "Sem fatores de risco maiores identificados" };
  }

  const riscoESC = (temDAC || temAVC || temDAOP || temDRC || temDM2 || temHAS || temDislipi || ldlValor || ctValor)
    ? estratificarRiscoESC() : null;

  // Alerta de LDL
  let alertaLDL = null;
  if (riscoESC && ldlValor !== null) {
    if (ldlValor >= riscoESC.metaLDL) {
      alertaLDL = { tipo: "warning", msg: `⚠ LDL ${ldlValor} mg/dL acima da meta para ${riscoESC.nivel}: < ${riscoESC.metaLDL} mg/dL` };
    } else {
      alertaLDL = { tipo: "success", msg: `✓ LDL ${ldlValor} mg/dL dentro da meta para ${riscoESC.nivel}: < ${riscoESC.metaLDL} mg/dL` };
    }
  }

  let metaHbA1c = null, perfilHbA1c = null;
  if (temDM2) {
    if (ehFragil || ehMultimorbido) {
      metaHbA1c = "< 8%"; perfilHbA1c = ehFragil ? "Idoso frágil" : "Idoso multimórbido";
    } else {
      metaHbA1c = "< 7–7,5%"; perfilHbA1c = "Idoso robusto";
    }
  }

  // Detecta HbA1c no texto de labs
  let alertaHbA1c = null;
  if (temDM2 && metaHbA1c) {
    const matchHb = labs.match(/(?:hba1c|glicada|hemoglobina glicada)[^0-9]*(\d+[,.]?\d*)\s*%?/i);
    if (matchHb) {
      const valor = parseFloat(matchHb[1].replace(',', '.'));
      const limite = ehFragil || ehMultimorbido ? 8.0 : 7.5;
      if (valor > limite) {
        alertaHbA1c = `⚠ HbA1c ${valor}% acima da meta para ${perfilHbA1c}: ${metaHbA1c}`;
      } else {
        alertaHbA1c = `✓ HbA1c ${valor}% dentro da meta para ${perfilHbA1c}: ${metaHbA1c}`;
      }
    }
  }

  // ============================================================
  // ALERTAS DE LABORATORIAIS ADICIONAIS
  // ============================================================
  const sexoPac = patient?.ident?.sexo || "";
  const alertasLabs = [];

  // Hemoglobina / Anemia
  const mHb = labs.match(/(?:hb|hemoglobina|hgb)(?:\s*[:=]?\s*)(\d+[,.]\d+|\d+)(?!\s*a1c|\s*glicada)/i);
  if (mHb) {
    const hb = parseFloat(mHb[1].replace(',', '.'));
    const limiteAnemia = sexoPac === "F" ? 12 : 13;
    if (hb < limiteAnemia) {
      const grau = hb < 8 ? "grave" : hb < 10 ? "moderada" : "leve";
      alertasLabs.push({
        tipo: hb < 10 ? "danger" : "warning",
        titulo: `⚠ Anemia ${grau} — Hb ${hb} g/dL (meta ≥ ${limiteAnemia} para ${sexoPac === "F" ? "mulheres" : "homens"})`,
        itens: [
          "Investigação: ferritina, ferro sérico, TIBC, B12, folato, reticulócitos, esfregaço",
          "Se Hb < 10: considerar investigação de sangramento oculto (PSO, EDA, colonoscopia)",
          "Atenção: anemia agrava fragilidade, quedas e insuficiência cardíaca",
        ]
      });
    }
  }

  // Sódio — hiponatremia
  const mNa = labs.match(/(?:na|s[oó]dio|na\+)(?:\s*[:=]?\s*)(\d+)/i);
  if (mNa) {
    const na = parseInt(mNa[1]);
    if (na < 135) {
      const grau = na < 125 ? "grave" : na < 130 ? "moderada" : "leve";
      alertasLabs.push({
        tipo: na < 125 ? "danger" : "warning",
        titulo: `⚠ Hiponatremia ${grau} — Na ${na} mEq/L (normal 135–145)`,
        itens: [
          "Causas comuns no idoso: diuréticos tiazídicos, ISRS, desmopressina, hipotireoidismo",
          "Investigar: osmolalidade sérica e urinária, sódio urinário, TSH",
          na < 125 ? "⚠ Hiponatremia grave — risco de convulsão e herniação cerebral, avaliar internação" : "Corrigir lentamente (máx 8–10 mEq/L em 24h)",
        ]
      });
    }
  }

  // Potássio — hipercalemia e hipocalemia
  const mK = labs.match(/(?:k|pot[aá]ssio|k\+)(?:\s*[:=]?\s*)(\d+[,.]\d+|\d+)/i);
  if (mK) {
    const k = parseFloat(mK[1].replace(',', '.'));
    if (k > 5.5) {
      alertasLabs.push({
        tipo: k > 6.5 ? "danger" : "warning",
        titulo: `⚠ Hipercalemia — K ${k} mEq/L (normal 3,5–5,0)`,
        itens: [
          "Causas: IECA, BRA, espironolactona, AINEs, DRC",
          k > 6.5 ? "⚠ Hipercalemia grave — risco de arritmia, ECG imediato" : "Revisar medicações hipercalemiantes",
          "Tríplice whammy (IECA+AINE+diurético) aumenta risco — revisar prescrição",
        ]
      });
    } else if (k < 3.5) {
      alertasLabs.push({
        tipo: k < 3.0 ? "danger" : "warning",
        titulo: `⚠ Hipocalemia — K ${k} mEq/L (normal 3,5–5,0)`,
        itens: [
          "Causas: furosemida, tiazídicos, diarreia, hiperaldosteronismo",
          "Repor potássio VO ou EV conforme gravidade",
          "Atenção: hipocalemia potencializa toxicidade da digoxina",
        ]
      });
    }
  }

  // Vitamina B12
  const mB12 = labs.match(/(?:b12|vitamina\s*b12|cobalamina)(?:\s*[:=]?\s*)(\d+)/i);
  if (mB12) {
    const b12 = parseInt(mB12[1]);
    if (b12 < 300) {
      alertasLabs.push({
        tipo: b12 < 150 ? "danger" : "warning",
        titulo: `⚠ Vitamina B12 baixa — ${b12} pg/mL (referência ≥ 300)`,
        itens: [
          "Risco de neuropatia periférica, declínio cognitivo e anemia megaloblástica",
          "Causas: metformina, IBP prolongado, gastrite atrófica, dieta vegetariana",
          "Repor: cianocobalamina 1000 mcg/dia VO por 30 dias, depois manutenção",
          "Solicitar folato sérico e homocisteína se disponível",
        ]
      });
    } else if (b12 >= 300 && b12 < 400) {
      alertasLabs.push({
        tipo: "info",
        titulo: `ℹ B12 limítrofe — ${b12} pg/mL (zona cinza 300–400)`,
        itens: ["Considerar reposição especialmente se uso de metformina ou IBP crônico, ou se sintomas de deficiência"]
      });
    }
  }

  // TSH
  const mTSH = labs.match(/(?:tsh)(?:\s*[:=]?\s*)(\d+[,.]\d+|\d+)/i);
  if (mTSH) {
    const tsh = parseFloat(mTSH[1].replace(',', '.'));
    if (tsh > 10) {
      alertasLabs.push({
        tipo: "danger",
        titulo: `⚠ Hipotireoidismo primário — TSH ${tsh} mUI/L (normal 0,5–4,5)`,
        itens: [
          "TSH > 10: hipotireoidismo franco — iniciar levotiroxina",
          "Dose inicial em idoso: 25–50 mcg/dia, aumentar 12,5–25 mcg a cada 4–6 semanas",
          "Impacto: piora de dislipidemia, disfunção cognitiva, depressão e insuficiência cardíaca",
          "Dosar T4 livre para confirmar e titular dose",
        ]
      });
    } else if (tsh > 6 && tsh <= 10) {
      alertasLabs.push({
        tipo: "warning",
        titulo: `⚠ Hipotireoidismo subclínico — TSH ${tsh} mUI/L`,
        itens: [
          "Em idoso ≥ 80 anos: TSH até 6–7 pode ser aceitável (alvo mais brando)",
          "Tratar se TSH > 10 ou se sintomas presentes",
          "Verificar anticorpos anti-TPO para avaliar risco de progressão",
        ]
      });
    } else if (tsh < 0.1) {
      alertasLabs.push({
        tipo: "danger",
        titulo: `⚠ Hipertireoidismo — TSH ${tsh} mUI/L (suprimido)`,
        itens: [
          "Risco de FA, osteoporose e piora cognitiva no idoso",
          "Dosar T3 e T4 livre",
          "Encaminhar endocrinologia — considerar cintilografia de tireoide",
        ]
      });
    }
  }

  // Albumina
  const mAlb = labs.match(/(?:albumina)(?:\s*[:=]?\s*)(\d+[,.]\d+|\d+)/i);
  if (mAlb) {
    const alb = parseFloat(mAlb[1].replace(',', '.'));
    if (alb < 3.5) {
      alertasLabs.push({
        tipo: alb < 3.0 ? "danger" : "warning",
        titulo: `⚠ Hipoalbuminemia — Albumina ${alb} g/dL (normal ≥ 3,5)`,
        itens: [
          "Marcador de desnutrição grave e pior prognóstico em idosos",
          alb < 3.0 ? "⚠ Albumina < 3,0: mortalidade aumentada significativamente" : "Avaliar causa: desnutrição, hepatopatia, síndrome nefrótica, inflamação crônica",
          "Encaminhar nutrição para suporte nutricional intensivo",
          "Atenção: albumina baixa altera farmacocinética de medicações altamente ligadas a proteínas (fenitoína, warfarina)",
        ]
      });
    }
  }

  return (
    <div>
      <SectionCard title="Calculadoras de risco" icon="ti-calculator" defaultOpen={false}>
        <CardiovascularRisk consulta={consulta} patient={patient} />
        <FraxCalc consulta={consulta} patient={patient} />
      </SectionCard>
      <SectionCard title="Laboratoriais" icon="ti-flask">
        {riscoESC && (
          <div style={{ background: `var(--color-background-${riscoESC.cor})`, border: `0.5px solid var(--color-border-${riscoESC.cor})`, borderRadius: "8px", padding: "10px 14px", fontSize: "13px", marginBottom: "10px" }}>
            <div style={{ fontWeight: 700, color: `var(--color-text-${riscoESC.cor})`, marginBottom: "4px" }}>
              🫀 Risco cardiovascular ESC: {riscoESC.nivel}
            </div>
            <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>
              {riscoESC.motivo} · Meta de LDL: &lt; {riscoESC.metaLDL} mg/dL
              {tfg && !mTFG && <span style={{ marginLeft: "8px" }}>· TFG calculada (CKD-EPI): <strong>{tfg} mL/min/1,73m²</strong></span>}
              {tfg && mTFG && <span style={{ marginLeft: "8px" }}>· TFG: <strong>{tfg} mL/min/1,73m²</strong></span>}
            </div>
            {alertaLDL && (
              <div style={{ marginTop: "4px", fontWeight: 600, color: `var(--color-text-${alertaLDL.tipo})` }}>
                {alertaLDL.msg}
              </div>
            )}
            {!ldlValor && (
              <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "4px" }}>
                Digite o valor do LDL nos labs para verificar a meta
              </div>
            )}
          </div>
        )}
        {temDM2 && (
          <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "8px", padding: "6px 10px", background: "var(--color-background-secondary)", borderRadius: "6px" }}>
            🎯 <strong>Meta de HbA1c ({perfilHbA1c}):</strong> {metaHbA1c}
          </div>
        )}
        {alertaHbA1c && (
          <Alert type={alertaHbA1c.startsWith('✓') ? "success" : "warning"}>{alertaHbA1c}</Alert>
        )}
        {tfg && !mTFG && (() => {
          const estadio = tfg >= 90 ? null : tfg >= 60 ? "G2 (leve)" : tfg >= 45 ? "G3a (moderada leve)" : tfg >= 30 ? "G3b (moderada grave)" : tfg >= 15 ? "G4 (grave)" : "G5 (falência renal)";
          if (!estadio) return null;
          return (
            <Alert type={tfg < 30 ? "danger" : tfg < 60 ? "warning" : "info"}>
              🧪 TFG calculada por CKD-EPI: <strong>{tfg} mL/min/1,73m²</strong> — DRC {estadio}
              {tfg < 60 && " · Considerar ajuste de doses e monitorar potássio/creatinina"}
            </Alert>
          );
        })()}
        {alertasLabs.length > 0 && alertasLabs.map((a, idx) => (
          <div key={idx} style={{ background: `var(--color-background-${a.tipo})`, border: `0.5px solid var(--color-border-${a.tipo})`, borderRadius: "8px", padding: "10px 14px", fontSize: "13px", marginBottom: "10px" }}>
            <div style={{ fontWeight: 700, color: `var(--color-text-${a.tipo})`, marginBottom: a.itens?.length ? "6px" : 0 }}>{a.titulo}</div>
            {a.itens && a.itens.map((item, i) => (
              <div key={i} style={{ fontSize: "12px", color: "var(--color-text-primary)", padding: "2px 0" }}>• {item}</div>
            ))}
          </div>
        ))}
        <textarea
          rows={10}
          value={consulta.labsTexto || ""}
          onChange={e => updateConsulta(p => ({ ...p, labsTexto: e.target.value }))}
          placeholder={"Registre exames laboratoriais, datas e resultados livremente. Ex:\n12/06/2026 - Hemograma: sem alterações\n12/06/2026 - Creatinina: 1,1 mg/dL"}
        />
      </SectionCard>
      <SectionCard title="Imagem / outros" icon="ti-x-ray">
        <textarea
          rows={8}
          value={consulta.imagemTexto || ""}
          onChange={e => updateConsulta(p => ({ ...p, imagemTexto: e.target.value }))}
          placeholder={"Registre exames de imagem e outros, datas e resultados livremente. Ex:\n10/05/2026 - USG abdome total: esteatose hepática leve"}
        />
      </SectionCard>
    </div>
  );
}

function PlanoTab({ consulta, updateConsulta, patient }) {
  const pl = consulta.plano || {};
  const set = (k, v) => updateConsulta(p => ({ ...p, plano: { ...p.plano, [k]: v } }));
  const [showPrescricao, setShowPrescricao] = useState(false);
  const [medicacoesSelecionadas, setMedicacoesSelecionadas] = useState([]);
  const [medicacoesAdicionais, setMedicacoesAdicionais] = useState("");

  // Meds da consulta para prescrição
  const medsLista = (consulta.medicacoesTexto || "").split("\n").filter(l => l.trim());

  function toggleMed(med) {
    setMedicacoesSelecionadas(prev =>
      prev.includes(med) ? prev.filter(m => m !== med) : [...prev, med]
    );
  }

  function gerarPrescricaoWord() {
    const todasMeds = [...medicacoesSelecionadas, ...medicacoesAdicionais.split("\n").filter(l => l.trim())];
    if (todasMeds.length === 0) { alert("Selecione ao menos uma medicação."); return; }
    const hoje = new Date().toLocaleDateString("pt-BR");
    const nomePaciente = patient?.ident?.nome || "paciente";
    const idade = calcIdade(patient?.ident?.dn);
    const nomeArquivo = "RECEITAS - " + nomePaciente.replace(/[^a-zA-ZÀ-ÿ0-9 ]/g, "").trim() + " " + hoje.replace(/\//g, "-") + ".docx";

    preencherReceitasDocx({
      nome: nomePaciente,
      prontuario: patient?.ident?.prontuario || "",
      maeNome: patient?.ident?.maeNome || "",
      idade: idade != null ? idade : "",
      sexo: patient?.ident?.sexo || "",
    }).then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = nomeArquivo;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setShowPrescricao(false);
    }).catch(e => alert("Erro ao gerar receita: " + e.message));
  }

  const sexo = patient?.ident?.sexo || "";
  const F = sexo === "F";
  const M = sexo === "M";
  const tabagista = (() => {
    const t = (consulta.antecedentes || {}).tabagismo || "";
    return t && t !== "Nunca fumou";
  })();

  // Opções de Solicito (itens 5)
  const SOLICITO_OPTS = [
    { label: "Laboratório", sempre: true },
    { label: "Colonoscopia", sempre: true },
    { label: "EDA", sempre: true },
    { label: "PSO (Pesquisa de sangue oculto)", sempre: true },
    { label: "DMO (Densitometria mineral óssea)", sempre: true },
    { label: "MMG (Mamografia)", cond: F },
    { label: "USG mamas", cond: F },
    { label: "CCO (Citopatológico cervical)", cond: F },
    { label: "PSA (Antígeno prostático específico)", cond: M },
    { label: "TC de tórax de baixa dose", cond: tabagista },
    { label: "USG de aorta abdominal", cond: tabagista },
  ].filter(o => o.sempre || o.cond);

  // Opções de Orientações (item 6)
  const ORIENT_OPTS = [
    "ATUALIZAÇÃO VACINAL",
    "ATIVIDADE FÍSICA REGULAR",
    "INGESTA PROTEICA ADEQUADA",
    "ALIMENTAÇÃO SAUDÁVEL",
    "HIGIENE DO SONO",
  ];

  // Opções de Encaminhamento (item 7)
  const ENCAM_OPTS = [
    "FISIOTERAPIA MOTORA",
    "FISIOTERAPIA RESPIRATÓRIA",
    "PSICOLOGIA",
    "NUTRIÇÃO",
    "FONOAUDIOLOGIA",
    "TO (Terapia Ocupacional)",
    "ODONTOLOGIA",
    "OFTALMOLOGIA",
    "ORL (Otorrinolaringologia)",
  ];

  // Toggle helper: adiciona/remove item de um campo de texto
  function toggleOpcao(campo, item) {
    const atual = pl[campo] || "";
    const linhas = atual.split("\n").map(l => l.trim()).filter(Boolean);
    const idx = linhas.findIndex(l => l.toLowerCase() === item.toLowerCase());
    if (idx >= 0) {
      linhas.splice(idx, 1);
    } else {
      linhas.push(item);
    }
    set(campo, linhas.join("\n"));
  }

  function isChecked(campo, item) {
    const atual = pl[campo] || "";
    return atual.toLowerCase().includes(item.toLowerCase());
  }

  const pend = consulta.pendencias || [];
  const [text, setText] = useState("");
  const add = () => {
    if (!text.trim()) return;
    updateConsulta(p => ({ ...p, pendencias: [...(p.pendencias || []), { id: uid(), text: text.trim(), done: false, createdAt: new Date().toISOString() }] }));
    setText("");
  };
  const toggle = (id) => updateConsulta(p => ({ ...p, pendencias: (p.pendencias || []).map(x => x.id === id ? { ...x, done: !x.done } : x) }));
  const remove = (id) => updateConsulta(p => ({ ...p, pendencias: (p.pendencias || []).filter(x => x.id !== id) }));

  const pendentes = pend.filter(x => !x.done);
  const feitas = pend.filter(x => x.done);

  const checkStyle = { display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" };
  const chipStyle = (checked) => ({
    display: "inline-flex", alignItems: "center", gap: "4px",
    padding: "4px 10px", borderRadius: "20px", fontSize: "12px", cursor: "pointer",
    border: `0.5px solid ${checked ? "var(--color-border-info)" : "var(--color-border-tertiary)"}`,
    background: checked ? "var(--color-background-info)" : "var(--color-background-secondary)",
    color: checked ? "var(--color-text-info)" : "var(--color-text-primary)",
    userSelect: "none",
  });

  return (
    <div>
      {showPrescricao && (
        <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
          <div style={{ background: "var(--color-background-primary)", borderRadius: "12px", width: "100%", maxWidth: "520px", padding: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ fontWeight: 600, fontSize: "15px" }}>📋 Gerar receita</div>
              <button onClick={() => setShowPrescricao(false)}><i className="ti ti-x" aria-hidden="true"></i></button>
            </div>
            {medsLista.length > 0 && (
              <div style={{ marginBottom: "14px" }}>
                <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "8px" }}>Medicações em uso — selecione as que entram na receita:</div>
                {medsLista.map((med, i) => (
                  <label key={i} style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "13px", marginBottom: "6px", cursor: "pointer" }}>
                    <input type="checkbox" checked={medicacoesSelecionadas.includes(med)} onChange={() => toggleMed(med)} style={{ marginTop: "2px" }} />
                    <span>{med}</span>
                  </label>
                ))}
              </div>
            )}
            <Field label="Medicações adicionais (opcional — uma por linha)">
              <textarea rows={3} value={medicacoesAdicionais} onChange={e => setMedicacoesAdicionais(e.target.value)} placeholder="Ex: Dipirona 500mg - 1cp se dor ou febre..." />
            </Field>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "12px" }}>
              <button onClick={() => setShowPrescricao(false)} style={{ fontSize: "13px" }}>Cancelar</button>
              <button onClick={gerarPrescricaoWord} style={{ fontSize: "13px", display: "flex", alignItems: "center", gap: "6px" }}>
                <i className="ti ti-file-word" aria-hidden="true"></i>Gerar receita Word
              </button>
            </div>
          </div>
        </div>
      )}
      <SectionCard title="Plano terapêutico" icon="ti-target-arrow">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "10px" }}>
          <button onClick={() => { setMedicacoesSelecionadas(medsLista); setShowPrescricao(true); }} style={{ fontSize: "13px", display: "flex", alignItems: "center", gap: "6px" }}>
            <i className="ti ti-file-word" aria-hidden="true"></i>Gerar receita a partir das medicações
          </button>
        </div>
        <Field label="1. Ajuste medicamentoso"><textarea rows={4} value={pl.ajuste || ""} onChange={e => set("ajuste", e.target.value)} placeholder="Descreva os ajustes de medicações..." /></Field>

        <Field label="2. Solicito">
          <div style={checkStyle}>
            {SOLICITO_OPTS.map(o => (
              <span key={o.label} style={chipStyle(isChecked("solicito", o.label))} onClick={() => toggleOpcao("solicito", o.label)}>
                {isChecked("solicito", o.label) && <i className="ti ti-check" style={{ fontSize: "11px" }} />}{o.label}
              </span>
            ))}
          </div>
          <textarea rows={3} value={pl.solicito || ""} onChange={e => set("solicito", e.target.value)} placeholder="Detalhe os exames solicitados..." />
        </Field>

        <Field label="3. Orientações">
          <div style={checkStyle}>
            {ORIENT_OPTS.map(o => (
              <span key={o} style={chipStyle(isChecked("orientacoes", o))} onClick={() => toggleOpcao("orientacoes", o)}>
                {isChecked("orientacoes", o) && <i className="ti ti-check" style={{ fontSize: "11px" }} />}{o}
              </span>
            ))}
          </div>
          <textarea rows={3} value={pl.orientacoes || ""} onChange={e => set("orientacoes", e.target.value)} placeholder="Orientações adicionais..." />
        </Field>

        <Field label="4. Encaminho para">
          <div style={checkStyle}>
            {ENCAM_OPTS.map(o => (
              <span key={o} style={chipStyle(isChecked("encaminhamentos", o))} onClick={() => toggleOpcao("encaminhamentos", o)}>
                {isChecked("encaminhamentos", o) && <i className="ti ti-check" style={{ fontSize: "11px" }} />}{o}
              </span>
            ))}
          </div>
          <textarea rows={2} value={pl.encaminhamentos || ""} onChange={e => set("encaminhamentos", e.target.value)} placeholder="Encaminhamentos adicionais..." />
        </Field>

        <Field label="5. Retorno agendado em"><input type="date" value={pl.retorno || ""} onChange={e => set("retorno", e.target.value)} /></Field>
      </SectionCard>

      <SectionCard title="Pendências para próxima consulta" icon="ti-checklist">
        <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
          <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} placeholder="Nova pendência..." style={{ flex: 1 }} />
          <button onClick={add}><i className="ti ti-plus" aria-hidden="true"></i></button>
        </div>
        {pendentes.length === 0 && feitas.length === 0 && <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>Nenhuma pendência registrada.</p>}
        {pendentes.map(item => (
          <div key={item.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
            <input type="checkbox" checked={item.done} onChange={() => toggle(item.id)} />
            <span style={{ flex: 1, fontSize: "14px" }}>{item.text}</span>
            <button onClick={() => remove(item.id)} aria-label="Remover"><i className="ti ti-trash" aria-hidden="true"></i></button>
          </div>
        ))}
        {feitas.length > 0 && (
          <div style={{ marginTop: "10px" }}>
            <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", marginBottom: "4px" }}>Concluídas</div>
            {feitas.map(item => (
              <div key={item.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 0" }}>
                <input type="checkbox" checked={item.done} onChange={() => toggle(item.id)} />
                <span style={{ flex: 1, fontSize: "14px", textDecoration: "line-through", color: "var(--color-text-tertiary)" }}>{item.text}</span>
                <button onClick={() => remove(item.id)} aria-label="Remover"><i className="ti ti-trash" aria-hidden="true"></i></button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}


// ============================================================
// CALCULADORA DE RISCO CARDIOVASCULAR — FRAMINGHAM + PREVENT
// ============================================================
function CardiovascularRisk({ consulta, patient }) {
  const labs = consulta.labsTexto || "";
  const ef = consulta.exameFisico || {};
  const idade = calcIdade(patient?.ident?.dn);
  const sexo = patient?.ident?.sexo || "";
  const temHAS = consulta.problemas?.["HAS"];
  const temDM2 = consulta.problemas?.["DM2"];
  const tabagismo = (consulta.antecedentes || {}).tabagismo || "";
  const tabagista = tabagismo === "Tabagista atual";

  // Extrai CT e HDL dos labs
  const matchCT = labs.match(/(?:ct|col(?:esterol)?\s*total)[^\d]*(\d+)/i);
  const matchHDL = labs.match(/(?:hdl)[^\d]*(\d+)/i);
  const matchPA = (ef.paSentado || "").match(/(\d+)/);

  const CT = matchCT ? parseInt(matchCT[1]) : null;
  const HDL = matchHDL ? parseInt(matchHDL[1]) : null;
  const PAS = matchPA ? parseInt(matchPA[1]) : null;

  if (!idade || !CT || !HDL || !PAS || !sexo) return null;

  // Framingham simplificado (pontos ATP III)
  function framingham() {
    let pts = 0;
    const F = sexo === "F";

    // Idade
    if (F) {
      if (idade < 40) pts -= 7;
      else if (idade <= 44) pts -= 3;
      else if (idade <= 49) pts += 3;
      else if (idade <= 54) pts += 6;
      else if (idade <= 59) pts += 8;
      else if (idade <= 64) pts += 10;
      else if (idade <= 69) pts += 12;
      else if (idade <= 74) pts += 14;
      else pts += 16;
    } else {
      if (idade < 35) pts -= 1;
      else if (idade <= 39) pts += 0;
      else if (idade <= 44) pts += 1;
      else if (idade <= 49) pts += 2;
      else if (idade <= 54) pts += 3;
      else if (idade <= 59) pts += 4;
      else if (idade <= 64) pts += 5;
      else if (idade <= 69) pts += 6;
      else pts += 7;
    }

    // CT (mg/dL)
    if (F) {
      if (CT < 160) pts += 0;
      else if (CT <= 199) pts += 4;
      else if (CT <= 239) pts += 8;
      else if (CT <= 279) pts += 11;
      else pts += 13;
    } else {
      if (CT < 160) pts -= 3;
      else if (CT <= 199) pts += 0;
      else if (CT <= 239) pts += 1;
      else if (CT <= 279) pts += 2;
      else pts += 3;
    }

    // HDL
    if (HDL < 40) pts += 2;
    else if (HDL <= 49) pts += 1;
    else if (HDL <= 59) pts += 0;
    else pts -= 1;

    // PA sistólica
    if (PAS < 120) pts += 0;
    else if (PAS <= 129) pts += F ? 1 : 0;
    else if (PAS <= 139) pts += F ? 2 : 1;
    else if (PAS <= 159) pts += F ? 3 : 2;
    else pts += F ? 4 : 3;

    // Tabagismo
    if (tabagista) pts += F ? 3 : 4;

    // Converter pontos em %
    const tabelaM = { "-1": 2, "0": 3, "1": 3, "2": 4, "3": 5, "4": 7, "5": 8, "6": 10, "7": 13, "8": 16, "9": 20, "10": 25, "11": 31, "12": 37, "13": 45, "14": 53, "15": 61, "16": 68, "17": 75 };
    const tabelaF = { "-2": 1, "-1": 1, "0": 1, "1": 2, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "11": 11, "12": 13, "13": 15, "14": 18, "15": 20, "16": 24, "17": 27, "18": 32, "19": 37, "20": 43, "21": 50, "22": 56, "23": 62, "24": 68, "25": 74 };
    const tabela = F ? tabelaF : tabelaM;
    const key = String(Math.min(Math.max(pts, F ? -2 : -1), F ? 25 : 17));
    return { pts, risco: tabela[key] || (pts > 17 ? 75 : 1) };
  }

  const { pts, risco } = framingham();
  const nivel = risco < 10 ? "Baixo" : risco < 20 ? "Intermediário" : "Alto";
  const cor = risco < 10 ? "success" : risco < 20 ? "warning" : "danger";

  return (
    <div style={{ background: `var(--color-background-${cor})`, border: `0.5px solid var(--color-border-${cor})`, borderRadius: "8px", padding: "12px 14px", fontSize: "13px", marginBottom: "10px" }}>
      <div style={{ fontWeight: 700, color: `var(--color-text-${cor})`, marginBottom: "6px" }}>
        🫀 Risco Cardiovascular em 10 anos (Framingham): <strong>{risco}% — {nivel}</strong>
      </div>
      <div style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
        Baseado em: CT {CT} · HDL {HDL} · PAS {PAS} · Sexo {sexo} · Idade {idade} · {tabagista ? "Tabagista" : "Não tabagista"}
        {temHAS ? " · HAS" : ""}{temDM2 ? " · DM2" : ""}
      </div>
      <div style={{ fontSize: "11px", marginTop: "4px", color: "var(--color-text-tertiary)" }}>
        ⚠ Valores extraídos automaticamente dos labs. Confira os dados antes de usar clinicamente.
      </div>
    </div>
  );
}

// ============================================================
// CALCULADORA FRAX
// ============================================================
function FraxCalc({ consulta, patient }) {
  const [show, setShow] = useState(false);
  const [campos, setCampos] = useState({
    fraturaPrev: false, parenteFratura: false, tabagismo: false,
    corticoide: false, artrite: false, dm2sec: false, alcool: false,
    dmo: "", tScore: "",
  });

  const idade = calcIdade(patient?.ident?.dn);
  const sexo = patient?.ident?.sexo || "";
  const aga = consulta.aga || {};
  const peso = parseFloat(aga.peso) || 0;
  const altura = parseFloat(aga.altura) * 100 || 0; // em cm

  if (!idade || !sexo || !peso || !altura) return null;

  // FRAX simplificado sem DXA (estimativa clínica)
  // Baseado nos coeficientes da versão Brasil
  function calcFrax() {
    const F = sexo === "F";
    let risco10 = F ? 3.5 : 2.0; // base

    // Fatores de risco independentes
    if (idade >= 65) risco10 += F ? 3 : 2;
    if (idade >= 75) risco10 += F ? 3 : 2;
    if (campos.fraturaPrev) risco10 += F ? 4 : 3;
    if (campos.parenteFratura) risco10 += 1.5;
    if (campos.tabagismo) risco10 += 1;
    if (campos.corticoide) risco10 += 2;
    if (campos.artrite) risco10 += 1;
    if (campos.alcool) risco10 += 1;

    // IMC baixo
    const imc = peso / ((altura/100) ** 2);
    if (imc < 20) risco10 += 1.5;

    // T-score se disponível
    const ts = parseFloat(campos.tScore);
    if (!isNaN(ts)) {
      if (ts <= -2.5) risco10 += 4;
      else if (ts <= -2.0) risco10 += 2;
      else if (ts <= -1.5) risco10 += 1;
    }

    return Math.min(risco10, 40).toFixed(1);
  }

  const risco = parseFloat(calcFrax());
  const nivel = risco < 10 ? "Baixo" : risco < 20 ? "Intermediário" : "Alto";
  const cor = risco < 10 ? "success" : risco < 20 ? "warning" : "danger";
  const indicaTto = risco >= 20 || (risco >= 10 && parseFloat(campos.tScore) <= -1.5);

  const set = (k, v) => setCampos(p => ({ ...p, [k]: v }));

  return (
    <div style={{ marginBottom: "10px" }}>
      <button onClick={() => setShow(!show)} style={{ fontSize: "13px", display: "flex", alignItems: "center", gap: "6px" }}>
        🦴 {show ? "Fechar" : "Calcular"} FRAX (risco de fratura)
      </button>
      {show && (
        <div style={{ marginTop: "10px", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "8px", padding: "14px" }}>
          <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "10px" }}>Fatores de risco FRAX</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "8px", marginBottom: "10px" }}>
            {[
              ["fraturaPrev", "Fratura prévia por fragilidade"],
              ["parenteFratura", "Pai ou mãe com fratura de quadril"],
              ["tabagismo", "Tabagismo atual"],
              ["corticoide", "Corticoide oral (≥ 3 meses)"],
              ["artrite", "Artrite reumatoide"],
              ["alcool", "Etilismo (≥ 3 doses/dia)"],
            ].map(([k, label]) => (
              <label key={k} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
                <input type="checkbox" checked={campos[k]} onChange={e => set(k, e.target.checked)} />{label}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <Field label="T-score (colo do fêmur, se disponível)">
              <input value={campos.tScore} onChange={e => set("tScore", e.target.value)} placeholder="ex: -2.5" style={{ maxWidth: "120px" }} />
            </Field>
          </div>
          <div style={{ marginTop: "12px", background: `var(--color-background-${cor})`, border: `0.5px solid var(--color-border-${cor})`, borderRadius: "8px", padding: "10px 14px" }}>
            <div style={{ fontWeight: 700, color: `var(--color-text-${cor})` }}>
              Risco estimado de fratura maior em 10 anos: {risco}% — {nivel}
            </div>
            {indicaTto && (
              <div style={{ fontSize: "12px", marginTop: "4px" }}>
                ✅ Limiar de tratamento atingido — considerar terapia antirreabsortiva.
              </div>
            )}
            <div style={{ fontSize: "11px", marginTop: "4px", color: "var(--color-text-tertiary)" }}>
              Estimativa clínica simplificada. Para cálculo oficial acesse: <a href="https://www.sheffield.ac.uk/FRAX/tool.aspx?country=55" target="_blank" rel="noreferrer">FRAX Brasil (Sheffield)</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// DASHBOARD ESTATÍSTICO MELHORADO
// ============================================================
function Dashboard({ patients }) {
  function exportarExcel() {
    const ativos = patients.filter(p => !p.deletedAt);
    const headers = [
      // Identificação
      "Nome", "Prontuário", "CPF", "DN", "Idade", "Sexo", "Naturalidade", "Procedência",
      "Profissão", "Escolaridade", "Estado civil", "Mora com", "Telefone", "Acompanhante", "Cuidador",
      // Última consulta
      "Data última consulta", "Nº consultas",
      // Sinais vitais
      "PA sentado", "PA em pé", "FC", "FR", "SatO2", "Temp", "Peso", "HGT", "EVA (dor)",
      // AGA — funcionalidade
      "AIVD (Lawton)", "AIVD Justificativa", "ABVD (Katz)", "ABVD Justificativa",
      // AGA — fragilidade
      "FRAIL score", "Perfil fragilidade",
      // AGA — cognição
      "MEEM", "MoCA", "Relógio", "GDS-15",
      // AGA — nutrição
      "IMC", "Classificação IMC", "Circunf. panturrilha", "Força preensão (kgf)",
      // AGA — quedas
      "Quedas no último ano", "Nº quedas",
      // Antecedentes
      "Tabagismo", "Etilismo", "Cirurgias prévias", "Internamentos", "Alergias", "Histórico familiar",
      // Medicações
      "Nº medicamentos", "Medicações em uso", "Polifarmácia",
      // Alertas
      "Beers detectados", "Interações detectadas",
      // Labs
      "Exames laboratoriais", "Exames de imagem",
      // Comorbidades
      "Comorbidades (lista)", "Nº comorbidades", "HAS", "DM2", "DAC", "AVC", "DRC", "Dislipidemia",
      "Hipotireoidismo", "Osteoporose", "Insuficiência cardíaca", "FA", "DPOC", "Demência",
      // Plano
      "Solicitado", "Orientações", "Encaminhamentos", "Retorno programado",
      // Rastreio
      "Vacina influenza", "Vacina pneumo", "Vacina COVID",
    ];

    const rows = [headers];

    ativos.forEach(p => {
      const i = p.ident || {};
      const consultas = (p.consultas || []).filter(c => !c.deletedAt).sort((a, b) => new Date(b.data) - new Date(a.data));
      const ult = consultas[0] || {};
      const aga = ult.aga || {};
      const ef = ult.exameFisico || {};
      const ant = ult.antecedentes || {};
      const pl = ult.plano || {};
      const prob = ult.problemas || {};
      const custom = (ult.problemasCustom || []).filter(c => c.checked).map(c => c.nome);
      const vac = ult.vacinas || {};

      // Fragilidade
      const frailScore = Object.values(aga.frail || {}).filter(Boolean).length;
      const frailClass = frailScore === 0 ? "Robusto" : frailScore <= 2 ? "Pré-frágil" : "Frágil";

      // AIVD/ABVD
      const aivdCount = Object.values(aga.aivd || {}).filter(Boolean).length;
      const abvdCount = Object.values(aga.abvd || {}).filter(Boolean).length;

      // Medicações
      const medsLista = (ult.medicacoesTexto || "").split("\n").filter(l => l.trim());
      const numMeds = medsLista.length;
      const beers = medsLista.filter(l => checkBeers(l)).join("; ");
      const interacoes = checkInteracoes(ult.medicacoesTexto || "").join("; ");

      // Comorbidades
      const ativosProb = PROBLEMAS.filter(pr => prob[pr]);
      const todasComorbidades = [...ativosProb, ...custom];
      const idade = calcIdade(i.dn);

      // IMC
      const imc = calcIMC(aga.peso, aga.altura);
      const imcLabel = imc ? (parseFloat(imc) <= 22 ? "Baixo peso" : parseFloat(imc) < 27 ? "Eutrofia" : "Sobrepeso") : "";

      // Vacinas
      const vacInfluenza = (vac.influenza?.historico || []).length > 0 ? "Sim" : "Não registrada";
      const vacPneumo = (vac.pneumococo?.historico || []).length > 0 ? "Sim" : "Não registrada";
      const vacCovid = (vac.covid?.historico || []).length > 0 ? "Sim" : "Não registrada";

      rows.push([
        // Identificação
        i.nome || "", i.prontuario || "", i.cpf || "", i.dn || "", idade != null ? idade : "",
        i.sexo || "", i.naturalidade || "", i.procedencia || "",
        i.profissao || "", i.escolaridade || "", i.estadoCivil || "", i.moraCom || "",
        i.telefone || "", i.acompanhante || "", i.cuidador || "",
        // Última consulta
        ult.data ? fmtDate(ult.data) : "", consultas.length,
        // Sinais vitais
        ef.paSentado || "", ef.paEmPe || "", ef.fc || "", ef.fr || "",
        ef.sato2 || "", ef.temp || "", ef.peso || aga.peso || "", ef.hgt || "", ef.eva || "",
        // Funcionalidade
        `${aivdCount}/9`, aga.aivdJustificativa || "",
        `${abvdCount}/6`, aga.abvdJustificativa || "",
        // Fragilidade
        `${frailScore}/5`, frailClass,
        // Cognição
        aga.meem || "", aga.moca || "", aga.relogio || "", aga.gds || "",
        // Nutrição
        imc || "", imcLabel, aga.circPanturrilha || "", aga.testeForca || "",
        // Quedas
        aga.quedas || "", aga.quedasNum || "",
        // Antecedentes
        ant.tabagismo || "", ant.etilismo || "", ant.cirurgias || "",
        ant.internamentos || "", ant.alergias || "", ant.historicofamiliar || "",
        // Medicações
        numMeds, medsLista.join("; "), numMeds >= 5 ? "Sim" : "Não",
        // Alertas
        beers, interacoes,
        // Labs
        ult.labsTexto || "", ult.imagemTexto || "",
        // Comorbidades
        todasComorbidades.join("; "), todasComorbidades.length,
        prob["HAS"] ? "Sim" : "Não", prob["DM2"] ? "Sim" : "Não",
        prob["DAC"] ? "Sim" : "Não", prob["AVC"] ? "Sim" : "Não",
        prob["DRC"] ? "Sim" : "Não", prob["Dislipidemia"] ? "Sim" : "Não",
        prob["Hipotireoidismo"] ? "Sim" : "Não", prob["Osteoporose"] ? "Sim" : "Não",
        prob["Insuficiência cardíaca"] ? "Sim" : "Não", prob["FA"] ? "Sim" : "Não",
        prob["DPOC"] ? "Sim" : "Não",
        (prob["Demência"] || prob["Síndrome demencial"] || prob["Doença de Alzheimer"]) ? "Sim" : "Não",
        // Plano
        pl.solicito || "", pl.orientacoes || "", pl.encaminhamentos || "", pl.retorno || "",
        // Vacinas
        vacInfluenza, vacPneumo, vacCovid,
      ]);
    });

    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const bom = "\uFEFF";
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pacientes_completo_${new Date().toLocaleDateString("pt-BR").replace(/\//g, "-")}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function backupJSON() {
    const dados = { exportadoEm: new Date().toISOString(), totalPacientes: patients.length, pacientes: patients };
    const blob = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backup_prontuario_${new Date().toLocaleDateString("pt-BR").replace(/\//g, "-")}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  const ativos = patients.filter(p => !p.deletedAt);
  const total = ativos.length;
  if (total === 0) return <div style={{ textAlign: "center", padding: "2rem", color: "var(--color-text-secondary)" }}>Nenhum paciente cadastrado.</div>;

  // Coleta dados da última consulta de cada paciente
  const dados = ativos.map(p => {
    const consultas = (p.consultas || []).filter(c => !c.deletedAt).sort((a, b) => new Date(b.data) - new Date(a.data));
    const ult = consultas[0] || {};
    const problemas = ult.problemas || {};
    const custom = (ult.problemasCustom || []).filter(c => c.checked);
    const meds = (ult.medicacoesTexto || "").split("\n").filter(l => l.trim()).length;
    const frail = Object.values((ult.aga || {}).frail || {}).filter(Boolean).length;
    const idade = calcIdade(p.ident.dn);
    const sexo = p.ident.sexo || "";
    const imc = calcIMC((ult.aga || {}).peso, (ult.aga || {}).altura);
    const forcaNum = parseFloat((ult.aga || {}).testeForca);
    const circNum = parseFloat((ult.aga || {}).circPanturrilha);
    const sarcopenia = (sexo === "M" ? forcaNum < 27 : forcaNum < 16) || circNum < 31;
    const numComorbidades = Object.values(problemas).filter(Boolean).length + custom.length;
    const dataUltConsulta = ult.data || null;
    const retorno = (ult.plano || {}).retorno || null;
    const retornoVencido = retorno && new Date(retorno) < new Date();
    return { problemas, custom, meds, frail, idade, sexo, imc, sarcopenia, numComorbidades, dataUltConsulta, retornoVencido, nome: p.ident.nome, id: p.id };
  });

  // Fragilidade
  const robusto   = dados.filter(d => d.frail === 0).length;
  const prefragil = dados.filter(d => d.frail >= 1 && d.frail <= 2).length;
  const fragil    = dados.filter(d => d.frail >= 3).length;
  const semDadosFrail = total - robusto - prefragil - fragil;

  // Medicamentos
  const totalMeds = dados.reduce((a, d) => a + d.meds, 0);
  const mediaMeds = total > 0 ? (totalMeds / total).toFixed(1) : 0;
  const polifarmacia  = dados.filter(d => d.meds >= 5).length;
  const polimedicacao = dados.filter(d => d.meds >= 10).length;

  // Faixa etária
  const fx = { "<65": 0, "65-74": 0, "75-84": 0, "≥85": 0, "NI": 0 };
  dados.forEach(d => {
    if (d.idade == null) fx["NI"]++;
    else if (d.idade < 65) fx["<65"]++;
    else if (d.idade <= 74) fx["65-74"]++;
    else if (d.idade <= 84) fx["75-84"]++;
    else fx["≥85"]++;
  });

  // Sexo
  const nF = dados.filter(d => d.sexo === "F").length;
  const nM = dados.filter(d => d.sexo === "M").length;

  // Comorbidades
  const prevComorbidades = {};
  PROBLEMAS.forEach(pr => {
    const n = dados.filter(d => d.problemas[pr]).length;
    if (n > 0) prevComorbidades[pr] = n;
  });
  const topComorbidades = Object.entries(prevComorbidades).sort((a, b) => b[1] - a[1]).slice(0, 10);

  // IMC
  const imcBaixo   = dados.filter(d => d.imc && parseFloat(d.imc) <= 22).length;
  const imcNormal  = dados.filter(d => d.imc && parseFloat(d.imc) > 22 && parseFloat(d.imc) < 27).length;
  const imcSobrepeso = dados.filter(d => d.imc && parseFloat(d.imc) >= 27).length;
  const semIMC     = total - imcBaixo - imcNormal - imcSobrepeso;

  // Sarcopenia
  const comSarcopenia = dados.filter(d => d.sarcopenia).length;

  // Retorno vencido
  const retornoVencido = dados.filter(d => d.retornoVencido);

  // Complexidade
  const complexos  = dados.filter(d => d.numComorbidades >= 5 || d.meds >= 10 || d.frail >= 3).length;
  const moderados  = dados.filter(d => !( d.numComorbidades >= 5 || d.meds >= 10 || d.frail >= 3) && (d.numComorbidades >= 3 || d.meds >= 5 || d.frail >= 1)).length;
  const simples    = total - complexos - moderados;

  // Média de comorbidades
  const mediaComorbidades = total > 0 ? (dados.reduce((a, d) => a + d.numComorbidades, 0) / total).toFixed(1) : 0;

  // Helpers visuais
  const pct = (n) => total > 0 ? Math.round(n / total * 100) : 0;
  const Bar = ({ valor, max, cor }) => (
    <div style={{ height: "8px", background: "var(--color-background-secondary)", borderRadius: "4px", overflow: "hidden", marginTop: "3px" }}>
      <div style={{ height: "100%", width: `${max > 0 ? Math.round(valor/max*100) : 0}%`, background: cor || "var(--color-border-info)", borderRadius: "4px", transition: "width 0.5s" }} />
    </div>
  );
  const StatRow = ({ label, n, cor }) => (
    <div style={{ marginBottom: "10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "2px" }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600, color: cor }}>{n} ({pct(n)}%)</span>
      </div>
      <Bar valor={n} max={total} cor={cor} />
    </div>
  );

  return (
    <div>
      {/* Cards de resumo */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px", marginBottom: "16px" }}>
        {[
          { label: "Pacientes", valor: total, icon: "ti-users", cor: "var(--color-text-info)" },
          { label: "Média de medicamentos", valor: mediaMeds, icon: "ti-pill", cor: "var(--color-text-secondary)" },
          { label: "Média de comorbidades", valor: mediaComorbidades, icon: "ti-list-check", cor: "var(--color-text-secondary)" },
          { label: "Polifarmácia ≥5", valor: `${polifarmacia} (${pct(polifarmacia)}%)`, icon: "ti-alert-circle", cor: "var(--color-text-warning)" },
          { label: "Frágeis", valor: `${fragil} (${pct(fragil)}%)`, icon: "ti-wheelchair", cor: "var(--color-text-danger)" },
          { label: "Complexos", valor: `${complexos} (${pct(complexos)}%)`, icon: "ti-alert-triangle", cor: "var(--color-text-danger)" },
          { label: "Retorno vencido", valor: retornoVencido.length, icon: "ti-calendar-off", cor: retornoVencido.length > 0 ? "var(--color-text-warning)" : "var(--color-text-secondary)" },
          { label: "Sarcopenia provável", valor: `${comSarcopenia} (${pct(comSarcopenia)}%)`, icon: "ti-run", cor: "var(--color-text-warning)" },
        ].map(({ label, valor, icon, cor }) => (
          <div key={label} style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "10px", padding: "12px", background: "var(--color-background-primary)", textAlign: "center" }}>
            <i className={`ti ${icon}`} style={{ fontSize: "20px", color: cor }} />
            <div style={{ fontSize: "20px", fontWeight: 700, margin: "4px 0", color: cor }}>{valor}</div>
            <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.3 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
        {/* Fragilidade */}
        <SectionCard title="Perfil de fragilidade (FRAIL)" icon="ti-heart-rate-monitor">
          <StatRow label="Robusto" n={robusto} cor="var(--color-border-success)" />
          <StatRow label="Pré-frágil" n={prefragil} cor="var(--color-border-warning)" />
          <StatRow label="Frágil" n={fragil} cor="var(--color-border-danger)" />
          {semDadosFrail > 0 && <StatRow label="Sem dados" n={semDadosFrail} cor="var(--color-border-tertiary)" />}
        </SectionCard>

        {/* Complexidade */}
        <SectionCard title="Complexidade clínica" icon="ti-adjustments">
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "8px" }}>
            Complexo = ≥5 comorbidades ou ≥10 meds ou frágil
          </div>
          <StatRow label="Simples" n={simples} cor="var(--color-border-success)" />
          <StatRow label="Moderado" n={moderados} cor="var(--color-border-warning)" />
          <StatRow label="Complexo" n={complexos} cor="var(--color-border-danger)" />
        </SectionCard>

        {/* Faixa etária */}
        <SectionCard title="Faixa etária" icon="ti-calendar">
          {Object.entries(fx).filter(([k, v]) => k !== "NI" || v > 0).map(([label, n]) => (
            <StatRow key={label} label={label === "NI" ? "Não informado" : `${label} anos`} n={n} cor="var(--color-border-info)" />
          ))}
          <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "6px", display: "flex", gap: "12px" }}>
            <span>♀ {nF} ({pct(nF)}%)</span>
            <span>♂ {nM} ({pct(nM)}%)</span>
          </div>
        </SectionCard>

        {/* IMC */}
        <SectionCard title="Estado nutricional (IMC idoso)" icon="ti-scale">
          <StatRow label="Baixo peso (≤22)" n={imcBaixo} cor="var(--color-border-danger)" />
          <StatRow label="Eutrofia (>22 e <27)" n={imcNormal} cor="var(--color-border-success)" />
          <StatRow label="Sobrepeso (≥27)" n={imcSobrepeso} cor="var(--color-border-warning)" />
          {semIMC > 0 && <StatRow label="Sem dados" n={semIMC} cor="var(--color-border-tertiary)" />}
        </SectionCard>
      </div>

      {/* Top comorbidades */}
      <SectionCard title="Prevalência de comorbidades" icon="ti-chart-bar">
        {topComorbidades.length === 0 && <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>Nenhuma comorbidade registrada.</p>}
        {topComorbidades.map(([nome, n]) => (
          <div key={nome} style={{ marginBottom: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "2px" }}>
              <span>{nome}</span>
              <span style={{ fontWeight: 600 }}>{n}/{total} ({pct(n)}%)</span>
            </div>
            <Bar valor={n} max={total} cor={pct(n) >= 60 ? "var(--color-border-danger)" : pct(n) >= 30 ? "var(--color-border-warning)" : "var(--color-border-info)"} />
          </div>
        ))}
      </SectionCard>

      {/* Retorno vencido */}
      {retornoVencido.length > 0 && (
        <SectionCard title="⚠ Retornos vencidos" icon="ti-calendar-off">
          <div style={{ display: "grid", gap: "6px" }}>
            {retornoVencido.map(d => (
              <div key={d.id} style={{ fontSize: "13px", display: "flex", justifyContent: "space-between", padding: "6px 10px", background: "var(--color-background-warning)", borderRadius: "6px" }}>
                <span>{d.nome || "Paciente sem nome"}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Medicamentos - distribuição */}
      <SectionCard title="Distribuição de medicamentos" icon="ti-pill" defaultOpen={false}>
        {[
          ["Sem medicamentos", dados.filter(d => d.meds === 0).length, "var(--color-border-tertiary)"],
          ["1–4 medicamentos", dados.filter(d => d.meds >= 1 && d.meds <= 4).length, "var(--color-border-success)"],
          ["5–9 (polifarmácia)", dados.filter(d => d.meds >= 5 && d.meds <= 9).length, "var(--color-border-warning)"],
          ["≥10 (polimedicação)", polimedicacao, "var(--color-border-danger)"],
        ].map(([label, n, cor]) => (
          <div key={label} style={{ marginBottom: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "2px" }}>
              <span>{label}</span><span style={{ fontWeight: 600 }}>{n} ({pct(n)}%)</span>
            </div>
            <Bar valor={n} max={total} cor={cor} />
          </div>
        ))}
      </SectionCard>

      <div style={{ display: "flex", gap: "10px", marginTop: "8px", flexWrap: "wrap" }}>
        <button onClick={exportarExcel} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
          <i className="ti ti-file-spreadsheet" aria-hidden="true"></i>Exportar lista (CSV/Excel)
        </button>
        <button onClick={backupJSON} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
          <i className="ti ti-database-export" aria-hidden="true"></i>Backup completo (JSON)
        </button>
      </div>
    </div>
  );
}
// ============================================================
function GraficoEvolucao({ patient }) {
  const consultas = [...(patient.consultas || [])]
    .filter(c => !c.deletedAt)
    .sort((a, b) => new Date(a.data) - new Date(b.data));

  const dadosPeso = consultas
    .map(c => ({ data: c.data, valor: parseFloat((c.aga || {}).peso || (c.exameFisico || {}).peso) }))
    .filter(d => !isNaN(d.valor) && d.valor > 0);

  const dadosPA = consultas
    .map(c => {
      const pa = ((c.exameFisico || {}).paSentado || "");
      const m = pa.match(/(\d+)\s*[xX\/]\s*(\d+)/);
      return m ? { data: c.data, sis: parseInt(m[1]), dia: parseInt(m[2]) } : null;
    })
    .filter(Boolean);

  // Dados cognitivos
  const dadosMEEM = consultas
    .map(c => ({ data: c.data, valor: parseInt((c.aga || {}).meem) }))
    .filter(d => !isNaN(d.valor) && d.valor > 0);

  const dadosMoCA = consultas
    .map(c => ({ data: c.data, valor: parseInt((c.aga || {}).moca) }))
    .filter(d => !isNaN(d.valor) && d.valor > 0);

  if (dadosPeso.length < 2 && dadosPA.length < 2) return null;

  const SVGLine = ({ dados, key, cor, min, max, width = 400, height = 100 }) => {
    if (dados.length < 2) return null;
    const pad = 8;
    const w = width - pad * 2;
    const h = height - pad * 2;
    const range = max - min || 1;
    const pts = dados.map((d, i) => {
      const x = pad + (i / (dados.length - 1)) * w;
      const y = pad + h - ((d - min) / range) * h;
      return `${x},${y}`;
    });
    return (
      <svg width={width} height={height} style={{ width: "100%", height: "auto" }}>
        <polyline points={pts.join(" ")} fill="none" stroke={cor} strokeWidth="2" />
        {dados.map((d, i) => {
          const x = pad + (i / (dados.length - 1)) * w;
          const y = pad + h - ((d - min) / range) * h;
          return <circle key={i} cx={x} cy={y} r="4" fill={cor} />;
        })}
      </svg>
    );
  };

  return (
    <div style={{ marginTop: "16px" }}>
      {dadosPeso.length >= 2 && (
        <SectionCard title="Evolução do peso (kg)" icon="ti-scale" defaultOpen={true}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>
            <span>{fmtDate(dadosPeso[0].data)}</span>
            <span>{fmtDate(dadosPeso[dadosPeso.length-1].data)}</span>
          </div>
          <SVGLine
            dados={dadosPeso.map(d => d.valor)}
            cor="var(--color-border-info)"
            min={Math.min(...dadosPeso.map(d => d.valor)) - 2}
            max={Math.max(...dadosPeso.map(d => d.valor)) + 2}
          />
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "8px" }}>
            {dadosPeso.map((d, i) => (
              <span key={i} style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                {fmtDate(d.data)}: <strong>{d.valor} kg</strong>
              </span>
            ))}
          </div>
          {dadosPeso.length >= 2 && (() => {
            const diff = dadosPeso[dadosPeso.length-1].valor - dadosPeso[0].valor;
            const cor = diff < -3 ? "danger" : diff > 3 ? "warning" : "success";
            return <div style={{ fontSize: "13px", marginTop: "6px", color: `var(--color-text-${cor})` }}>
              {diff > 0 ? "+" : ""}{diff.toFixed(1)} kg desde a primeira consulta
            </div>;
          })()}
        </SectionCard>
      )}
      {dadosPA.length >= 2 && (
        <SectionCard title="Evolução da PA (mmHg)" icon="ti-heartbeat" defaultOpen={true}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>
            <span>{fmtDate(dadosPA[0].data)}</span>
            <span>{fmtDate(dadosPA[dadosPA.length-1].data)}</span>
          </div>
          <SVGLine
            dados={dadosPA.map(d => d.sis)}
            cor="var(--color-border-danger)"
            min={Math.min(...dadosPA.map(d => d.dia)) - 10}
            max={Math.max(...dadosPA.map(d => d.sis)) + 10}
          />
          <SVGLine
            dados={dadosPA.map(d => d.dia)}
            cor="var(--color-border-warning)"
            min={Math.min(...dadosPA.map(d => d.dia)) - 10}
            max={Math.max(...dadosPA.map(d => d.sis)) + 10}
          />
          <div style={{ display: "flex", gap: "6px", fontSize: "11px", marginTop: "4px" }}>
            <span style={{ color: "var(--color-text-danger)" }}>— Sistólica</span>
            <span style={{ color: "var(--color-text-warning)" }}>— Diastólica</span>
          </div>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "8px" }}>
            {dadosPA.map((d, i) => (
              <span key={i} style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                {fmtDate(d.data)}: <strong>{d.sis}/{d.dia}</strong>
              </span>
            ))}
          </div>
        </SectionCard>
      )}
      {(dadosMEEM.length >= 2 || dadosMoCA.length >= 2) && (
        <SectionCard title="Progressão cognitiva" icon="ti-brain" defaultOpen={true}>
          {dadosMEEM.length >= 2 && (
            <>
              <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>MEEM (pontuação)</div>
              <SVGLine dados={dadosMEEM.map(d => d.valor)} cor="var(--color-border-info)" min={Math.min(...dadosMEEM.map(d => d.valor)) - 2} max={30} />
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "4px" }}>
                {dadosMEEM.map((d, i) => (
                  <span key={i} style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                    {fmtDate(d.data)}: <strong>{d.valor}/30</strong>
                  </span>
                ))}
              </div>
              {dadosMEEM.length >= 2 && (() => {
                const diff = dadosMEEM[dadosMEEM.length-1].valor - dadosMEEM[0].valor;
                return diff < -2 && <div style={{ fontSize: "13px", color: "var(--color-text-danger)", marginTop: "4px" }}>⚠ Declínio de {Math.abs(diff)} pontos no MEEM desde a primeira consulta</div>;
              })()}
            </>
          )}
          {dadosMoCA.length >= 2 && (
            <>
              <div style={{ fontSize: "13px", fontWeight: 600, margin: "10px 0 4px" }}>MoCA (pontuação)</div>
              <SVGLine dados={dadosMoCA.map(d => d.valor)} cor="var(--color-border-warning)" min={Math.min(...dadosMoCA.map(d => d.valor)) - 2} max={30} />
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "4px" }}>
                {dadosMoCA.map((d, i) => (
                  <span key={i} style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                    {fmtDate(d.data)}: <strong>{d.valor}/30</strong>
                  </span>
                ))}
              </div>
              {dadosMoCA.length >= 2 && (() => {
                const diff = dadosMoCA[dadosMoCA.length-1].valor - dadosMoCA[0].valor;
                return diff < -2 && <div style={{ fontSize: "13px", color: "var(--color-text-danger)", marginTop: "4px" }}>⚠ Declínio de {Math.abs(diff)} pontos no MoCA desde a primeira consulta</div>;
              })()}
            </>
          )}
        </SectionCard>
      )}
    </div>
  );
}

// ============================================================
// CARTA DE REFERÊNCIA COM IA
// ============================================================
// ============================================================
// SUGESTÕES DE CONDUTA — baseadas nos dados da consulta
// ============================================================
function SugestoesCondutaIA({ patient, consulta, onClose }) {
  const i = patient.ident;
  const idade = calcIdade(i.dn);
  const ativos = PROBLEMAS.filter(p => consulta.problemas && consulta.problemas[p]);
  const customAtivos = (consulta.problemasCustom || []).filter(c => c.checked);
  const meds = (consulta.medicacoesTexto || "").split("\n").filter(l => l.trim());
  const aga = consulta.aga || {};
  const frailScore = Object.values(aga.frail || {}).filter(Boolean).length;
  const frailClass = frailScore === 0 ? "Robusto" : frailScore <= 2 ? "Pré-frágil" : "Frágil";
  const ef = consulta.exameFisico || {};
  const labs = consulta.labsTexto || "";
  const imc = parseFloat(calcIMC(aga.peso, aga.altura));
  const numMeds = meds.length;
  const aivd = Object.values(aga.aivd || {}).filter(Boolean).length;
  const abvd = Object.values(aga.abvd || {}).filter(Boolean).length;
  const forcaNum = parseFloat(aga.testeForca);
  const circNum = parseFloat(aga.circPanturrilha);
  const temHAS = ativos.includes("HAS");
  const temDM2 = ativos.includes("DM2");
  const temOsteoporose = ativos.includes("Osteoporose");
  const temDislipidemia = ativos.includes("Dislipidemia");
  const temDRC = ativos.includes("DRC");

  // PA
  const mPA = (ef.paSentado || "").match(/(\d+)\s*[xX\/]\s*(\d+)/);
  const PAS = mPA ? parseInt(mPA[1]) : null;
  const PAD = mPA ? parseInt(mPA[2]) : null;
  const metaPA = frailScore >= 3 ? 150 : idade >= 80 ? 140 : 130;
  const paAcimaMeta = PAS && PAS >= metaPA;

  // HbA1c
  const mHb = labs.match(/(?:hba1c|glicada|hemoglobina glicada)[^\d]*(\d+[,.]?\d*)\s*%?/i);
  const hba1c = mHb ? parseFloat(mHb[1].replace(',', '.')) : null;
  const metaHbA1c = frailScore >= 3 ? 8 : 7.5;
  const hba1cAcimaMeta = hba1c && hba1c > metaHbA1c;

  // Vit D
  const mVitD = labs.match(/(?:vit(?:amina)?\s*d)[^\d]*(\d+)/i);
  const vitD = mVitD ? parseInt(mVitD[1]) : null;

  // Constrói sugestões automaticamente
  const sugestoes = [];

  // Fragilidade
  if (frailScore >= 3) sugestoes.push({ cat: "⚠ Fragilidade", items: ["Priorizar abordagem multidisciplinar", "Evitar prescrições novas sem revisão cuidadosa", "Atenção redobrada a quedas, desnutrição e delirium"] });
  else if (frailScore >= 1) sugestoes.push({ cat: "⚠ Pré-fragilidade", items: ["Estimular atividade física resistida", "Garantir ingesta proteica ≥ 1,2g/kg/dia", "Monitorar evolução dos critérios FRAIL"] });

  // Funcionalidade
  if (aivd < 7) sugestoes.push({ cat: "Funcionalidade", items: [`AIVD comprometida (${aivd}/9) — avaliar necessidade de TO, fisioterapia ou suporte social`] });
  if (abvd < 5) sugestoes.push({ cat: "Funcionalidade", items: [`ABVD comprometida (${abvd}/6) — avaliar suporte de cuidador e adaptações domiciliares`] });

  // PA
  if (paAcimaMeta && temHAS) sugestoes.push({ cat: "Hipertensão", items: [`PA ${ef.paSentado} acima da meta (< ${metaPA}/90 para ${frailClass.toLowerCase()})`, "Revisar adesão e dose das medicações anti-hipertensivas", "Considerar rastreio de HAS secundária se refratária"] });

  // DM2
  if (temDM2 && hba1cAcimaMeta) sugestoes.push({ cat: "Diabetes", items: [`HbA1c ${hba1c}% acima da meta (< ${metaHbA1c}% para ${frailClass.toLowerCase()})`, frailScore >= 3 ? "Evitar hipoglicemiantes com risco de hipoglicemia (sulfonilureias)" : "Considerar ajuste de hipoglicemiante"] });
  if (temDM2 && !labs.toLowerCase().includes("hba1c") && !labs.toLowerCase().includes("glicada")) sugestoes.push({ cat: "Diabetes", items: ["HbA1c não registrada nos labs — solicitar"] });

  // Osteoporose
  if (temOsteoporose) sugestoes.push({ cat: "Osteoporose", items: ["Confirmar uso de bisfosfonato + vitamina D + cálcio", "Verificar risco de queda e adaptar ambiente domiciliar", "FRAX disponível na aba Prevenção"] });

  // Vit D
  if (vitD !== null && vitD < 30) sugestoes.push({ cat: "Vitamina D", items: [`Vitamina D ${vitD} ng/mL — deficiente`, "Suplementar colecalciferol 50.000 UI/semana por 8 semanas, depois manutenção 10.000 UI/semana"] });

  // Nutrição
  if (imc && imc <= 22) sugestoes.push({ cat: "Nutrição", items: [`IMC ${imc} — baixo peso para idoso`, "Encaminhar para nutrição", "Suplemento hiperproteico oral", "Investigar causas (disfagia, depressão, neoplasia)"] });
  const sarcopenia = (!isNaN(forcaNum) && (i.sexo === "M" ? forcaNum < 27 : forcaNum < 16)) || (!isNaN(circNum) && circNum < 31);
  if (sarcopenia) sugestoes.push({ cat: "Sarcopenia", items: ["Atividade física resistida ≥ 2x/semana", "Ingesta proteica ≥ 1,2g/kg/dia", "Encaminhar fisioterapia motora", "Considerar SPPB para estadiamento"] });

  // Polifarmácia
  if (numMeds >= 10) sugestoes.push({ cat: "Polimedicação", items: [`${numMeds} medicamentos — alto risco`, "Revisão sistemática da lista (critérios STOPP/START)", "Desprescrever conforme Beers 2023"] });
  else if (numMeds >= 5) sugestoes.push({ cat: "Polifarmácia", items: [`${numMeds} medicamentos — revisar indicações`, "Atenção a Beers 2023 e interações sinalizadas"] });

  // Quedas
  if ((aga.quedas === "sim")) sugestoes.push({ cat: "Quedas", items: ["Revisar medicações que aumentam risco de queda", "Encaminhar fisioterapia para treino de equilíbrio", "Avaliar necessidade de dispositivo de auxílio", "Orientar adaptações domiciliares (barras, tapetes)"] });

  // Vacinas
  const vac = consulta.vacinas || {};
  const vacsAusar = [];
  if (!vac.influenza?.dose) vacsAusar.push("Influenza");
  if (!vac.covid?.dose) vacsAusar.push("COVID-19");
  if (!vac.pneumo?.vpc20 && !vac.pneumo?.vpc13) vacsAusar.push("Pneumocócica");
  if (vacsAusar.length > 0) sugestoes.push({ cat: "Vacinação", items: [`Vacinas pendentes: ${vacsAusar.join(", ")}`, "Verificar calendário de vacinação do idoso"] });

  // Dislipidemia
  const mLDL = labs.match(/(?:ldl|ld)[^\d]*(\d+)/i);
  const ldl = mLDL ? parseInt(mLDL[1]) : null;
  if (temDislipidemia && ldl !== null && ldl > 70) sugestoes.push({ cat: "Dislipidemia", items: [`LDL ${ldl} mg/dL — verificar meta conforme risco cardiovascular`, "Confirmar uso de estatina e adesão"] });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 12px", overflowY: "auto" }}>
      <div style={{ background: "var(--color-background-primary)", borderRadius: "12px", width: "100%", maxWidth: "680px", padding: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div style={{ fontWeight: 600, fontSize: "15px", display: "flex", alignItems: "center", gap: "8px" }}>
            <i className="ti ti-checklist" style={{ color: "var(--color-text-info)" }} aria-hidden="true"></i>
            Sugestões de conduta
          </div>
          <button onClick={onClose}><i className="ti ti-x" aria-hidden="true"></i></button>
        </div>

        <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "12px", padding: "8px 12px", background: "var(--color-background-secondary)", borderRadius: "6px" }}>
          Gerado automaticamente com base nos dados desta consulta. Revise criticamente — a decisão clínica final é sempre do médico.
        </div>

        {sugestoes.length === 0 && (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--color-text-secondary)" }}>
            <i className="ti ti-circle-check" style={{ fontSize: "32px", display: "block", marginBottom: "8px", color: "var(--color-text-success)" }} aria-hidden="true"></i>
            Nenhuma sugestão específica identificada com os dados preenchidos nesta consulta.
          </div>
        )}

        <div style={{ maxHeight: "65vh", overflowY: "auto" }}>
          {sugestoes.map((s, i) => (
            <div key={i} style={{ marginBottom: "12px", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "8px", overflow: "hidden" }}>
              <div style={{ background: "var(--color-background-info)", padding: "8px 12px", fontWeight: 600, fontSize: "13px", color: "var(--color-text-info)" }}>
                {s.cat}
              </div>
              <div style={{ padding: "10px 12px" }}>
                {s.items.map((item, j) => (
                  <div key={j} style={{ fontSize: "13px", padding: "3px 0", display: "flex", gap: "8px" }}>
                    <span style={{ color: "var(--color-text-info)", flexShrink: 0 }}>→</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: "8px", marginTop: "14px", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ fontSize: "13px" }}>Fechar</button>
        </div>
      </div>
    </div>
  );
}


function PrintDocRenderer({ doc, patient, consulta, onClose }) {
  if (doc.type === "consultaCompleta") return <ConsultaCompletaPrint patient={patient} consulta={consulta} onClose={onClose} />;

  if (doc.type === "sugestoesIA") return <SugestoesCondutaIA patient={patient} consulta={consulta} onClose={onClose} />;
  return null;
}

function ReceitaPrint({ patient, consulta, receitaId, onClose }) {
  const receitas = (consulta.docs && Array.isArray(consulta.docs.receitas)) ? consulta.docs.receitas : [];
  const receita = receitas.find(r => r.id === receitaId) || {};
  const sel = receita.selecionados || {};
  const edits = receita.itensEditados || {};
  const extras = receita.extras || "";
  const titulos = receita.titulosEditados || {};

  const blocosComItens = RECEITA_BLOCOS.map(bloco => ({
    ...bloco,
    tituloExibido: titulos[bloco.categoria] !== undefined ? titulos[bloco.categoria] : bloco.categoria,
    itensSelecionados: bloco.itens
      .filter(item => sel[bloco.categoria + "::" + item.nome])
      .map(item => {
        const edit = edits[bloco.categoria + "::" + item.nome] || {};
        return {
          nome: edit.nome !== undefined ? edit.nome : item.nome,
          qtd: edit.qtd !== undefined ? edit.qtd : item.qtd,
          posologia: edit.posologia !== undefined ? edit.posologia : item.posologia,
          via: item.via,
        };
      })
      .filter(item => item.nome.trim())
  })).filter(b => b.itensSelecionados.length > 0);

  const extrasLinhas = extras.split("\n").map(l => l.trim()).filter(Boolean);

  let counter = 0;

  return (
    <PrintShell title="Receituário" onClose={onClose}>
      <DocHeader title="RECEITUÁRIO" />
      <div style={{ marginBottom: "14px" }}><strong>Paciente:</strong> {patient.ident.nome || ""}</div>
      <div style={{ textAlign: "center", marginBottom: "14px" }}>USO ORAL</div>
      {blocosComItens.length === 0 && extrasLinhas.length === 0 && <p style={{ textAlign: "center", color: "#888" }}>Nenhum item preenchido.</p>}
      {blocosComItens.map(bloco => (
        <div key={bloco.categoria} style={{ marginBottom: "12px" }}>
          <div style={{ fontWeight: 700, marginBottom: "6px" }}>
            {bloco.tituloExibido}:{(bloco.usoTopico || bloco.usoInalatorio) && (bloco.usoTopico ? " USO TÓPICO" : " USO INALATÓRIO")}
          </div>
          {bloco.itensSelecionados.map((item, idx) => {
            counter++;
            return (
              <div key={bloco.categoria + idx} style={{ marginBottom: "8px", paddingLeft: "18px" }}>
                {item.via && <div style={{ fontStyle: "italic" }}>{item.via}</div>}
                <div>{counter}. {item.nome} {"-".repeat(8)} {item.qtd}</div>
                <div style={{ paddingLeft: "18px" }}>{item.posologia}</div>
              </div>
            );
          })}
        </div>
      ))}
      {extrasLinhas.length > 0 && (
        <div style={{ marginBottom: "12px" }}>
          <div style={{ fontWeight: 700, marginBottom: "6px" }}>OUTRAS MEDICAÇÕES:</div>
          <div style={{ paddingLeft: "18px", whiteSpace: "pre-wrap" }}>{extras}</div>
        </div>
      )}
      <DocFooter />
    </PrintShell>
  );
}

function ReceitaEspecialPrint({ patient, consulta, itemId, onClose }) {
  const itens = (consulta.docs && Array.isArray(consulta.docs.receitasEspeciais)) ? consulta.docs.receitasEspeciais : [];
  const re = itens.find(r => r.id === itemId) || {};
  return (
    <PrintShell title="Receituário de controle especial" onClose={onClose}>
      <DocHeader title="RECEITUÁRIO DE CONTROLE ESPECIAL" />
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
        <div>
          <div style={{ fontWeight: 700 }}>IDENTIFICAÇÃO DO EMITENTE</div>
          <div>Nome completo: {re.medicoNome}</div>
        </div>
        <div style={{ textAlign: "right", fontWeight: 700, fontSize: "11px" }}>
          <div>1ª VIA - Farmácia</div>
          <div>2ª VIA - Paciente</div>
        </div>
      </div>
      <div style={{ marginBottom: "4px" }}>CRM: {re.crmNum}    UF: {re.ufMedico}</div>
      <div style={{ marginBottom: "4px" }}>Endereço completo e telefone: {re.enderecoMedico}</div>
      <div style={{ marginBottom: "14px" }}>Cidade: {re.cidadeMedico}    UF: {re.ufMedico}</div>
      <div style={{ marginBottom: "6px" }}><strong>Paciente:</strong> {patient.ident.nome || ""}</div>
      <div style={{ marginBottom: "6px" }}><strong>Endereço:</strong></div>
      <div style={{ marginBottom: "14px" }}><strong>Prescrição:</strong></div>
      <div style={{ whiteSpace: "pre-wrap", marginBottom: "22px", paddingLeft: "8px" }}>{re.prescricao}</div>
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginTop: "30px" }}>
        <div>IDENTIFICAÇÃO DO COMPRADOR</div>
        <div>IDENTIFICAÇÃO DO FORNECEDOR</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginTop: "6px" }}>
        <div>
          <div>Nome:</div>
          <div>Ident.: Org. Emissor:</div>
          <div>End.:</div>
          <div>Cidade: UF:</div>
          <div>Telefone:</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div>______/______/______</div>
          <div style={{ fontSize: "10px", marginTop: "20px" }}>ASSINATURA DO FARMACÊUTICO</div>
          <div style={{ fontSize: "10px" }}>DATA</div>
        </div>
      </div>
      <DocFooter />
    </PrintShell>
  );
}

function ExameSimplesPrint({ patient, consulta, itemId, onClose }) {
  const itens = (consulta.docs && Array.isArray(consulta.docs.examesSimplesLista)) ? consulta.docs.examesSimplesLista : [];
  const es = itens.find(r => r.id === itemId) || { texto: "" };
  const texto = es.texto !== undefined ? es.texto : EXAMES_LABORATORIAIS_PADRAO.join("\n");
  const linhas = texto.split("\n").map(l => l.trim()).filter(Boolean);
  return (
    <PrintShell title="Solicitação de exames laboratoriais" onClose={onClose}>
      <DocHeader title="RECEITUÁRIO" />
      <div style={{ marginBottom: "10px" }}><strong>Paciente:</strong> {patient.ident.nome || ""}</div>
      <div style={{ textAlign: "center", fontWeight: 700, marginBottom: "14px" }}>SOLICITAÇÃO DE EXAMES LABORATORIAIS</div>
      <ol style={{ paddingLeft: "20px" }}>
        {linhas.map((l, i) => <li key={i} style={{ marginBottom: "3px" }}>{l}</li>)}
      </ol>
      <DocFooter />
    </PrintShell>
  );
}

function ExameEspecialPrint({ patient, consulta, itemId, onClose }) {
  const itens = (consulta.docs && Array.isArray(consulta.docs.examesEspeciais)) ? consulta.docs.examesEspeciais : [];
  const ee = itens.find(r => r.id === itemId) || {};
  const idade = calcIdade(patient.ident.dn);
  const carLabel = { urgencia_absoluta: "URGÊNCIA ABSOLUTA", urgencia_relativa: "URGÊNCIA RELATIVA", rotina: "ROTINA", controle: "CONTROLE" };
  const cellStyle = { border: "1px solid #000", padding: "5px 8px", fontSize: "12px" };
  const headStyle = { border: "1px solid #000", padding: "4px 8px", fontWeight: 700, fontSize: "11px", background: "#f0f0f0" };
  return (
    <PrintShell title="Solicitação e autorização de exames especiais" onClose={onClose}>
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: "13px", marginBottom: "10px" }}>
        HOSPITAL DOS SERVIDORES DO ESTADO<br />SOLICITAÇÃO E AUTORIZAÇÃO DE EXAMES ESPECIAIS
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "10px" }}>
        <tbody>
          <tr><td style={cellStyle}><strong>PACIENTE:</strong> {patient.ident.nome}</td><td style={cellStyle}><strong>REGISTRO:</strong> {ee.registro || patient.ident.prontuario}</td></tr>
          <tr><td style={cellStyle}><strong>MÃE:</strong> {patient.ident.maeNome}</td><td style={cellStyle}><strong>ENF.:</strong> {ee.enf}</td></tr>
          <tr>
            <td style={cellStyle}><strong>LEITO:</strong> {ee.leito} &nbsp;&nbsp; <strong>IDADE:</strong> {idade != null ? idade : ""} &nbsp;&nbsp; <strong>SEXO:</strong> {patient.ident.sexo}</td>
            <td style={cellStyle}><strong>SETOR SOLICITANTE:</strong> {ee.setorSolicitante || "GERIATRIA"}</td>
          </tr>
        </tbody>
      </table>
      <div style={headStyle}>EXAMES REALIZADOS</div>
      <div style={{ ...cellStyle, minHeight: "40px", marginBottom: "8px" }}>{ee.examesRealizados}</div>
      <div style={headStyle}>DADOS CLÍNICOS</div>
      <div style={{ ...cellStyle, minHeight: "50px", marginBottom: "8px" }}>{ee.dadosClinicos}</div>
      <div style={headStyle}>HIPÓTESE DIAGNÓSTICA</div>
      <div style={{ ...cellStyle, minHeight: "30px", marginBottom: "8px" }}>{ee.hipoteseDiagnostica}</div>
      <div style={headStyle}>EXAME SOLICITADO</div>
      <div style={{ ...cellStyle, minHeight: "30px", marginBottom: "8px" }}>{ee.exameSolicitado}</div>
      <div style={headStyle}>CARÁTER</div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "10px" }}>
        <tbody>
          <tr>
            {["urgencia_absoluta","urgencia_relativa","rotina","controle"].map(c => (
              <td key={c} style={{ ...cellStyle, fontWeight: ee.carater === c ? 700 : 400, background: ee.carater === c ? "#dde" : "transparent" }}>
                {ee.carater === c ? "[X] " : "[ ] "}{carLabel[c]}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <div style={{ ...cellStyle, marginBottom: "8px" }}>Data: {fmtDateShort()}</div>
      <div style={{ display: "flex", justifyContent: "space-between", margin: "20px 0", fontSize: "11px" }}>
        <div>Carimbo e Assinatura do Solicitante</div>
        <div>Carimbo e Assinatura da Chefia</div>
      </div>
      <div style={headStyle}>OBSERVAÇÕES</div>
      <div style={{ ...cellStyle, minHeight: "30px" }}>{ee.observacoes}</div>
      <DocFooter />
    </PrintShell>
  );
}

function VacinacaoPrint({ patient, consulta, onClose }) {
  const vd = (consulta.docs && consulta.docs.vacinacao) || { selecionados: {} };
  const selRaw = vd.selecionados || {};
  const sel = {};
  VACINAS_DOC.forEach(v => { sel[v] = selRaw[v] !== false; });
  return (
    <PrintShell title="Solicitação de atualização vacinal" onClose={onClose}>
      <DocHeader title="RECEITUÁRIO" />
      <div style={{ marginBottom: "10px" }}><strong>Paciente:</strong> {patient.ident.nome || ""}</div>
      <div style={{ textAlign: "center", fontWeight: 700, marginBottom: "14px" }}>SOLICITO ATUALIZAÇÃO VACINAL - CALENDÁRIO DE VACINAÇÃO DO IDOSO</div>

      {sel["Influenza"] && (
        <div style={{ marginBottom: "10px" }}>
          <strong>•</strong> Influenza (Dose anual):
          <div style={{ paddingLeft: "16px" }}>○ Dose: _____/_____/_____ &gt; Reforço anual.</div>
        </div>
      )}
      {sel["COVID-19"] && (
        <div style={{ marginBottom: "10px" }}>
          <strong>•</strong> COVID-19 (Dose de reforço a cada 6 meses):
          <div style={{ paddingLeft: "16px" }}>○ Dose: _____/_____/_____ &gt; Repetir após 6 meses: _____/_____/_____ &gt; Reforço a cada 6 meses.</div>
        </div>
      )}
      {sel["Pneumocócica"] && (
        <div style={{ marginBottom: "10px" }}>
          <strong>•</strong> Pneumocócica:
          <div style={{ paddingLeft: "16px" }}>
            <div>○ Preferência = VPC20 (Dose única): _____/_____/_____.</div>
            <div style={{ fontWeight: 700, fontSize: "11px" }}>OBS: DISPONÍVEL APENAS NA REDE PARTICULAR - R$ 350-550,00.</div>
            <div>○ Se indisponibilidade de VPC20:</div>
            <div style={{ paddingLeft: "16px" }}>
              <div>■ VPC13: _____/_____/_____ &gt; Após 6 meses, fazer:</div>
              <div>■ VPP23: _____/_____/_____ &gt; Repetir após 5 anos: _____/_____/_____.</div>
            </div>
            <div style={{ fontWeight: 700, fontSize: "11px" }}>OBS: DISPONÍVEL NO SUS APENAS PARA GRUPOS DE RISCO NO CRIE: Hospital Universitário Oswaldo Cruz – UPE - CRIE-PE (Rua Arnóbio Marques, 310, Santo Amaro, Recife – PE). Contato: (81) 3184-1370 ou (81) 3184-1369.</div>
          </div>
        </div>
      )}
      {sel["dT/dTpa"] && (
        <div style={{ marginBottom: "10px" }}>
          <strong>•</strong> dT/dTpa:
          <div style={{ paddingLeft: "16px" }}>
            <div>○ Sem esquema prévio:</div>
            <div style={{ paddingLeft: "16px" }}>
              <div>■ dT: _____/_____/_____ &gt; Repetir após 2 meses: _____/_____/_____ &gt; Após 2 meses da última dose, fazer:</div>
              <div>■ dTpa: _____/_____/_____ &gt; Repetir a cada 10 anos.</div>
            </div>
            <div>○ Com esquema prévio:</div>
            <div style={{ paddingLeft: "16px" }}>■ dTpa (Dose de reforço a cada 10 anos): _____/_____/_____ &gt; Repetir a cada 10 anos.</div>
          </div>
        </div>
      )}
      {sel["Hepatite B"] && (
        <div style={{ marginBottom: "10px" }}>
          <strong>•</strong> Hepatite B:
          <div style={{ paddingLeft: "16px" }}>○ Dose: _____/_____/_____ &gt; Repetir após 1 mês: _____/_____/_____ &gt; Repetir após 6 meses da 1ª dose: _____/_____/_____.</div>
        </div>
      )}
      {sel["Vírus sincicial respiratório (VSR)"] && (
        <div style={{ marginBottom: "10px" }}>
          <strong>•</strong> Vírus sincicial respiratório (VSR) (Dose única): _____/_____/_____.
        </div>
      )}
      {sel["Herpes-zóster (VZR recombinante)"] && (
        <div style={{ marginBottom: "10px" }}>
          <strong>•</strong> Herpes-zóster (VZR recombinante - Shingrix):
          <div style={{ paddingLeft: "16px" }}>
            <div>○ Dose: _____/_____/_____ &gt; Repetir após 2 meses: _____/_____/_____.</div>
            <div style={{ fontWeight: 700, fontSize: "11px" }}>OBS: DISPONÍVEL APENAS NA REDE PARTICULAR - R$ 700-950,00 POR DOSE (R$ 1400-1900,00 TOTAL).</div>
          </div>
        </div>
      )}
      <DocFooter />
    </PrintShell>
  );
}

function ConsultaCompletaPrint({ patient, consulta, onClose }) {
  const idade = calcIdade(patient.ident.dn);
  const i = patient.ident;
  const a = consulta.antecedentes || {};
  const aga = consulta.aga || {};
  const ef = consulta.exameFisico || {};
  const pl = consulta.plano || {};
  const ativos = PROBLEMAS.filter(p => consulta.problemas && consulta.problemas[p]);
  const customAtivos = (consulta.problemasCustom || []).filter(c => c.checked);
  const notas = consulta.problemasNotas || {};
  const pend = consulta.pendencias || [];

  const sectionTitle = { fontWeight: 700, fontSize: "13px", marginTop: "16px", marginBottom: "6px", borderBottom: "1px solid #ccc", paddingBottom: "3px" };
  const label = { fontWeight: 700 };

  // Nome do arquivo: "NomePaciente_DD-MM-AAAA"
  const nomeArquivo = [
    (i.nome || 'Paciente').replace(/[^a-zA-ZÀ-ÿ0-9 ]/g, '').trim().replace(/ +/g, '_'),
    fmtDate(consulta.data).replace(/\//g, '-'),
  ].join('_');

  return (
    <PrintShell title="Consulta completa" onClose={onClose} fileName={nomeArquivo} patient={patient} consulta={consulta}>
      <div id="print-content">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
        <img src={`data:image/png;base64,${LOGO_HSE_BASE64}`} alt="HSE" style={{ height: "48px", objectFit: "contain" }} />
        <div style={{ textAlign: "center", flex: 1, fontWeight: 700, fontSize: "14px", letterSpacing: "0.3px" }}>{getNomeAmbulatorio(sessionStorage.getItem("ambulatorio") || "cempre")}</div>
        <img src={`data:image/png;base64,${LOGO_GERIATRIA_BASE64}`} alt="Geriatria" style={{ height: "48px", objectFit: "contain" }} />
      </div>
      <div style={{ marginBottom: "4px" }}><span style={label}>Paciente:</span> {i.nome || "—"}</div>
      <div style={{ marginBottom: "4px" }}><span style={label}>Data da consulta:</span> {fmtDate(consulta.data)}</div>

      <div style={sectionTitle}>IDENTIFICAÇÃO</div>
      <div>Prontuário: {i.prontuario || "—"} · CPF: {i.cpf || "—"} · Sexo: {i.sexo || "—"} · Idade: {idade != null ? idade + " anos" : "—"}</div>
      <div>Nome da mãe: {i.maeNome || "—"} · Naturalidade: {i.natural || "—"} · Procedência: {i.procedente || "—"}</div>
      <div>Profissão: {i.profissao || "—"} · Escolaridade: {i.escolaridade || "—"} · Estado civil: {i.estadoCivil || "—"}</div>
      <div>Acompanhante: {i.acompanhante || "—"} · Cuidador: {i.cuidador || "—"} · Mora com: {i.moraCom || "—"} · Pode contar com: {i.podeContarCom || "—"} · Telefone: {i.telefone || "—"}</div>

      <div style={sectionTitle}>LISTA DE PROBLEMAS</div>
      {ativos.length === 0 && customAtivos.length === 0 ? <div>Nenhuma comorbidade ativa registrada.</div> : (
        <ul style={{ margin: 0, paddingLeft: "18px" }}>
          {ativos.map(p => <li key={p}>{p}{notas[p] ? ` - ${notas[p]}` : ""}</li>)}
          {customAtivos.map(c => <li key={c.id}>{c.nome}{c.nota ? ` - ${c.nota}` : ""}</li>)}
        </ul>
      )}

      <div style={sectionTitle}>ANTECEDENTES</div>
      <div>Tabagismo: {a.tabagismo || "—"}{a.tabagismo && a.tabagismo !== "Nunca fumou" && (a.macosAno || a.macosDia) ? ` — ${a.macosDia || "?"}mç/dia, ${a.macosAno || "?"}mç-ano${a.tabagismoInicio ? `, início ${a.tabagismoInicio}` : ""}${a.tabagismoCessou ? `, cessou ${a.tabagismoCessou}` : ""}` : ""}</div>
      <div>Etilismo: {a.etilismo || "—"}{a.etilismo && a.etilismo !== "Nega" ? ` — ${a.etilismoTipo || ""}${a.etilismoFrequencia ? `, ${a.etilismoFrequencia}` : ""}${a.etilismoInicio ? `, início ${a.etilismoInicio}` : ""}${a.etilismoCessou ? `, cessou ${a.etilismoCessou}` : ""}` : ""}</div>
      <div>Cirurgias prévias:</div>
      <div style={{ whiteSpace: "pre-wrap", marginBottom: "6px" }}>{a.cirurgias || "—"}</div>
      <div>Internamentos no último ano:</div>
      <div style={{ whiteSpace: "pre-wrap", marginBottom: "6px" }}>{a.internamentos || "—"}</div>
      <div>Alergias: {a.alergias || "—"}</div>
      <div>Histórico familiar:</div>
      <div style={{ whiteSpace: "pre-wrap", marginBottom: "6px" }}>{a.historicoFamiliar || "—"}</div>

      <div style={sectionTitle}>MEDICAÇÕES EM USO</div>
      <div style={{ whiteSpace: "pre-wrap" }}>{consulta.medicacoesTexto || "—"}</div>
      {consulta.medicacoesPrevias && (<><div style={{ fontWeight: 700, marginTop: "6px" }}>Uso prévio:</div><div style={{ whiteSpace: "pre-wrap" }}>{consulta.medicacoesPrevias}</div></>)}

      <div style={sectionTitle}>QUEIXAS</div>
      <div style={{ whiteSpace: "pre-wrap" }}>{consulta.queixas || "—"}</div>

      <div style={sectionTitle}>AVALIAÇÃO GERIÁTRICA AMPLA</div>
      <div>AIVD independentes: {Object.values(aga.aivd || {}).filter(Boolean).length}/9 ({Object.keys(aga.aivd || {}).filter(k => aga.aivd[k]).join(", ") || "—"})</div>
      <div>ABVD independentes: {Object.values(aga.abvd || {}).filter(Boolean).length}/6 ({Object.keys(aga.abvd || {}).filter(k => aga.abvd[k]).join(", ") || "—"})</div>
      <div>Marcha: {aga.marcha || "—"} · Dispositivo: {aga.dispositivo || "—"}</div>
      <div>Quedas: {aga.quedas === "sim" ? `Sim (${aga.quedasNum || "?"})${aga.quedasDescricao ? " — " + aga.quedasDescricao : ""}` : "Não"}</div>
      {aga.fraturas === "sim" && <div>Fraturas: Sim{aga.fraturasDescricao ? ` — ${aga.fraturasDescricao}` : ""}</div>}
      {aga.tce === "sim" && <div>TCE: Sim{aga.tceDescricao ? ` — ${aga.tceDescricao}` : ""}</div>}
      <div>FRAIL: {Object.values(aga.frail || {}).filter(Boolean).length}/5 critérios — {Object.values(aga.frail || {}).filter(Boolean).length === 0 ? "Robusto" : Object.values(aga.frail || {}).filter(Boolean).length <= 2 ? "Pré-frágil" : "Frágil"}</div>
      <div>Cognição: {aga.semQueixasCognitivas ? "Sem queixas cognitivas" : `Mini-Cog: ${aga.minicog || "—"} · MEEM: ${aga.meem || "—"} · MoCA: ${aga.moca || "—"}${aga.queixasCognitivasDescricao ? " — " + aga.queixasCognitivasDescricao : ""}`}</div>
      <div>Humor: {aga.semQueixasHumor ? "Sem queixas de humor" : `GDS-15: ${aga.gds15 || "—"}${aga.queixasHumorDescricao ? " — " + aga.queixasHumorDescricao : ""}`}</div>
      <div>Sono: {aga.semQueixasSono ? "Sem queixas de sono" : `Roncos: ${aga.roncos || "—"} · Sonolência diurna: ${aga.sonolenciaDiurna || "—"} · Higiene do sono: ${aga.higieneSono || "—"}`}{aga.sonoObservacoes ? ` — ${aga.sonoObservacoes}` : ""}</div>
      <div>Visão: {aga.visao || "—"}{aga.visaoLentes === "sim" ? " (usa lentes corretivas)" : ""} · Audição: {aga.audicao || "—"}{aga.audicaoAparelho === "sim" ? " (usa aparelho auditivo)" : ""}</div>
      <div>Incontinência urinária: {aga.incontinenciaUrinaria === "sim" ? `Sim${aga.incontinenciaUrinariaDes ? " — " + aga.incontinenciaUrinariaDes : ""}` : "Não"} · Incontinência fecal: {aga.incontinenciaFecal === "sim" ? `Sim${aga.incontinenciaFecalDes ? " — " + aga.incontinenciaFecalDes : ""}` : "Não"} · Constipação: {aga.constipacao === "sim" ? `Sim${aga.constipacaoDescricao ? " — " + aga.constipacaoDescricao : ""}` : "Não"}</div>
      <div>Peso: {aga.peso || "—"} kg · Peso habitual: {aga.pesoHabitual || "—"} kg · Altura: {aga.altura || "—"} m · IMC: {calcIMC(aga.peso, aga.altura) || "—"}</div>
      <div>Perda de peso: {aga.perdaPeso === "sim" ? `Sim — ${aga.perdaPesoKg || "?"} kg${aga.perdaPesoTempo ? ` em ${aga.perdaPesoTempo}` : ""}` : "Não"}</div>
      <div>Apetite: {aga.apetite || "—"} · Disfagia: {aga.disfagia || "—"}{aga.disfagiaDieta ? ` (${aga.disfagiaDieta})` : ""}</div>
      <div>Problemas dentários: {aga.problemasDentarios === "sim" ? `Sim${aga.problemasDentariosDes ? " — " + aga.problemasDentariosDes : ""}` : "Não"} · Prótese dentária: {aga.proteseDentaria === "sim" ? "Sim" : "Não"}</div>
      <div>Teste de força: {aga.testeForca || "—"} kgf · Circunferência da panturrilha: {aga.circPanturrilha || "—"} cm · Atividade física: {aga.atividadeFisica || "—"}</div>

      <div style={sectionTitle}>PREVENÇÃO E VACINAS</div>
      {(() => {
        const rg = consulta.rastreioGeral || {};
        const re = consulta.rastreioEspecifico || {};
        const vac = consulta.vacinas || {};
        const rgPreenchidos = RASTREIO_GERAL.filter(r => Array.isArray(rg[r.nome]) && rg[r.nome].some(reg => reg.data || reg.resultado));
        const reChaves = Object.keys(re).filter(k => Array.isArray(re[k]) && re[k].some(reg => reg.data || reg.resultado));
        const vacLabels = { influenza: "Influenza", covid: "COVID-19", pneumo: "Pneumocócica", dtpa: "dT/dTpa", hepB: "Hepatite B", vsr: "VSR", vzr: "Herpes-zóster (VZR)" };
        const vacPreenchidas = Object.keys(vac).filter(k => vac[k] && Object.values(vac[k]).some(v => v));
        const nadaPreenchido = rgPreenchidos.length === 0 && reChaves.length === 0 && vacPreenchidas.length === 0;
        if (nadaPreenchido) return <div>Nenhum item de prevenção ou vacina preenchido nesta consulta.</div>;
        return (
          <>
            {rgPreenchidos.length > 0 && (
              <>
                <div style={{ fontWeight: 700, marginTop: "6px" }}>Rastreio geral:</div>
                {rgPreenchidos.map(r => (
                  <div key={r.nome} style={{ marginBottom: "4px" }}>
                    <div style={{ fontWeight: 500 }}>{r.nome}:</div>
                    {rg[r.nome].filter(reg => reg.data || reg.resultado).map((reg, idx) => (
                      <div key={reg.id || idx} style={{ paddingLeft: "12px", whiteSpace: "pre-wrap" }}>
                        {reg.data ? fmtDate(reg.data) : "—"}{reg.resultado ? ` — ${reg.resultado}` : ""}
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}
            {reChaves.length > 0 && (
              <>
                <div style={{ fontWeight: 700, marginTop: "6px" }}>Rastreio específico por comorbidade:</div>
                {reChaves.map(k => (
                  <div key={k} style={{ marginBottom: "4px" }}>
                    <div style={{ fontWeight: 500 }}>{k.replace("::", " — ")}:</div>
                    {re[k].filter(reg => reg.data || reg.resultado).map((reg, idx) => (
                      <div key={reg.id || idx} style={{ paddingLeft: "12px", whiteSpace: "pre-wrap" }}>
                        {reg.data ? fmtDate(reg.data) : "—"}{reg.resultado ? ` — ${reg.resultado}` : ""}
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}
            {vacPreenchidas.length > 0 && (
              <>
                <div style={{ fontWeight: 700, marginTop: "6px" }}>Vacinas:</div>
                {vacPreenchidas.map(k => (
                  <div key={k}>
                    {vacLabels[k] || k}: {Object.entries(vac[k]).filter(([, v]) => v).map(([campo, v]) => `${campo}: ${fmtDate(v)}`).join(" · ")}
                  </div>
                ))}
              </>
            )}
          </>
        );
      })()}

      <div style={sectionTitle}>EXAME FÍSICO</div>
      <div>PA sentado: {ef.paSentado || "—"} · PA em pé (3 min): {ef.paEmPe || "—"} · FC: {ef.fc || "—"} · FR: {ef.fr || "—"} · SatO2: {ef.sato2 || "—"} · Temp: {ef.temp || "—"}</div>
      {(ef.peso || ef.hgt) && <div>Peso: {ef.peso || "—"} kg · HGT: {ef.hgt || "—"} mg/dL</div>}
      <div>Geral: {ef.geral || "—"}</div>
      <div>ACV: {ef.acv || "—"}</div>
      <div>AR: {ef.ar || "—"}</div>
      <div>ABD: {ef.abd || "—"}</div>
      <div>EXT: {ef.ext || "—"}</div>
      <div>SN: {ef.sn || "—"}</div>
      {ef.pele && <div>Pele: {ef.pele}</div>}
      {ef.outros && <div>Outros: {ef.outros}</div>}

      <div style={sectionTitle}>EXAMES</div>
      <div style={{ whiteSpace: "pre-wrap" }}>{consulta.labsTexto || "—"}</div>
      {consulta.imagemTexto && (<><div style={{ fontWeight: 700, marginTop: "6px" }}>Imagem/outros:</div><div style={{ whiteSpace: "pre-wrap" }}>{consulta.imagemTexto}</div></>)}

      <div style={sectionTitle}>PLANO TERAPÊUTICO</div>
      <div><strong>1. Ajuste medicamentoso:</strong></div>
      <div style={{ whiteSpace: "pre-wrap", marginBottom: "6px" }}>{pl.ajuste || "—"}</div>
      <div><strong>2. Solicito:</strong></div>
      <div style={{ whiteSpace: "pre-wrap", marginBottom: "6px" }}>{pl.solicito || "—"}</div>
      <div><strong>3. Orientações:</strong></div>
      <div style={{ whiteSpace: "pre-wrap", marginBottom: "6px" }}>{pl.orientacoes || "—"}</div>
      <div><strong>4. Encaminho para:</strong></div>
      <div style={{ whiteSpace: "pre-wrap", marginBottom: "6px" }}>{pl.encaminhamentos || "—"}</div>
      <div>5. Retorno agendado em: {pl.retorno ? fmtDate(pl.retorno) : "—"}</div>

      <div style={sectionTitle}>PENDÊNCIAS</div>
      {pend.length === 0 ? <div>Nenhuma pendência registrada.</div> : (
        <ul style={{ margin: 0, paddingLeft: "18px" }}>
          {pend.map(p => <li key={p.id} style={{ textDecoration: p.done ? "line-through" : "none" }}>{p.text}</li>)}
        </ul>
      )}

      <DocFooter />
      </div>
    </PrintShell>
  );
}
