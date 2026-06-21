import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { listPatients, savePatient, deletePatient as apiDeletePatient } from './api.js';

const PROBLEMAS = ["HAS","DM2","Dislipidemia","Obesidade","Esteatose hepática","DRC","DAC","IC","FA","AVC","DPOC","Asma","HPB","Incontinência urinária","DRGE","Constipação crônica","Osteoporose","Osteoartrose","Hipotireoidismo","Transtorno depressivo","TAG","Insônia","Síndrome demencial","Doença de Parkinson","Neoplasia","DHC","Insuficiência venosa crônica","DAOP","Catarata","Glaucoma","Déficit auditivo A/E"];

const PREVENCAO_ESPECIFICA = {
  "HAS": ["MAPA 24h","ECG (anual)","ECOTT (se HVE ou IC; a cada 2 anos)","BNP (se suspeita de IC)","Polissonografia (se suspeita de SAOS)"],
  "DM2": ["Fundoscopia (anual)","ECG (anual)","Avaliação do pé diabético (toda consulta)"],
  "Obesidade": ["USG de abdome total (anual)","Elastografia hepática"],
  "Esteatose hepática": ["USG de abdome total (anual)","Elastografia hepática"],
  "DAC": ["ECG (anual)","ECOTT (a cada 2 anos)","Teste ergométrico","Cintilografia miocárdica (repouso/estresse)"],
  "IC": ["ECG (anual)","ECOTT (a cada 2 anos)","RX de tórax PA e perfil"],
  "FA": ["ECG","Holter 24h","ECOTT"],
  "AVC": ["ECG","ECOTT","USG Doppler de carótidas e vertebrais","TC de crânio s/ contraste","RNM de crânio s/ contraste"],
  "DRC": ["USG de rins e vias urinárias com resíduo pós-miccional","PSA total e livre"],
  "HPB": ["USG de rins e vias urinárias com resíduo pós-miccional","PSA total e livre"],
  "DPOC": ["Espirometria com prova broncodilatadora (anual)","RX de tórax PA e perfil","TC de tórax s/ contraste"],
  "Asma": ["Espirometria com prova broncodilatadora (anual)","RX de tórax PA e perfil"],
  "DHC": ["USG de abdome total (6/6 meses)","AFP (6/6 meses)","Elastografia hepática","EDA"],
  "Insuficiência venosa crônica": ["USG Doppler venoso de MMII"],
  "DAOP": ["USG Doppler arterial de MMII"],
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

const RASTREIO_GERAL = [
  { nome: "Colonoscopia", criterio: "45–75 anos; a cada 10 anos" },
  { nome: "Densitometria óssea", criterio: "Homem ≥70 / Mulher ≥65 anos; 2–5 anos" },
  { nome: "Mamografia bilateral", criterio: "50–75 anos; bianual" },
  { nome: "Citologia oncótica", criterio: "25–64 anos; a cada 3 anos" },
  { nome: "PSA total e livre", criterio: "55–69 anos; a cada 2 anos" },
  { nome: "TC tórax baixa dose", criterio: "Tabagista ≥20 maços-ano; anual" },
  { nome: "USG aorta abdominal", criterio: "Tabagista 65–75 anos; única vez" },
];

const BEERS_LIST = [
  "amitriptilina","clorpromazina","prometazina","hidroxizina","diazepam","clonazepam","alprazolam","lorazepam","midazolam",
  "zolpidem","amiodarona","digoxina","nifedipina","doxazosina","glibenclamida","clorpropamida","insulina escala móvel isolada",
  "indometacina","cetorolaco","ibuprofeno crônico","diclofenaco","meperidina","tramadol","oxibutinina","metoclopramida",
  "olanzapina","quetiapina","risperidona","haloperidol","fluoxetina","escitalopram em alta dose","espironolactona >25mg",
  "ácido acetilsalicílico para prevenção primária >70 anos","mineral oil"
];

function checkBeers(nomeMedicacao) {
  if (!nomeMedicacao) return null;
  const lower = nomeMedicacao.toLowerCase();
  const found = BEERS_LIST.find(b => lower.includes(b));
  return found || null;
}

function calcIMC(peso, altura) {
  const p = parseFloat(peso);
  const a = parseFloat(altura);
  if (!p || !a) return null;
  return (p / (a * a)).toFixed(1);
}

function calcIdade(dn) {
  if (!dn) return null;
  const birth = new Date(dn);
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
    const d = new Date(iso);
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
    { nome: "DENOSUMABE 60MG/ML", qtd: "1 UNIDADE/SEMESTRE", posologia: "APLICAR 1 UNIDADE, VIA SUBCUTÂNEA EM BRAÇO, COXA OU ABDOME, 1 VEZ A CADA 6 MESES, POR TOTAL DE 3 ANOS. NÃO INTERROMPER MEDICAÇÃO DURANTE TRATAMENTO." },
    { nome: "TERIPARATIDA 20MCG", qtd: "30 UNIDADES/MÊS", posologia: "APLICAR 1 UNIDADE, VIA SUBCUTÂNEA EM COXA OU ABDOME, 1 VEZ AO DIA, POR TOTAL DE 2 ANOS." },
    { nome: "ÁCIDO ZOLEDRÔNICO 5MG", qtd: "1 UNIDADE/ANO", posologia: "APLICAR 1 AMPOLA + 100ML SF 0,9%, EV, CORRER EM 30 MINUTOS. DOSE ANUAL. TOTAL DE 3 ANOS. É COMUM SENTIR SINTOMAS SEMELHANTES À QUADRO GRIPAL 24-72 HORAS APÓS APLICAÇÃO DA MEDICAÇÃO." },
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
    { nome: "DIPIRONA 1G", qtd: "01 CAIXA", posologia: "TOMAR 1 COMPRIMIDO ATÉ DE 6/6 HORAS SE DOR." },
    { nome: "CAPSAICINA 0,025% (USO TÓPICO)", qtd: "1 UNIDADE", posologia: "APLICAR EM REGIÃO DOLOROSA, 3 VEZES AO DIA, SE DOR. LAVAR AS MÃOS APÓS APLICAÇÃO. A SENSAÇÃO DE ARDOR INICIAL É ESPERADA." },
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
    // Cópia profunda da consulta anterior como ponto de partida, com novo id/data
    const copy = JSON.parse(JSON.stringify(base));
    copy.id = uid();
    copy.data = new Date().toISOString().slice(0, 10);
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = new Date().toISOString();
    // Pendências da consulta atual (texto livre) não deve se repetir; pendências (lista) sim, mantém continuidade
    copy.pendenciasConsultaAtual = "";
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
    antecedentes: { tabagismo: "", cargaTabagica: "", etilismo: "", etilismoDetalhe: "", atividadeFisica: "", cirurgias: "", internamentos: "", alergias: "", historicoFamiliar: "" },
    medicacoesTexto: "",
    medicacoesPrevias: "",
    queixas: "",
    aga: {
      aivd: {"Telefone":true,"Transporte":true,"Compras":true,"Preparar refeições":true,"Tarefas domésticas":true,"Trabalhos manuais":true,"Lavar roupas":true,"Medicações":true,"Finanças":true},
      abvd: {"Banho":true,"Vestir-se":true,"Higiene pessoal":true,"Transferência":true,"Continência":true,"Alimentação":true},
      marcha: "", dispositivo: "",
      frail: {}, minicog: "", meem: "", moca: "",
      gds15: "", quedas: "nega", quedasNum: "", fraturas: "nao", tce: "nao",
      sono: "", peso: "", altura: "", perdaPeso: "nao", perdaPesoPerc: "", perdaPesoMeses: "",
      apetite: "preservado", disfagia: "ausente", disfagiaDieta: "", dentarios: "nao",
      tgi: "continente", tgu: "continente", visao: "preservada", audicao: "preservada",
      atividadeFisicaLazer: "", lazer: "",
    },
    vacinas: {},
    rastreioGeral: {},
    rastreioEspecifico: {},
    exameFisico: { pa: "", fc: "", fr: "", sato2: "", temp: "", geral: "Estado geral bom, consciente, orientado, eupneico, corado, hidratado, anictérico, acianótico, afebril ao toque.", acv: "RCR em 2 tempos, bulhas normofonéticas, sem sopros.", ar: "Murmúrio vesicular presente, eupneico em ar ambiente, sem ruídos adventícios.", abd: "Semigloboso, depressível, normotimpânico, indolor à palpação, sem visceromegalias ou massas palpáveis, ruídos hidroaéreos presentes.", ext: "Sem edemas, tempo de enchimento capilar 2 segundos, panturrilhas livres.", sn: "Glasgow 15, pupilas isofotorreagentes, sem déficits focais.", pele: "" },
    labsTexto: "",
    imagemTexto: "",
    plano: { ajuste: "", exames: "", encaminhamentos: "", orientacoes: "", retorno: "" },
    pendencias: [],
    pendenciasConsultaAtual: "",
    docs: {
      receitaSelecionados: {},
      receitaItensEditados: {},
      receitaExtras: "",
      receitaEspecial: { medicoNome: "", crm: "", crmUf: "PE", crmNum: "", enderecoMedico: "", cidadeMedico: "Recife", ufMedico: "PE", prescricao: "" },
      examesSimples: { texto: EXAMES_LABORATORIAIS_PADRAO.join("\n") },
      examesEspecial: { registro: "", enf: "", leito: "", setorSolicitante: "GERIATRIA", examesRealizados: "", dadosClinicos: "", hipoteseDiagnostica: "", exameSolicitado: "", carater: "rotina", observacoes: "" },
      vacinacao: { selecionados: {} },
    },
  };
}

