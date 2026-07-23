// ============================================================
// SERVICE WORKER — Prontuário de Geriatria CEMPRE/HSE-PE
// ============================================================
// Permite VISUALIZAR (não editar) prontuários já abertos mesmo sem
// conexão com a internet, armazenando em cache a última versão do
// app carregada e as respostas de dados já vistas.
//
// IMPORTANTE: este SW é propositalmente conservador — só serve
// conteúdo do cache quando a rede falha (network-first), nunca
// mostra dados desatualizados quando há conexão disponível.
// Edições continuam exigindo conexão (a fila de sincronização no
// próprio App.jsx cuida de reenviar alterações feitas offline).

const CACHE_NAME = 'prontuario-cempre-v1';
const CACHE_ESSENCIAL = [
  '/',
  '/index.html',
];

// Instala o SW e faz cache do essencial para o app abrir offline
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CACHE_ESSENCIAL).catch(() => {
        // Se algum recurso essencial falhar, não impede a instalação —
        // apenas aquele item não ficará disponível offline.
      });
    })
  );
  self.skipWaiting();
});

// Remove caches de versões antigas ao ativar uma nova versão do SW
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(
        nomes
          .filter((nome) => nome !== CACHE_NAME)
          .map((nome) => caches.delete(nome))
      )
    )
  );
  self.clients.claim();
});

// Estratégia: network-first com fallback para cache.
// - Tenta sempre buscar da rede primeiro (garante dados atualizados)
// - Se a rede falhar (offline), serve do cache se disponível
// - Requisições de escrita (POST/PUT/DELETE) NUNCA usam cache —
//   forçamos que apareçam como falha para acionar a fila de sincronização
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Nunca interceptar requisições de escrita — devem falhar de verdade
  // se offline, para o app.jsx colocar na fila de sincronização.
  if (request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Guarda uma cópia no cache para uso offline futuro (só respostas OK)
        if (response && response.status === 200) {
          const copia = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copia));
        }
        return response;
      })
      .catch(() => {
        // Sem rede — tenta servir do cache
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          // Sem cache disponível também — deixa o erro propagar normalmente
          throw new Error('Sem conexão e sem cache disponível para este recurso.');
        });
      })
  );
});
