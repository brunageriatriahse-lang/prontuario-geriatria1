import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { listPatients, savePatient, deletePatient as apiDeletePatient } from './api.js';
import { LOGO_HSE_BASE64, LOGO_GERIATRIA_BASE64 } from './logos.js';
import { preencherExcel } from './excelPreencher.js';

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
  "amitriptilina","clorpromazina","prometazina","hidroxizina","diazepam","clonazepam","alprazolam","lorazepam","midazolam",
  "zolpidem","amiodarona","digoxina","nifedipina","doxazosina","glibenclamida","clorpropamida",
  "indometacina","cetorolaco","ibuprofeno","diclofenaco","meperidina","tramadol","oxibutinina","metoclopramida",
  "olanzapina","quetiapina","risperidona","haloperidol","fluoxetina","escitalopram","espironolactona",
  "ácido acetilsalicílico","aas","mineral oil","óleo mineral"
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
    // Campos que devem começar em branco em cada nova consulta
    copy.queixas = "";
    copy.labsTexto = "";
    copy.imagemTexto = "";
    copy.pendenciasConsultaAtual = "";
    copy.plano = { ajuste: "", solicito: "", orientacoes: "", encaminhamentos: "", retorno: "" };
    copy.docs = {
      receitas: [],
      receitasEspeciais: [],
      examesSimplesLista: [],
      examesEspeciais: [],
      vacinacao: (base.docs && base.docs.vacinacao) ? base.docs.vacinacao : { selecionados: { "Influenza": true, "COVID-19": true, "Pneumocócica": true, "dT/dTpa": true, "Hepatite B": true, "Vírus sincicial respiratório (VSR)": true, "Herpes-zóster (VZR recombinante)": true } },
    };
    // Reseta exame físico para padrão (só mantém estrutura, não os valores preenchidos)
    copy.exameFisico = {
      paSentado: "", paEmPe: "", fc: "", fr: "", sato2: "", temp: "", peso: "", hgt: "",
      geral: base.exameFisico?.geral || "",
      acv: base.exameFisico?.acv || "",
      ar: base.exameFisico?.ar || "",
      abd: base.exameFisico?.abd || "",
      ext: base.exameFisico?.ext || "",
      sn: base.exameFisico?.sn || "",
      pele: base.exameFisico?.pele || "",
      outros: "",
    };
    // Pendências: mantém as não concluídas, marca como pendentes para nova consulta
    copy.pendencias = (base.pendencias || []).filter(p => !p.done).map(p => ({ ...p, done: false }));
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
      quedas: "nao", quedasNum: "", quedasDescricao: "", fraturas: "nao", tce: "nao",
      frail: {}, semQueixasCognitivas: false, queixasCognitivasDescricao: "", minicog: "", meem: "", moca: "",
      semQueixasHumor: false, queixasHumorDescricao: "", gds15: "",
      semQueixasSono: false, roncos: "", sonolenciaDiurna: "", higieneSono: "",
      visao: "preservada", visaoLentes: "nao", audicao: "preservada", audicaoAparelho: "nao",
      incontinenciaUrinaria: "nao", incontinenciaFecal: "nao", constipacao: "nao",
      peso: "", pesoHabitual: "", altura: "", perdaPeso: "nao", perdaPesoKg: "",
      apetite: "preservado", disfagia: "ausente", disfagiaDieta: "",
      problemasDentarios: "nao", proteseDentaria: "nao",
      testeForca: "", circPanturrilha: "",
      atividadeFisica: "",
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