function emptyPatient() {
  return {
    id: uid(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ident: { prontuario: "", nome: "", cpf: "", sexo: "", dn: "", maeNome: "", natural: "", procedente: "", profissao: "", escolaridade: "", estadoCivil: "", religiao: "", acompanhante: "", cuidador: "", moraCom: "", telefone: "" },
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
  { id: "pendencias", label: "Pendências", icon: "ti-checklist" },
];

const DOC_TABS = [
  { id: "receita", label: "Receita", icon: "ti-prescription" },
  { id: "receitaEspecial", label: "Receita especial", icon: "ti-shield-lock" },
  { id: "exameSimples", label: "Exame simples", icon: "ti-flask" },
  { id: "exameEspecial", label: "Exame especial", icon: "ti-x-ray" },
  { id: "vacinacao", label: "Solicitação de vacinação", icon: "ti-vaccine" },
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

function PrintShell({ title, children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50 }}>
      <div style={{ minHeight: "100vh", background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 12px", overflowY: "auto" }}>
        <div style={{ background: "#ffffff", color: "#111111", width: "100%", maxWidth: "680px", borderRadius: "12px", padding: "0", boxSizing: "border-box" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #e0e0e0" }}>
            <div style={{ fontWeight: 500, fontSize: "14px", color: "#333" }}>Pré-visualização — {title}</div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => window.print()} style={{ fontSize: "13px", padding: "5px 12px", border: "1px solid #ccc", borderRadius: "6px", background: "#f5f5f5", cursor: "pointer" }}>
                <i className="ti ti-printer" aria-hidden="true" style={{ marginRight: "4px" }}></i>Imprimir
              </button>
              <button onClick={onClose} style={{ fontSize: "13px", padding: "5px 12px", border: "1px solid #ccc", borderRadius: "6px", background: "#f5f5f5", cursor: "pointer" }}>
                <i className="ti ti-x" aria-hidden="true"></i>
              </button>
            </div>
          </div>
          <div style={{ padding: "28px 32px", fontFamily: "Arial, sans-serif", fontSize: "13px", lineHeight: 1.45, color: "#111" }}>
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
  const [patients, setPatients] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [activeConsultaId, setActiveConsultaId] = useState(null);
  const [view, setView] = useState("list"); // list | consultas | record
  const [mode, setMode] = useState("prontuario");
  const [activeTab, setActiveTab] = useState("ident");
  const [activeDocTab, setActiveDocTab] = useState("receita");
  const [saveStatus, setSaveStatus] = useState("idle");
  const [search, setSearch] = useState("");
  const [printDoc, setPrintDoc] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const saveTimers = useRef({});

  useEffect(() => {
    (async () => {
      try {
        const list = await listPatients();
        let anyMigrated = false;
        const migrated = list.map(p => {
          if (p.consultas) return p;
          anyMigrated = true;
          // Migração de pacientes antigos (estrutura plana) para o novo formato com consultas[]
          const { id, createdAt, updatedAt, ident, ...rest } = p;
          return { id, createdAt, updatedAt, ident, consultas: [{ id: uid(), data: (createdAt || new Date().toISOString()).slice(0,10), createdAt: createdAt || new Date().toISOString(), updatedAt: updatedAt || new Date().toISOString(), ...rest }] };
        });
        setPatients(migrated);
        if (anyMigrated) {
          migrated.forEach(p => { savePatient(p).catch(e => console.error("Falha ao persistir migração", e)); });
        }
      } catch (e) {
        console.error(e);
        setLoadError(e.message);
        setPatients([]);
      }
    })();
  }, []);

  const persistPatient = useCallback((patient) => {
    clearTimeout(saveTimers.current[patient.id]);
    setSaveStatus("saving");
    saveTimers.current[patient.id] = setTimeout(async () => {
      try {
        await savePatient(patient);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 1200);
      } catch (e) {
        console.error(e);
        setSaveStatus("error");
      }
    }, 700);
  }, []);

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
      await savePatient(p);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDeletePatient(id) {
    setPatients(prev => prev.filter(p => p.id !== id));
    if (activeId === id) { setActiveId(null); setView("list"); }
    try {
      await apiDeletePatient(id);
    } catch (e) {
      console.error(e);
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
    setActiveDocTab("receita");
    setView("record");
  }

  function createConsulta() {
    if (!activePatient) return;
    const sorted = [...activePatient.consultas].sort((a, b) => new Date(b.data) - new Date(a.data));
    const ultima = sorted[0];
    const nova = emptyConsulta(ultima);
    updateActivePatient(p => ({ ...p, consultas: [...p.consultas, nova] }));
    openConsulta(nova.id, "prontuario");
  }

  function removeConsulta(consultaId) {
    updateActivePatient(p => ({ ...p, consultas: p.consultas.filter(c => c.id !== consultaId) }));
  }

  const filteredPatients = (patients || []).filter(p => {
    const q = search.toLowerCase();
    return !q || (p.ident.nome || "").toLowerCase().includes(q) || (p.ident.prontuario || "").toLowerCase().includes(q);
  });

  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem", flexWrap: "wrap", gap: "8px" }}>
        <div>
          <h1 style={{ margin: 0 }}>Prontuário de geriatria — CEMPRE</h1>
          <p style={{ margin: "2px 0 0", fontSize: "13px", color: "var(--color-text-secondary)" }}>HSE-PE · dados salvos no Google Sheets</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {saveStatus === "saving" && <Pill color="info"><i className="ti ti-loader-2" aria-hidden="true"></i>Salvando</Pill>}
          {saveStatus === "saved" && <Pill color="success"><i className="ti ti-check" aria-hidden="true"></i>Salvo</Pill>}
          {saveStatus === "error" && <Pill color="danger"><i className="ti ti-alert-triangle" aria-hidden="true"></i>Erro ao salvar</Pill>}
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
          search={search}
          setSearch={setSearch}
          onOpen={openPatient}
          onCreate={createPatient}
          onDelete={handleDeletePatient}
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
          <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
            <button onClick={() => setMode("prontuario")} style={{
              padding: "8px 16px", borderRadius: "8px", fontSize: "14px",
              border: mode === "prontuario" ? "0.5px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
              background: mode === "prontuario" ? "var(--color-background-info)" : "transparent",
              color: mode === "prontuario" ? "var(--color-text-info)" : "var(--color-text-primary)",
              display: "flex", alignItems: "center", gap: "6px"
            }}>
              <i className="ti ti-clipboard-text" aria-hidden="true"></i>Prontuário completo
            </button>
            <button onClick={() => setMode("documentos")} style={{
              padding: "8px 16px", borderRadius: "8px", fontSize: "14px",
              border: mode === "documentos" ? "0.5px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
              background: mode === "documentos" ? "var(--color-background-info)" : "transparent",
              color: mode === "documentos" ? "var(--color-text-info)" : "var(--color-text-primary)",
              display: "flex", alignItems: "center", gap: "6px"
            }}>
              <i className="ti ti-file-text" aria-hidden="true"></i>Documentos
            </button>
          </div>
          <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "10px" }}>
            {activePatient.ident.nome || "Paciente sem nome"}
            {activePatient.ident.prontuario && <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400 }}> · prontuário {activePatient.ident.prontuario}</span>}
            <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400 }}> · consulta de {fmtDate(activeConsulta.data)}</span>
          </div>

          {mode === "prontuario" && (
            <RecordView patient={activePatient} updatePatient={updateActivePatient} consulta={activeConsulta} updateConsulta={updateActiveConsulta} activeTab={activeTab} setActiveTab={setActiveTab} />
          )}
          {mode === "documentos" && (
            <DocumentosView patient={activePatient} consulta={activeConsulta} updateConsulta={updateActiveConsulta} activeDocTab={activeDocTab} setActiveDocTab={setActiveDocTab} onPrint={setPrintDoc} />
          )}
        </div>
      )}

      {printDoc && <PrintDocRenderer doc={printDoc} patient={activePatient} consulta={activeConsulta} onClose={() => setPrintDoc(null)} />}
    </div>
  );
}

function ConsultasView({ patient, onOpenConsulta, onCreateConsulta, onRemoveConsulta, updatePatient }) {
  const consultas = [...(patient.consultas || [])].sort((a, b) => new Date(b.data) - new Date(a.data));
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
                <button onClick={() => onOpenConsulta(c.id, "documentos")} aria-label="Documentos"><i className="ti ti-file-text" aria-hidden="true"></i></button>
                <button onClick={() => onOpenConsulta(c.id, "prontuario")} aria-label="Abrir consulta"><i className="ti ti-edit" aria-hidden="true"></i></button>
                <button onClick={() => { if (confirm("Excluir esta consulta permanentemente?")) onRemoveConsulta(c.id); }} aria-label="Excluir"><i className="ti ti-trash" aria-hidden="true"></i></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PatientList({ patients, search, setSearch, onOpen, onCreate, onDelete }) {
  return (
    <div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        <input type="text" placeholder="Buscar por nome ou prontuário..." value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1 }} />
        <button onClick={onCreate} style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}>
          <i className="ti ti-plus" aria-hidden="true"></i>Novo paciente
        </button>
      </div>

      {patients.length === 0 && (
        <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--color-text-secondary)" }}>
          <i className="ti ti-users" style={{ fontSize: "32px", display: "block", marginBottom: "8px" }} aria-hidden="true"></i>
          Nenhum paciente cadastrado ainda.
        </div>
      )}

      <div style={{ display: "grid", gap: "8px" }}>
        {patients.map(p => {
          const idade = calcIdade(p.ident.dn);
          const numConsultas = (p.consultas || []).length;
          return (
            <div key={p.id} onClick={() => onOpen(p.id)} style={{ cursor: "pointer", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "12px", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--color-background-primary)" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: "15px" }}>{p.ident.nome || "Paciente sem nome"}</div>
                <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginTop: "2px" }}>
                  {p.ident.prontuario ? `Prontuário ${p.ident.prontuario}` : "Sem prontuário"}
                  {idade != null && ` · ${idade} anos`}
                  {` · ${numConsultas} consulta(s)`}
                </div>
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <button onClick={(e) => { e.stopPropagation(); if (confirm("Excluir este paciente e todas as suas consultas permanentemente?")) onDelete(p.id); }} aria-label="Excluir"><i className="ti ti-trash" aria-hidden="true"></i></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecordView({ patient, updatePatient, consulta, updateConsulta, activeTab, setActiveTab }) {
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
      {activeTab === "aga" && <AgaTab consulta={consulta} updateConsulta={updateConsulta} />}
      {activeTab === "prevencao" && <PrevencaoTab consulta={consulta} updateConsulta={updateConsulta} />}
      {activeTab === "exame" && <ExameTab consulta={consulta} updateConsulta={updateConsulta} />}
      {activeTab === "exames" && <ExamesTab consulta={consulta} updateConsulta={updateConsulta} />}
      {activeTab === "plano" && <PlanoTab consulta={consulta} updateConsulta={updateConsulta} />}
      {activeTab === "pendencias" && <PendenciasTab consulta={consulta} updateConsulta={updateConsulta} />}
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
        <Field label="Prontuário"><input value={i.prontuario} onChange={e => set("prontuario", e.target.value)} /></Field>
        <Field label="Nome completo"><input value={i.nome} onChange={e => set("nome", e.target.value)} /></Field>
        <Field label="CPF"><input value={i.cpf} onChange={e => set("cpf", e.target.value)} placeholder="000.000.000-00" /></Field>
        <Field label="Sexo">
          <select value={i.sexo} onChange={e => set("sexo", e.target.value)}>
            <option value="">Selecione</option>
            <option value="M">Masculino</option>
            <option value="F">Feminino</option>
          </select>
        </Field>
        <Field label="Data de nascimento" hint={idade != null ? `Idade calculada: ${idade} anos` : null}>
          <input type="date" value={i.dn} onChange={e => set("dn", e.target.value)} />
        </Field>
        <Field label="Nome da mãe"><input value={i.maeNome} onChange={e => set("maeNome", e.target.value)} /></Field>
        <Field label="Naturalidade"><input value={i.natural} onChange={e => set("natural", e.target.value)} /></Field>
        <Field label="Procedência"><input value={i.procedente} onChange={e => set("procedente", e.target.value)} /></Field>
        <Field label="Profissão"><input value={i.profissao} onChange={e => set("profissao", e.target.value)} /></Field>
        <Field label="Escolaridade"><input value={i.escolaridade} onChange={e => set("escolaridade", e.target.value)} /></Field>
        <Field label="Estado civil">
          <select value={i.estadoCivil} onChange={e => set("estadoCivil", e.target.value)}>
            <option value="">Selecione</option>
            <option>Solteiro(a)</option><option>Casado(a)</option><option>Divorciado(a)</option><option>Viúvo(a)</option><option>União estável</option>
          </select>
        </Field>
        <Field label="Religião"><input value={i.religiao} onChange={e => set("religiao", e.target.value)} /></Field>
        <Field label="Acompanhante"><input value={i.acompanhante} onChange={e => set("acompanhante", e.target.value)} /></Field>
        <Field label="Cuidador principal"><input value={i.cuidador} onChange={e => set("cuidador", e.target.value)} /></Field>
        <Field label="Mora com"><input value={i.moraCom} onChange={e => set("moraCom", e.target.value)} /></Field>
        <Field label="Telefone"><input value={i.telefone} onChange={e => set("telefone", e.target.value)} /></Field>
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

  const toggleCustom = (id) => updateConsulta(p => ({ ...p, problemasCustom: p.problemasCustom.map(c => c.id === id ? { ...c, checked: !c.checked } : c) }));
  const setNotaCustom = (id, valor) => updateConsulta(p => ({ ...p, problemasCustom: p.problemasCustom.map(c => c.id === id ? { ...c, nota: valor } : c) }));
  const removeCustom = (id) => updateConsulta(p => ({ ...p, problemasCustom: p.problemasCustom.filter(c => c.id !== id) }));
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
        </div>
      </SectionCard>

      <SectionCard title="Comorbidades adicionadas" icon="ti-plus">
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginTop: 0 }}>Adicione comorbidades que não estão na lista padrão.</p>
        <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
          <input
            value={novoNome}
            onChange={e => setNovoNome(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addCustom()}
            placeholder="Nome da comorbidade..."
            style={{ flex: 1 }}
          />
          <button onClick={addCustom}><i className="ti ti-plus" aria-hidden="true"></i></button>
        </div>
        {custom.length === 0 && <p style={{ fontSize: "13px", color: "var(--color-text-tertiary)" }}>Nenhuma comorbidade adicionada ainda.</p>}
        <div style={{ display: "grid", gap: "2px" }}>
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
    </div>
  );
}

function AntecedentesTab({ consulta, updateConsulta }) {
  const a = consulta.antecedentes;
  const set = (k, v) => updateConsulta(p => ({ ...p, antecedentes: { ...p.antecedentes, [k]: v } }));
  return (
    <SectionCard title="Antecedentes" icon="ti-history">
      <Field label="Tabagismo">
        <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
          {["Nunca fumou", "Ex-tabagista", "Tabagista atual"].map(opt => (
            <label key={opt} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px" }}>
              <input type="radio" name="tabagismo" checked={a.tabagismo === opt} onChange={() => set("tabagismo", opt)} />{opt}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Carga tabágica (anos-maço) / tempo de cessação"><input value={a.cargaTabagica} onChange={e => set("cargaTabagica", e.target.value)} /></Field>
      <Field label="Etilismo">
        <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
          {["Nega", "Social", "Abuso/dependência", "Ex-etilista"].map(opt => (
            <label key={opt} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px" }}>
              <input type="radio" name="etilismo" checked={a.etilismo === opt} onChange={() => set("etilismo", opt)} />{opt}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Tipo de bebida e quantidade"><input value={a.etilismoDetalhe} onChange={e => set("etilismoDetalhe", e.target.value)} placeholder="ex: cerveja, 2 latas nos fins de semana" /></Field>
      <Field label="Atividade física">
        <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
          {["Sedentário", "Irregular", "Regular (≥150 min/semana)"].map(opt => (
            <label key={opt} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px" }}>
              <input type="radio" name="af" checked={a.atividadeFisica === opt} onChange={() => set("atividadeFisica", opt)} />{opt}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Cirurgias prévias"><textarea rows={2} value={a.cirurgias} onChange={e => set("cirurgias", e.target.value)} /></Field>
      <Field label="Internamentos no último ano"><textarea rows={2} value={a.internamentos} onChange={e => set("internamentos", e.target.value)} /></Field>
      <Field label="Alergias"><input value={a.alergias} onChange={e => set("alergias", e.target.value)} /></Field>
      <Field label="Histórico familiar"><textarea rows={2} value={a.historicoFamiliar} onChange={e => set("historicoFamiliar", e.target.value)} /></Field>
    </SectionCard>
  );
}

function MedicacoesTab({ consulta, updateConsulta }) {
  const texto = consulta.medicacoesTexto || "";
  const linhas = texto.split("\n").map(l => l.trim()).filter(Boolean);
  const beersAlerts = linhas.filter(l => checkBeers(l));

  return (
    <div>
      <SectionCard title="Medicações em uso" icon="ti-pill">
        {beersAlerts.length > 0 && (
          <Alert type="warning">
            {beersAlerts.length} linha(s) mencionam fármacos constantes nos Critérios de Beers 2023 como potencialmente inapropriados para idosos: {beersAlerts.join(" / ")}. Avalie risco/benefício e considere desprescrição ou alternativa.
          </Alert>
        )}
        <textarea
          rows={10}
          value={texto}
          onChange={e => updateConsulta(p => ({ ...p, medicacoesTexto: e.target.value }))}
          placeholder={"Liste as medicações em uso, uma por linha. Ex:\nLosartana 50mg - 1cp pela manhã e à noite\nAAS 100mg - 1cp após almoço"}
        />
      </SectionCard>
      <SectionCard title="Medicações de uso prévio / descontinuadas" icon="ti-history" defaultOpen={false}>
        <textarea rows={3} value={consulta.medicacoesPrevias} onChange={e => updateConsulta(p => ({ ...p, medicacoesPrevias: e.target.value }))} placeholder="Medicação, motivo da descontinuação..." />
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

function AgaTab({ consulta, updateConsulta }) {
  const aga = consulta.aga;
  const set = (k, v) => updateConsulta(p => ({ ...p, aga: { ...p.aga, [k]: v } }));

  const AIVD_ITEMS = ["Telefone","Transporte","Compras","Preparar refeições","Tarefas domésticas","Trabalhos manuais","Lavar roupas","Medicações","Finanças"];
  const ABVD_ITEMS = ["Banho","Vestir-se","Higiene pessoal","Transferência","Continência","Alimentação"];
  const FRAIL_ITEMS = [
    { key: "fatigue", label: "Fatigue — fadiga" },
    { key: "resistance", label: "Resistance — resistência" },
    { key: "ambulation", label: "Ambulation — deambulação" },
    { key: "illness", label: "Illness — >5 doenças" },
    { key: "loss", label: "Loss — perda de peso" },
  ];

  const aivdCount = AIVD_ITEMS.filter(it => aga.aivd[it]).length;
  const abvdCount = ABVD_ITEMS.filter(it => aga.abvd[it]).length;
  const frailCount = FRAIL_ITEMS.filter(it => aga.frail[it.key]).length;
  const frailClass = frailCount === 0 ? "Robusto" : frailCount <= 2 ? "Pré-frágil" : "Frágil";
  const frailColor = frailCount === 0 ? "success" : frailCount <= 2 ? "warning" : "danger";

  const imc = calcIMC(aga.peso, aga.altura);
  const imcLabel = imc ? (imc < 22 ? "Baixo peso (idoso)" : imc < 27 ? "Eutrófico" : imc < 30 ? "Sobrepeso" : "Obesidade") : null;

  const gdsNum = parseInt(aga.gds15, 10);
  const gdsPositive = !isNaN(gdsNum) && gdsNum >= 6;

  const toggleAivd = (item) => set("aivd", { ...aga.aivd, [item]: !aga.aivd[item] });
  const toggleAbvd = (item) => set("abvd", { ...aga.abvd, [item]: !aga.abvd[item] });
  const toggleFrail = (key) => set("frail", { ...aga.frail, [key]: !aga.frail[key] });

  return (
    <div>
      <SectionCard title="Funcionalidade" icon="ti-walk">
        <Field label={`AIVD (Lawton) — independente em ${aivdCount}/9`}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "4px" }}>
            {AIVD_ITEMS.map(item => (
              <label key={item} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
                <input type="checkbox" checked={!!aga.aivd[item]} onChange={() => toggleAivd(item)} />{item}
              </label>
            ))}
          </div>
        </Field>
        <Field label={`ABVD (Katz) — independente em ${abvdCount}/6`}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "4px" }}>
            {ABVD_ITEMS.map(item => (
              <label key={item} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
                <input type="checkbox" checked={!!aga.abvd[item]} onChange={() => toggleAbvd(item)} />{item}
              </label>
            ))}
          </div>
        </Field>
      </SectionCard>

      <SectionCard title="Mobilidade" icon="ti-wheelchair">
        <Field label="Marcha"><RadioGroup name="marcha" value={aga.marcha} onChange={v => set("marcha", v)} options={[{value:"preservada",label:"Preservada"},{value:"lentificacao",label:"Lentificação"},{value:"auxilio",label:"Com auxílio"}]} /></Field>
        <Field label="Dispositivo"><RadioGroup name="disp" value={aga.dispositivo} onChange={v => set("dispositivo", v)} options={[{value:"nenhum",label:"Nenhum"},{value:"bengala",label:"Bengala"},{value:"andador",label:"Andador"},{value:"cadeira",label:"Cadeira de rodas"}]} /></Field>
      </SectionCard>

      <SectionCard title="Fragilidade (FRAIL)" icon="ti-heart-rate-monitor">
        <div style={{ display: "grid", gap: "4px", marginBottom: "10px" }}>
          {FRAIL_ITEMS.map(it => (
            <label key={it.key} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px" }}>
              <input type="checkbox" checked={!!aga.frail[it.key]} onChange={() => toggleFrail(it.key)} />{it.label}
            </label>
          ))}
        </div>
        <Pill color={frailColor}>{frailClass} ({frailCount}/5 critérios)</Pill>
      </SectionCard>

      <SectionCard title="Cognição" icon="ti-brain">
        <Row cols="repeat(3, 1fr)">
          <Field label="Mini-Cog"><input value={aga.minicog} onChange={e => set("minicog", e.target.value)} /></Field>
          <Field label="MEEM"><input value={aga.meem} onChange={e => set("meem", e.target.value)} /></Field>
          <Field label="MoCA"><input value={aga.moca} onChange={e => set("moca", e.target.value)} /></Field>
        </Row>
      </SectionCard>

      <SectionCard title="Humor" icon="ti-mood-sad">
        <Field label="GDS-15 (pontuação)" hint="Pontuação ≥6 sugere rastreio positivo para sintomas depressivos">
          <input type="number" min="0" max="15" value={aga.gds15} onChange={e => set("gds15", e.target.value)} style={{ maxWidth: "100px" }} />
        </Field>
        {gdsPositive && <Alert type="warning">GDS-15 = {gdsNum}: rastreio positivo para sintomas depressivos. Considerar avaliação complementar.</Alert>}
      </SectionCard>

      <SectionCard title="Quedas" icon="ti-alert-octagon">
        <Field label="Quedas no último ano">
          <RadioGroup name="quedas" value={aga.quedas} onChange={v => set("quedas", v)} options={[{value:"nega",label:"Nega"},{value:"sim",label:"Sim"}]} />
        </Field>
        {aga.quedas === "sim" && <Field label="Número de quedas"><input value={aga.quedasNum} onChange={e => set("quedasNum", e.target.value)} style={{ maxWidth: "100px" }} /></Field>}
        <Field label="Fraturas associadas"><RadioGroup name="fraturas" value={aga.fraturas} onChange={v => set("fraturas", v)} options={[{value:"nao",label:"Não"},{value:"sim",label:"Sim"}]} /></Field>
        <Field label="TCE associado"><RadioGroup name="tce" value={aga.tce} onChange={v => set("tce", v)} options={[{value:"nao",label:"Não"},{value:"sim",label:"Sim"}]} /></Field>
      </SectionCard>

      <SectionCard title="Sono" icon="ti-moon">
        <Field label="Padrão de sono / queixas"><textarea rows={2} value={aga.sono} onChange={e => set("sono", e.target.value)} /></Field>
      </SectionCard>

      <SectionCard title="Nutrição" icon="ti-apple">
        <Row cols="repeat(3, 1fr)">
          <Field label="Peso (kg)"><input type="number" value={aga.peso} onChange={e => set("peso", e.target.value)} /></Field>
          <Field label="Altura (m)"><input type="number" step="0.01" value={aga.altura} onChange={e => set("altura", e.target.value)} /></Field>
          <Field label="IMC calculado" hint={imcLabel}>
            <input value={imc || ""} disabled style={{ background: "var(--color-background-secondary)" }} />
          </Field>
        </Row>
        <Field label="Perda de peso não intencional">
          <RadioGroup name="perdapeso" value={aga.perdaPeso} onChange={v => set("perdaPeso", v)} options={[{value:"nao",label:"Não"},{value:"sim",label:"Sim"}]} />
        </Field>
        {aga.perdaPeso === "sim" && (
          <Row cols="repeat(2, 1fr)">
            <Field label="Percentual (%)"><input value={aga.perdaPesoPerc} onChange={e => set("perdaPesoPerc", e.target.value)} /></Field>
            <Field label="Em quantos meses"><input value={aga.perdaPesoMeses} onChange={e => set("perdaPesoMeses", e.target.value)} /></Field>
          </Row>
        )}
        <Field label="Apetite"><RadioGroup name="apetite" value={aga.apetite} onChange={v => set("apetite", v)} options={[{value:"preservado",label:"Preservado"},{value:"reduzido",label:"Reduzido"},{value:"aumentado",label:"Aumentado"}]} /></Field>
        <Field label="Disfagia"><RadioGroup name="disfagia" value={aga.disfagia} onChange={v => set("disfagia", v)} options={[{value:"ausente",label:"Ausente"},{value:"presente",label:"Presente"}]} /></Field>
        {aga.disfagia === "presente" && (
          <Field label="Tipo de dieta"><input value={aga.disfagiaDieta} onChange={e => set("disfagiaDieta", e.target.value)} placeholder="ex: dieta pastosa, líquidos espessados" /></Field>
        )}
        <Field label="Problemas dentários / uso de prótese"><RadioGroup name="dentarios" value={aga.dentarios} onChange={v => set("dentarios", v)} options={[{value:"nao",label:"Não"},{value:"sim",label:"Sim"}]} /></Field>
      </SectionCard>

      <SectionCard title="Continências" icon="ti-droplet">
        <Field label="TGI (fecal)"><RadioGroup name="tgi" value={aga.tgi} onChange={v => set("tgi", v)} options={[{value:"continente",label:"Continente"},{value:"ocasional",label:"Incontinência ocasional"},{value:"frequente",label:"Incontinência frequente"}]} /></Field>
        <Field label="TGU (urinária)"><RadioGroup name="tgu" value={aga.tgu} onChange={v => set("tgu", v)} options={[{value:"continente",label:"Continente"},{value:"esforco",label:"De esforço"},{value:"urgencia",label:"De urgência"},{value:"mista",label:"Mista"}]} /></Field>
      </SectionCard>

      <SectionCard title="Sensorial" icon="ti-eye">
        <Field label="Visão"><RadioGroup name="visao" value={aga.visao} onChange={v => set("visao", v)} options={[{value:"preservada",label:"Preservada"},{value:"corrigido",label:"Déficit corrigido"},{value:"nao_corrigido",label:"Déficit não corrigido"}]} /></Field>
        <Field label="Audição"><RadioGroup name="audicao" value={aga.audicao} onChange={v => set("audicao", v)} options={[{value:"preservada",label:"Preservada"},{value:"corrigido",label:"Déficit corrigido (AASI)"},{value:"nao_corrigido",label:"Déficit não corrigido"}]} /></Field>
      </SectionCard>

      <SectionCard title="Atividade física e lazer" icon="ti-run" defaultOpen={false}>
        <Field label="Atividade física habitual"><input value={aga.atividadeFisicaLazer} onChange={e => set("atividadeFisicaLazer", e.target.value)} /></Field>
        <Field label="Atividades de lazer / interação social"><input value={aga.lazer} onChange={e => set("lazer", e.target.value)} /></Field>
      </SectionCard>
    </div>
  );
}

function PrevencaoTab({ consulta, updateConsulta }) {
  const vac = consulta.vacinas || {};
  const setVacField = (nome, campo, v) => updateConsulta(p => ({ ...p, vacinas: { ...p.vacinas, [nome]: { ...(p.vacinas[nome]||{}), [campo]: v } } }));
  const rg = consulta.rastreioGeral || {};
  const setRg = (nome, k, v) => updateConsulta(p => ({ ...p, rastreioGeral: { ...p.rastreioGeral, [nome]: { ...(p.rastreioGeral[nome]||{}), [k]: v } } }));
  const re = consulta.rastreioEspecifico || {};
  const setRe = (nome, k, v) => updateConsulta(p => ({ ...p, rastreioEspecifico: { ...p.rastreioEspecifico, [nome]: { ...(p.rastreioEspecifico[nome]||{}), [k]: v } } }));

  const ativos = PROBLEMAS.filter(p => consulta.problemas && consulta.problemas[p] && PREVENCAO_ESPECIFICA[p]);

  return (
    <div>
      <SectionCard title="Situação vacinal" icon="ti-vaccine">
        <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: 0 }}>Campos de data conforme o esquema completo de cada vacina (calendário de vacinação do idoso).</p>

        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontWeight: 500, fontSize: "14px", marginBottom: "6px" }}>Influenza (dose anual)</div>
          <Row cols="repeat(2, 1fr)">
            <Field label="Última dose"><input type="date" value={vac.influenza?.dose || ""} onChange={e => setVacField("influenza", "dose", e.target.value)} /></Field>
            <Field label="Próximo reforço"><input type="date" value={vac.influenza?.reforco || ""} onChange={e => setVacField("influenza", "reforco", e.target.value)} /></Field>
          </Row>
        </div>

        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontWeight: 500, fontSize: "14px", marginBottom: "6px" }}>COVID-19 (reforço a cada 6 meses)</div>
          <Row cols="repeat(2, 1fr)">
            <Field label="Dose"><input type="date" value={vac.covid?.dose || ""} onChange={e => setVacField("covid", "dose", e.target.value)} /></Field>
            <Field label="Próximo reforço (6 meses)"><input type="date" value={vac.covid?.reforco || ""} onChange={e => setVacField("covid", "reforco", e.target.value)} /></Field>
          </Row>
        </div>

        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontWeight: 500, fontSize: "14px", marginBottom: "6px" }}>Pneumocócica</div>
          <Field label="VPC20 (dose única)"><input type="date" value={vac.pneumo?.vpc20 || ""} onChange={e => setVacField("pneumo", "vpc20", e.target.value)} /></Field>
          <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "0 0 8px" }}>Se indisponibilidade de VPC20:</p>
          <Row cols="repeat(3, 1fr)">
            <Field label="VPC13/15"><input type="date" value={vac.pneumo?.vpc13 || ""} onChange={e => setVacField("pneumo", "vpc13", e.target.value)} /></Field>
            <Field label="VPP23 (após 2m)"><input type="date" value={vac.pneumo?.vpp23_1 || ""} onChange={e => setVacField("pneumo", "vpp23_1", e.target.value)} /></Field>
            <Field label="VPP23 (reforço 5a)"><input type="date" value={vac.pneumo?.vpp23_2 || ""} onChange={e => setVacField("pneumo", "vpp23_2", e.target.value)} /></Field>
          </Row>
        </div>

        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontWeight: 500, fontSize: "14px", marginBottom: "6px" }}>dT / dTpa</div>
          <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "0 0 8px" }}>Sem esquema prévio:</p>
          <Row cols="repeat(3, 1fr)">
            <Field label="dT (1ª dose)"><input type="date" value={vac.dtpa?.dt1 || ""} onChange={e => setVacField("dtpa", "dt1", e.target.value)} /></Field>
            <Field label="dT (após 2m)"><input type="date" value={vac.dtpa?.dt2 || ""} onChange={e => setVacField("dtpa", "dt2", e.target.value)} /></Field>
            <Field label="dTpa (após 2m da última)"><input type="date" value={vac.dtpa?.dtpa1 || ""} onChange={e => setVacField("dtpa", "dtpa1", e.target.value)} /></Field>
          </Row>
          <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "8px 0" }}>Com esquema prévio:</p>
          <Field label="dTpa (reforço a cada 10 anos)"><input type="date" value={vac.dtpa?.reforco || ""} onChange={e => setVacField("dtpa", "reforco", e.target.value)} /></Field>
        </div>

        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontWeight: 500, fontSize: "14px", marginBottom: "6px" }}>Hepatite B</div>
          <Row cols="repeat(3, 1fr)">
            <Field label="1ª dose"><input type="date" value={vac.hepB?.dose1 || ""} onChange={e => setVacField("hepB", "dose1", e.target.value)} /></Field>
            <Field label="2ª dose (após 1 mês)"><input type="date" value={vac.hepB?.dose2 || ""} onChange={e => setVacField("hepB", "dose2", e.target.value)} /></Field>
            <Field label="3ª dose (após 6 meses da 1ª)"><input type="date" value={vac.hepB?.dose3 || ""} onChange={e => setVacField("hepB", "dose3", e.target.value)} /></Field>
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
            <Field label="2ª dose (após 2 meses)"><input type="date" value={vac.vzr?.dose2 || ""} onChange={e => setVacField("vzr", "dose2", e.target.value)} /></Field>
          </Row>
        </div>
      </SectionCard>

      <SectionCard title="Prevenção — rastreio geral" icon="ti-shield-check" defaultOpen={false}>
        {RASTREIO_GERAL.map(r => {
          const data = rg[r.nome] || {};
          return (
            <div key={r.nome} style={{ display: "flex", alignItems: "flex-end", gap: "10px", flexWrap: "wrap", borderBottom: "0.5px solid var(--color-border-tertiary)", padding: "8px 0" }}>
              <div style={{ minWidth: "160px", flex: "1 1 220px" }}>
                <div style={{ fontWeight: 500, fontSize: "14px" }}>{r.nome}</div>
                <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>{r.criterio}</div>
              </div>
              <Field label="Realizado em"><input type="date" value={data.data || ""} onChange={e => setRg(r.nome, "data", e.target.value)} /></Field>
              <Field label="Resultado"><input value={data.resultado || ""} onChange={e => setRg(r.nome, "resultado", e.target.value)} /></Field>
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
              const data = re[key] || {};
              return (
                <div key={key} style={{ display: "flex", alignItems: "flex-end", gap: "10px", flexWrap: "wrap", padding: "6px 0" }}>
                  <div style={{ minWidth: "200px", flex: "1 1 240px", fontSize: "13px" }}>{item}</div>
                  <Field label="Data"><input type="date" value={data.data || ""} onChange={e => setRe(key, "data", e.target.value)} /></Field>
                  <Field label="Resultado"><input value={data.resultado || ""} onChange={e => setRe(key, "resultado", e.target.value)} /></Field>
                </div>
              );
            })}
          </div>
        ))}
      </SectionCard>
    </div>
  );
}