function PrintShell({ title, children, onClose }) {
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
              <button onClick={() => window.print()} style={{ fontSize: "13px", padding: "5px 12px", border: "1px solid #ccc", borderRadius: "6px", background: "#f5f5f5", cursor: "pointer" }}>
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
    if (!autenticado) return; // não carrega dados antes do login
    (async () => {
      try {
        const list = await listPatients();
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
              savePatient(atualizado).catch(e => console.error("Falha ao expurgar consultas antigas", e));
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
            savePatient(atualizado).catch(e => console.error("Falha ao migrar rastreio para array", e));
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
            savePatient(atualizado).catch(e => console.error("Falha ao migrar receitas para array", e));
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
            savePatient(atualizado).catch(e => console.error("Falha ao migrar documentos únicos para lista", e));
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
            savePatient(atualizado).catch(e => console.error("Falha ao sanear datas de vacina", e));
            return atualizado;
          }
          return p;
        });

        setPatients(sanitizados);
        if (anyMigrated) {
          sanitizados.forEach(p => { savePatient(p).catch(e => console.error("Falha ao persistir migração", e)); });
        }
        expurgados.forEach(({ id }) => { apiDeletePatient(id).catch(e => console.error("Falha ao expurgar paciente antigo", e)); });
      } catch (e) {
        console.error(e);
        setLoadError(e.message);
        setPatients([]);
      }
    })();
  }, [autenticado]);

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

  if (!autenticado) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-background-secondary)' }}>
        <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: '16px', padding: '40px 36px', width: '100%', maxWidth: '360px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={{ fontWeight: 700, fontSize: '17px', marginBottom: '4px' }}>Prontuário de Geriatria</div>
            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>CEMPRE — HSE-PE</div>
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
    const now = new Date().toISOString();
    setPatients(prev => prev.map(p => p.id === id ? { ...p, deletedAt: now, updatedAt: now } : p));
    if (activeId === id) { setActiveId(null); setView("list"); }
    const target = (patients || []).find(p => p.id === id);
    if (target) {
      try { await savePatient({ ...target, deletedAt: now, updatedAt: now }); } catch (e) { console.error(e); }
    }
  }

  async function restorePatient(id) {
    const now = new Date().toISOString();
    setPatients(prev => prev.map(p => p.id === id ? { ...p, deletedAt: null, updatedAt: now } : p));
    const target = (patients || []).find(p => p.id === id);
    if (target) {
      try { await savePatient({ ...target, deletedAt: null, updatedAt: now }); } catch (e) { console.error(e); }
    }
  }

  async function permanentlyDeletePatient(id) {
    setPatients(prev => prev.filter(p => p.id !== id));
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
    setView("record");
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
      savePatient(updated).catch(e => console.error(e));
    }
  }

  function permanentlyDeleteConsulta(patientId, consultaId) {
    setPatients(prev => prev.map(p => p.id === patientId ? { ...p, consultas: p.consultas.filter(c => c.id !== consultaId) } : p));
    const target = (patients || []).find(p => p.id === patientId);
    if (target) {
      const updated = { ...target, consultas: target.consultas.filter(c => c.id !== consultaId) };
      savePatient(updated).catch(e => console.error(e));
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
          <h1 style={{ margin: 0 }}>Prontuário de geriatria — CEMPRE</h1>
          <p style={{ margin: "2px 0 0", fontSize: "13px", color: "var(--color-text-secondary)" }}>HSE-PE · dados salvos no Google Sheets</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {saveStatus === "saving" && <Pill color="info"><i className="ti ti-loader-2" aria-hidden="true"></i>Salvando</Pill>}
          {saveStatus === "saved" && <Pill color="success"><i className="ti ti-check" aria-hidden="true"></i>Salvo</Pill>}
          {saveStatus === "error" && <Pill color="danger"><i className="ti ti-alert-triangle" aria-hidden="true"></i>Erro ao salvar</Pill>}
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
      {activeTab === "aga" && <AgaTab consulta={consulta} updateConsulta={updateConsulta} />}
      {activeTab === "prevencao" && <PrevencaoTab patient={patient} consulta={consulta} updateConsulta={updateConsulta} />}
      {activeTab === "exame" && <ExameTab consulta={consulta} updateConsulta={updateConsulta} patient={patient} />}
      {activeTab === "exames" && <ExamesTab consulta={consulta} updateConsulta={updateConsulta} />}
      {activeTab === "plano" && <PlanoTab consulta={consulta} updateConsulta={updateConsulta} />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "20px", paddingTop: "16px", borderTop: "0.5px solid var(--color-border-tertiary)" }}>
        <button onClick={onSave} style={{ display: "flex", alignItems: "center", gap: "6px", background: "var(--color-background-success)", color: "var(--color-text-success)", border: "0.5px solid var(--color-border-success)" }}>
          <i className="ti ti-device-floppy" aria-hidden="true"></i>Salvar agora
        </button>
        <button onClick={() => onPrint({ type: "consultaCompleta" })} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <i className="ti ti-printer" aria-hidden="true"></i>Imprimir consulta completa
        </button>
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
        <Field label="Pode contar com"><input value={i.podeContarCom} onChange={e => set("podeContarCom", e.target.value)} placeholder="ex: filha, vizinha, cuidador contratado..." /></Field>
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

  return (
    <div>
      <SectionCard title="Medicações em uso" icon="ti-pill">
        {beersAlerts.length > 0 && (
          <Alert type="warning">
            {beersAlerts.length} linha(s) mencionam fármacos que constam nos Critérios de Beers 2023 e podem ser potencialmente inapropriados para idosos, dependendo de dose, indicação e contexto clínico: {beersAlerts.join(" / ")}. Avalie risco/benefício individualmente.
          </Alert>
        )}
        <textarea
          rows={10}
          value={texto}
          onChange={e => updateConsulta(p => ({ ...p, medicacoesTexto: e.target.value }))}
          placeholder={"Liste as medicações em uso, uma por linha. Ex:\nLosartana 50mg - 1cp pela manhã e à noite\nAAS 100mg - 1cp após almoço"}
        />
      </SectionCard>
      <SectionCard title="Medicações de uso prévio / descontinuadas" icon="ti-history" defaultOpen={true}>
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

function AgaTab({ consulta, updateConsulta }) {
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
  const imcLabel = imc ? (imc < 22 ? "Baixo peso (idoso)" : imc < 27 ? "Eutrófico" : imc < 30 ? "Sobrepeso" : "Obesidade") : null;

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
        </Field>
        <Field label={`ABVD (Katz) — independente em ${abvdCount}/6`}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "4px" }}>
            {ABVD_ITEMS.map(item => (
              <label key={item} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
                <input type="checkbox" checked={!!(aga.abvd && aga.abvd[item])} onChange={() => toggleAbvd(item)} />{item}
              </label>
            ))}
          </div>
        </Field>
      </SectionCard>

      <SectionCard title="Mobilidade" icon="ti-wheelchair">
        <Field label="Marcha"><RadioGroup name="marcha" value={aga.marcha} onChange={v => set("marcha", v)} options={[{value:"preservada",label:"Preservada"},{value:"lentificada",label:"Lentificada"},{value:"auxilio",label:"Com auxílio"}]} /></Field>
        <Field label="Dispositivo"><RadioGroup name="disp" value={aga.dispositivo} onChange={v => set("dispositivo", v)} options={[{value:"nenhum",label:"Nenhum"},{value:"bengala",label:"Bengala"},{value:"andador",label:"Andador"},{value:"cadeira",label:"Cadeira de rodas"}]} /></Field>
        <Field label="Queda no último ano">
          <RadioGroup name="quedas" value={aga.quedas} onChange={v => set("quedas", v)} options={[{value:"nao",label:"Não"},{value:"sim",label:"Sim"}]} />
        </Field>
        {aga.quedas === "sim" && (
          <Field label="Número de quedas"><input value={aga.quedasNum || ""} onChange={e => set("quedasNum", e.target.value)} style={{ maxWidth: "100px" }} /></Field>
        )}
        <Row>
          <div>
            <Field label="Fraturas associadas">
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
        {aga.quedas === "sim" && (
          <Field label="Descrição da queda (circunstância, local, mecanismo, consequências)">
            <textarea rows={2} value={aga.quedasDescricao || ""} onChange={e => set("quedasDescricao", e.target.value)} />
          </Field>
        )}
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
            <Row cols="repeat(3, 1fr)">
              <Field label="Mini-Cog"><input value={aga.minicog || ""} onChange={e => set("minicog", e.target.value)} /></Field>
              <Field label="MEEM"><input value={aga.meem || ""} onChange={e => set("meem", e.target.value)} /></Field>
              <Field label="MoCA"><input value={aga.moca || ""} onChange={e => set("moca", e.target.value)} /></Field>
            </Row>
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
            <Field label="GDS-15 (pontuação)" hint="Pontuação ≥6 sugere rastreio positivo para sintomas depressivos">
              <input type="number" min="0" max="15" value={aga.gds15 || ""} onChange={e => set("gds15", e.target.value)} style={{ maxWidth: "100px" }} />
            </Field>
            {gdsPositive && <Alert type="warning">GDS-15 = {gdsNum}: rastreio positivo para sintomas depressivos. Considerar avaliação complementar.</Alert>}
          </>
        )}
      </SectionCard>

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

      <SectionCard title="Nutrição" icon="ti-apple">
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
          <Field label="Teste de força (kgf)" hint="Homens: >27 kgf / Mulheres: >19 kgf"><input value={aga.testeForca || ""} onChange={e => set("testeForca", e.target.value)} /></Field>
          <Field label="Circunferência da panturrilha (cm)" hint="Homens: >34 cm / Mulheres: >33 cm"><input value={aga.circPanturrilha || ""} onChange={e => set("circPanturrilha", e.target.value)} /></Field>
          <Field label="Atividade física"><input value={aga.atividadeFisica || ""} onChange={e => set("atividadeFisica", e.target.value)} placeholder="ex: caminhada 3x/semana..." /></Field>
        </Row>
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