function ExameTab({ consulta, updateConsulta }) {
  const e = consulta.exameFisico;
  const set = (k, v) => updateConsulta(p => ({ ...p, exameFisico: { ...p.exameFisico, [k]: v } }));
  return (
    <div>
      <SectionCard title="Sinais vitais" icon="ti-heartbeat">
        <Row cols="repeat(5, 1fr)">
          <Field label="PA (mmHg)"><input value={e.pa} onChange={ev => set("pa", ev.target.value)} /></Field>
          <Field label="FC (bpm)"><input value={e.fc} onChange={ev => set("fc", ev.target.value)} /></Field>
          <Field label="FR (irpm)"><input value={e.fr} onChange={ev => set("fr", ev.target.value)} /></Field>
          <Field label="SatO2 (%AA)"><input value={e.sato2} onChange={ev => set("sato2", ev.target.value)} /></Field>
          <Field label="Temp (°C)"><input value={e.temp} onChange={ev => set("temp", ev.target.value)} /></Field>
        </Row>
      </SectionCard>
      <SectionCard title="Exame físico segmentar" icon="ti-stethoscope">
        <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: 0 }}>Achados padrão pré-preenchidos — edite conforme o exame real.</p>
        {[["geral","Geral"],["acv","ACV"],["ar","AR"],["abd","ABD"],["ext","EXT"],["sn","SN"],["pele","Pele"]].map(([k,label]) => (
          <Field key={k} label={label}><textarea rows={2} value={e[k]} onChange={ev => set(k, ev.target.value)} /></Field>
        ))}
      </SectionCard>
    </div>
  );
}

function ExamesTab({ consulta, updateConsulta }) {
  return (
    <div>
      <SectionCard title="Laboratoriais" icon="ti-flask">
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

function PlanoTab({ consulta, updateConsulta }) {
  const pl = consulta.plano;
  const set = (k, v) => updateConsulta(p => ({ ...p, plano: { ...p.plano, [k]: v } }));
  return (
    <SectionCard title="Plano terapêutico" icon="ti-target-arrow">
      <Field label="Ajuste medicamentoso"><textarea rows={3} value={pl.ajuste} onChange={e => set("ajuste", e.target.value)} /></Field>
      <Field label="Exames solicitados"><textarea rows={3} value={pl.exames} onChange={e => set("exames", e.target.value)} /></Field>
      <Field label="Encaminhamentos"><textarea rows={2} value={pl.encaminhamentos} onChange={e => set("encaminhamentos", e.target.value)} /></Field>
      <Field label="Orientações gerais"><textarea rows={2} value={pl.orientacoes} onChange={e => set("orientacoes", e.target.value)} /></Field>
      <Field label="Retorno agendado em"><input type="date" value={pl.retorno} onChange={e => set("retorno", e.target.value)} /></Field>
    </SectionCard>
  );
}

function PendenciasTab({ consulta, updateConsulta }) {
  const pend = consulta.pendencias || [];
  const [text, setText] = useState("");
  const add = () => {
    if (!text.trim()) return;
    updateConsulta(p => ({ ...p, pendencias: [...p.pendencias, { id: uid(), text: text.trim(), done: false, createdAt: new Date().toISOString() }] }));
    setText("");
  };
  const toggle = (id) => updateConsulta(p => ({ ...p, pendencias: p.pendencias.map(x => x.id === id ? { ...x, done: !x.done } : x) }));
  const remove = (id) => updateConsulta(p => ({ ...p, pendencias: p.pendencias.filter(x => x.id !== id) }));

  const pendentes = pend.filter(x => !x.done);
  const feitas = pend.filter(x => x.done);

  return (
    <div>
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

      <SectionCard title="Pendências não preenchidas na consulta atual" icon="ti-file-alert">
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginTop: 0 }}>Descreva itens da Avaliação Geriátrica Ampla, exames ou outras partes do prontuário que não foi possível preencher nesta consulta, para retomar depois.</p>
        <textarea
          rows={4}
          value={consulta.pendenciasConsultaAtual || ""}
          onChange={e => updateConsulta(p => ({ ...p, pendenciasConsultaAtual: e.target.value }))}
          placeholder="ex: GDS-15 não aplicado por tempo, completar na próxima consulta"
        />
      </SectionCard>
    </div>
  );
}