function ExameTab({ consulta, updateConsulta, patient }) {
  const e = consulta.exameFisico || {};
  const set = (k, v) => updateConsulta(p => ({ ...p, exameFisico: { ...p.exameFisico, [k]: v } }));
  const sexo = patient?.ident?.sexo;
  const F = sexo === "F";

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
      </SectionCard>
      <SectionCard title="Exame físico segmentar" icon="ti-stethoscope">
        <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: 0 }}>
          Achados padrão pré-preenchidos conforme sexo {sexo ? `(${F ? "Feminino" : "Masculino"})` : "— informe o sexo na aba Identificação para texto personalizado"} — edite conforme o exame real.
        </p>
        {campos.map(([k, label, padrao]) => (
          <Field key={k} label={label}>
            <textarea rows={2} value={e[k] !== undefined ? e[k] : padrao} onChange={ev => set(k, ev.target.value)} placeholder={k === "outros" ? "Outros achados relevantes..." : undefined} />
          </Field>
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
  const pl = consulta.plano || {};
  const set = (k, v) => updateConsulta(p => ({ ...p, plano: { ...p.plano, [k]: v } }));

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

  return (
    <div>
      <SectionCard title="Plano terapêutico" icon="ti-target-arrow">
        <Field label="1. Ajuste medicamentoso"><textarea rows={4} value={pl.ajuste || ""} onChange={e => set("ajuste", e.target.value)} placeholder="Descreva os ajustes de medicações..." /></Field>
        <Field label="2. Solicito"><textarea rows={3} value={pl.solicito || ""} onChange={e => set("solicito", e.target.value)} placeholder="ex: LABORATÓRIO — Hemograma, PCR, Ureia e Creatinina..." /></Field>
        <Field label="3. Orientações"><textarea rows={3} value={pl.orientacoes || ""} onChange={e => set("orientacoes", e.target.value)} placeholder="ex: Atualização vacinal, importância de MEV, higiene do sono..." /></Field>
        <Field label="4. Encaminho para"><textarea rows={3} value={pl.encaminhamentos || ""} onChange={e => set("encaminhamentos", e.target.value)} placeholder="ex: Fisioterapia motora, Nutrição, Psicologia, Oftalmologia, ORL..." /></Field>
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


function PrintDocRenderer({ doc, patient, consulta, onClose }) {
  if (doc.type === "consultaCompleta") return <ConsultaCompletaPrint patient={patient} consulta={consulta} onClose={onClose} />;
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

  return (
    <PrintShell title="Consulta completa" onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
        <img src={`data:image/png;base64,${LOGO_HSE_BASE64}`} alt="HSE" style={{ height: "48px", objectFit: "contain" }} />
        <div style={{ textAlign: "center", flex: 1, fontWeight: 700, fontSize: "14px", letterSpacing: "0.3px" }}>AMBULATÓRIO DE GERIATRIA - CEMPRE</div>
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
    </PrintShell>
  );
}