function DocumentosView({ patient, consulta, updateConsulta, activeDocTab, setActiveDocTab, onPrint }) {
  return (
    <div>
      <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "8px", marginBottom: "14px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
        {DOC_TABS.map(t => (
          <button key={t.id} onClick={() => setActiveDocTab(t.id)} style={{
            whiteSpace: "nowrap", fontSize: "13px", padding: "6px 12px",
            border: activeDocTab === t.id ? "0.5px solid var(--color-border-info)" : "0.5px solid transparent",
            background: activeDocTab === t.id ? "var(--color-background-info)" : "transparent",
            color: activeDocTab === t.id ? "var(--color-text-info)" : "var(--color-text-secondary)",
            borderRadius: "8px", display: "flex", alignItems: "center", gap: "5px"
          }}>
            <i className={"ti " + t.icon} aria-hidden="true" style={{ fontSize: "14px" }}></i>{t.label}
          </button>
        ))}
      </div>
      {activeDocTab === "receita" && <ReceitaTab consulta={consulta} updateConsulta={updateConsulta} patient={patient} onPrint={onPrint} />}
      {activeDocTab === "receitaEspecial" && <ReceitaEspecialTab consulta={consulta} updateConsulta={updateConsulta} patient={patient} onPrint={onPrint} />}
      {activeDocTab === "exameSimples" && <ExameSimplesTab consulta={consulta} updateConsulta={updateConsulta} patient={patient} onPrint={onPrint} />}
      {activeDocTab === "exameEspecial" && <ExameEspecialTab consulta={consulta} updateConsulta={updateConsulta} patient={patient} onPrint={onPrint} />}
      {activeDocTab === "vacinacao" && <VacinacaoDocTab consulta={consulta} updateConsulta={updateConsulta} patient={patient} onPrint={onPrint} />}
    </div>
  );
}

function ReceitaTab({ patient, consulta, updateConsulta, onPrint }) {
  const sel = (consulta.docs && consulta.docs.receitaSelecionados) || {};
  const edits = (consulta.docs && consulta.docs.receitaItensEditados) || {};
  const extras = (consulta.docs && consulta.docs.receitaExtras) || "";

  const toggleItem = (categoria, nome) => {
    const key = categoria + "::" + nome;
    updateConsulta(p => ({ ...p, docs: { ...p.docs, receitaSelecionados: { ...p.docs.receitaSelecionados, [key]: !p.docs.receitaSelecionados[key] } } }));
  };
  const setEditField = (categoria, nome, campo, valor) => {
    const key = categoria + "::" + nome;
    updateConsulta(p => ({ ...p, docs: { ...p.docs, receitaItensEditados: { ...p.docs.receitaItensEditados, [key]: { ...(p.docs.receitaItensEditados[key] || {}), [campo]: valor } } } }));
  };
  const setExtras = (valor) => updateConsulta(p => ({ ...p, docs: { ...p.docs, receitaExtras: valor } }));

  const countSelecionados = Object.values(sel).filter(Boolean).length;

  return (
    <div>
      <Alert type="info">Marque os itens que deseja incluir na receita. Você pode editar o nome, quantidade e posologia de cada item antes de gerar o documento. Use o campo no final para adicionar medicações que não estão nos blocos.</Alert>
      {RECEITA_BLOCOS.map(bloco => (
        <SectionCard key={bloco.categoria} title={bloco.categoria} icon="ti-pill" defaultOpen={false}>
          {bloco.itens.map(item => {
            const key = bloco.categoria + "::" + item.nome;
            const edit = edits[key] || {};
            const isSelected = !!sel[key];
            return (
              <div key={key} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)", padding: "8px 0" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", marginBottom: isSelected ? "8px" : 0 }}>
                  <input type="checkbox" checked={isSelected} onChange={() => toggleItem(bloco.categoria, item.nome)} />
                  <span style={{ fontWeight: 500, fontSize: "13px" }}>{edit.nome !== undefined ? edit.nome : item.nome}</span>
                  <span style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>— {edit.qtd !== undefined ? edit.qtd : item.qtd}</span>
                </label>
                {isSelected && (
                  <div style={{ paddingLeft: "24px", display: "grid", gap: "6px" }}>
                    <Row cols="2fr 1fr">
                      <Field label="Nome/dose"><input value={edit.nome !== undefined ? edit.nome : item.nome} onChange={e => setEditField(bloco.categoria, item.nome, "nome", e.target.value)} /></Field>
                      <Field label="Quantidade"><input value={edit.qtd !== undefined ? edit.qtd : item.qtd} onChange={e => setEditField(bloco.categoria, item.nome, "qtd", e.target.value)} /></Field>
                    </Row>
                    <Field label="Posologia"><textarea rows={2} value={edit.posologia !== undefined ? edit.posologia : item.posologia} onChange={e => setEditField(bloco.categoria, item.nome, "posologia", e.target.value)} /></Field>
                  </div>
                )}
              </div>
            );
          })}
        </SectionCard>
      ))}

      <SectionCard title="Medicações adicionais (fora dos blocos)" icon="ti-plus">
        <Field label="Digite as medicações extras, uma por linha" hint="Serão incluídas no final da receita gerada">
          <textarea rows={4} value={extras} onChange={e => setExtras(e.target.value)} placeholder={"ex:\nVITAMINA C 500MG — 30CP/MÊS\nTOMAR 1 COMPRIMIDO PELA MANHÃ."} />
        </Field>
      </SectionCard>

      <div style={{ position: "sticky", bottom: "8px", display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
        <button onClick={() => onPrint({ type: "receita" })} disabled={countSelecionados === 0 && !extras.trim()} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <i className="ti ti-printer" aria-hidden="true"></i>Gerar receita
        </button>
      </div>
    </div>
  );
}

function ReceitaEspecialTab({ patient, consulta, updateConsulta, onPrint }) {
  const re = (consulta.docs && consulta.docs.receitaEspecial) || {};
  const set = (k, v) => updateConsulta(p => ({ ...p, docs: { ...p.docs, receitaEspecial: { ...p.docs.receitaEspecial, [k]: v } } }));
  return (
    <div>
      <Alert type="warning">Receituário de controle especial (notificação B/A). Use para psicotrópicos e entorpecentes sujeitos a controle especial. Os campos do comprador são preenchidos no momento da impressão/entrega, conforme quem retira a medicação.</Alert>
      <SectionCard title="Identificação do emitente" icon="ti-stethoscope">
        <Row cols="repeat(2, 1fr)">
          <Field label="Nome completo do médico"><input value={re.medicoNome} onChange={e => set("medicoNome", e.target.value)} /></Field>
          <Field label="CRM / UF / Nº"><input value={re.crmNum} onChange={e => set("crmNum", e.target.value)} placeholder="ex: 12345" /></Field>
        </Row>
        <Field label="Endereço completo e telefone"><input value={re.enderecoMedico} onChange={e => set("enderecoMedico", e.target.value)} /></Field>
        <Row cols="repeat(2, 1fr)">
          <Field label="Cidade"><input value={re.cidadeMedico} onChange={e => set("cidadeMedico", e.target.value)} /></Field>
          <Field label="UF"><input value={re.ufMedico} onChange={e => set("ufMedico", e.target.value)} style={{ maxWidth: "80px" }} /></Field>
        </Row>
      </SectionCard>
      <SectionCard title="Prescrição" icon="ti-prescription">
        <Field label="Uso e medicação prescrita" hint="ex: USO ORAL / DULOXETINA 30MG — 30 CP / TOMAR 1 COMPRIMIDO PELA MANHÃ.">
          <textarea rows={6} value={re.prescricao} onChange={e => set("prescricao", e.target.value)} />
        </Field>
      </SectionCard>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
        <button onClick={() => onPrint({ type: "receitaEspecial" })} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <i className="ti ti-printer" aria-hidden="true"></i>Gerar receita especial
        </button>
      </div>
    </div>
  );
}

function ExameSimplesTab({ patient, consulta, updateConsulta, onPrint }) {
  const es = (consulta.docs && consulta.docs.examesSimples) || { texto: "" };
  const texto = es.texto !== undefined ? es.texto : EXAMES_LABORATORIAIS_PADRAO.join("\n");
  const setTexto = (v) => updateConsulta(p => ({ ...p, docs: { ...p.docs, examesSimples: { ...p.docs.examesSimples, texto: v } } }));

  return (
    <div>
      <Alert type="info">Lista padrão de exames laboratoriais já preenchida. Edite livremente — adicione, remova ou modifique exames conforme necessário.</Alert>
      <SectionCard title="Exames laboratoriais" icon="ti-flask">
        <textarea rows={16} value={texto} onChange={e => setTexto(e.target.value)} placeholder="Liste os exames, um por linha..." />
      </SectionCard>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
        <button onClick={() => onPrint({ type: "exameSimples" })} disabled={!texto.trim()} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <i className="ti ti-printer" aria-hidden="true"></i>Gerar solicitação
        </button>
      </div>
    </div>
  );
}

function ExameEspecialTab({ patient, consulta, updateConsulta, onPrint }) {
  const ee = (consulta.docs && consulta.docs.examesEspecial) || {};
  const set = (k, v) => updateConsulta(p => ({ ...p, docs: { ...p.docs, examesEspecial: { ...p.docs.examesEspecial, [k]: v } } }));
  return (
    <div>
      <Alert type="info">Solicitação e autorização de exames especiais (imagem / procedimentos). Os dados de identificação do paciente são preenchidos automaticamente a partir da aba Identificação.</Alert>
      <SectionCard title="Dados puxados automaticamente da Identificação" icon="ti-id" defaultOpen={true}>
        <Row cols="repeat(3, 1fr)">
          <Field label="Nome da mãe"><input value={patient.ident.maeNome} disabled style={{ background: "var(--color-background-secondary)" }} /></Field>
          <Field label="Idade"><input value={calcIdade(patient.ident.dn) != null ? calcIdade(patient.ident.dn) + " anos" : ""} disabled style={{ background: "var(--color-background-secondary)" }} /></Field>
          <Field label="Sexo"><input value={patient.ident.sexo === "M" ? "Masculino" : patient.ident.sexo === "F" ? "Feminino" : ""} disabled style={{ background: "var(--color-background-secondary)" }} /></Field>
        </Row>
        <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: 0 }}>Para alterar esses dados, edite a aba Identificação do prontuário.</p>
      </SectionCard>
      <SectionCard title="Dados administrativos" icon="ti-id-badge-2">
        <Row cols="repeat(2, 1fr)">
          <Field label="Registro / prontuário" hint="Preenchido a partir da Identificação, se vazio"><input value={ee.registro} onChange={e => set("registro", e.target.value)} placeholder={patient.ident.prontuario} /></Field>
          <Field label="Enfermaria (ENF.)"><input value={ee.enf} onChange={e => set("enf", e.target.value)} /></Field>
        </Row>
        <Row cols="repeat(2, 1fr)">
          <Field label="Leito"><input value={ee.leito} onChange={e => set("leito", e.target.value)} /></Field>
          <Field label="Setor solicitante"><input value={ee.setorSolicitante} onChange={e => set("setorSolicitante", e.target.value)} placeholder="GERIATRIA" /></Field>
        </Row>
      </SectionCard>
      <SectionCard title="Informações clínicas" icon="ti-clipboard-heart">
        <Field label="Exames já realizados"><textarea rows={3} value={ee.examesRealizados} onChange={e => set("examesRealizados", e.target.value)} /></Field>
        <Field label="Dados clínicos"><textarea rows={3} value={ee.dadosClinicos} onChange={e => set("dadosClinicos", e.target.value)} /></Field>
        <Field label="Hipótese diagnóstica"><textarea rows={2} value={ee.hipoteseDiagnostica} onChange={e => set("hipoteseDiagnostica", e.target.value)} /></Field>
        <Field label="Exame solicitado"><textarea rows={2} value={ee.exameSolicitado} onChange={e => set("exameSolicitado", e.target.value)} placeholder="ex: TC de crânio sem contraste" /></Field>
      </SectionCard>
      <SectionCard title="Caráter da solicitação" icon="ti-alert-circle">
        <RadioGroup name="carater" value={ee.carater} onChange={v => set("carater", v)} options={[
          { value: "urgencia_absoluta", label: "Urgência absoluta" },
          { value: "urgencia_relativa", label: "Urgência relativa" },
          { value: "rotina", label: "Rotina" },
          { value: "controle", label: "Controle" },
        ]} />
      </SectionCard>
      <SectionCard title="Observações" icon="ti-notes" defaultOpen={false}>
        <textarea rows={2} value={ee.observacoes} onChange={e => set("observacoes", e.target.value)} />
      </SectionCard>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
        <button onClick={() => onPrint({ type: "exameEspecial" })} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <i className="ti ti-printer" aria-hidden="true"></i>Gerar solicitação de exame especial
        </button>
      </div>
    </div>
  );
}

function VacinacaoDocTab({ patient, consulta, updateConsulta, onPrint }) {
  const vd = (consulta.docs && consulta.docs.vacinacao) || { selecionados: {} };
  const toggle = (nome) => updateConsulta(p => ({ ...p, docs: { ...p.docs, vacinacao: { ...p.docs.vacinacao, selecionados: { ...p.docs.vacinacao.selecionados, [nome]: !p.docs.vacinacao.selecionados[nome] } } } }));
  const countSel = Object.values(vd.selecionados || {}).filter(Boolean).length;

  const VACINAS_DOC = ["Influenza", "COVID-19", "Pneumocócica", "dT/dTpa", "Hepatite B", "Vírus sincicial respiratório (VSR)", "Herpes-zóster (VZR recombinante)"];

  return (
    <div>
      <Alert type="info">Marque as vacinas a incluir na solicitação de atualização vacinal. O documento gerado segue o calendário de vacinação do idoso, com o esquema completo de cada vacina já descrito — só o nome do paciente precisa ser preenchido.</Alert>
      <SectionCard title="Vacinas a solicitar" icon="ti-vaccine">
        {VACINAS_DOC.map(v => (
          <label key={v} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 0", borderBottom: "0.5px solid var(--color-border-tertiary)", cursor: "pointer" }}>
            <input type="checkbox" checked={!!vd.selecionados[v]} onChange={() => toggle(v)} />
            <span style={{ fontSize: "14px" }}>{v}</span>
          </label>
        ))}
      </SectionCard>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
        <button onClick={() => onPrint({ type: "vacinacao" })} disabled={countSel === 0} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <i className="ti ti-printer" aria-hidden="true"></i>Gerar solicitação ({countSel})
        </button>
      </div>
    </div>
  );
}

function PrintDocRenderer({ doc, patient, consulta, onClose }) {
  if (doc.type === "receita") return <ReceitaPrint patient={patient} consulta={consulta} onClose={onClose} />;
  if (doc.type === "receitaEspecial") return <ReceitaEspecialPrint patient={patient} consulta={consulta} onClose={onClose} />;
  if (doc.type === "exameSimples") return <ExameSimplesPrint patient={patient} consulta={consulta} onClose={onClose} />;
  if (doc.type === "exameEspecial") return <ExameEspecialPrint patient={patient} consulta={consulta} onClose={onClose} />;
  if (doc.type === "vacinacao") return <VacinacaoPrint patient={patient} consulta={consulta} onClose={onClose} />;
  return null;
}

function ReceitaPrint({ patient, consulta, onClose }) {
  const sel = (consulta.docs && consulta.docs.receitaSelecionados) || {};
  const edits = (consulta.docs && consulta.docs.receitaItensEditados) || {};
  const extras = (consulta.docs && consulta.docs.receitaExtras) || "";

  const blocosComItens = RECEITA_BLOCOS.map(bloco => ({
    ...bloco,
    itensSelecionados: bloco.itens
      .filter(item => sel[bloco.categoria + "::" + item.nome])
      .map(item => {
        const edit = edits[bloco.categoria + "::" + item.nome] || {};
        return {
          nome: edit.nome !== undefined ? edit.nome : item.nome,
          qtd: edit.qtd !== undefined ? edit.qtd : item.qtd,
          posologia: edit.posologia !== undefined ? edit.posologia : item.posologia,
        };
      })
  })).filter(b => b.itensSelecionados.length > 0);

  const extrasLinhas = extras.split("\n").map(l => l.trim()).filter(Boolean);

  let counter = 0;

  return (
    <PrintShell title="Receituário" onClose={onClose}>
      <DocHeader title="RECEITUÁRIO" />
      <div style={{ marginBottom: "14px" }}><strong>Paciente:</strong> {patient.ident.nome || ""}</div>
      <div style={{ textAlign: "center", marginBottom: "14px" }}>USO ORAL</div>
      {blocosComItens.length === 0 && extrasLinhas.length === 0 && <p style={{ textAlign: "center", color: "#888" }}>Nenhum item selecionado.</p>}
      {blocosComItens.map(bloco => (
        <div key={bloco.categoria} style={{ marginBottom: "12px" }}>
          <div style={{ fontWeight: 700, marginBottom: "6px" }}>{bloco.categoria}:</div>
          {bloco.itensSelecionados.map((item, idx) => {
            counter++;
            return (
              <div key={bloco.categoria + idx} style={{ marginBottom: "8px", paddingLeft: "18px" }}>
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

function ReceitaEspecialPrint({ patient, consulta, onClose }) {
  const re = (consulta.docs && consulta.docs.receitaEspecial) || {};
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

function ExameSimplesPrint({ patient, consulta, onClose }) {
  const es = (consulta.docs && consulta.docs.examesSimples) || { texto: "" };
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

function ExameEspecialPrint({ patient, consulta, onClose }) {
  const ee = (consulta.docs && consulta.docs.examesEspecial) || {};
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
  const sel = vd.selecionados || {};
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
