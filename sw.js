// ============================================
// Service Worker - Dirija com Meta PWA
// Cache total: app funciona offline após primeira visita
// ============================================

const CACHE_NAME = 'dirija-com-meta-v1';
const STATIC_CACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Domínios externos a cachear (CDNs do app)
const EXTERNAL_CACHE_PATTERNS = [
  /fonts\.googleapis\.com/,
  /fonts\.gstatic\.com/,
  /cdnjs\.cloudflare\.com/,
  /cdn\.jsdelivr\.net/,
  /unpkg\.com/,
  /ka-f\.fontawesome\.com/,
  /kit\.fontawesome\.com/
];

// INSTALL: cacheia arquivos essenciais
self.addEventListener('install', function(event) {
  console.log('[SW] Instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('[SW] Cache aberto:', CACHE_NAME);
      // addAll falha se UM arquivo não carregar; usa add individual
      return Promise.all(
        STATIC_CACHE_URLS.map(function(url) {
          return cache.add(url).catch(function(err) {
            console.warn('[SW] Falhou cachear:', url, err);
          });
        })
      );
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// ACTIVATE: limpa caches antigos
self.addEventListener('activate', function(event) {
  console.log('[SW] Ativando...');
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.map(function(name) {
          if (name !== CACHE_NAME) {
            console.log('[SW] Removendo cache antigo:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// FETCH: estratégia network-first para HTML, cache-first para assets
self.addEventListener('fetch', function(event) {
  const req = event.request;

  // Ignora POST/PUT/DELETE (não cacheia)
  if (req.method !== 'GET') return;

  // Ignora chrome-extension://
  if (!req.url.startsWith('http')) return;

  const url = new URL(req.url);

  // ============================================
  // HTML/Navegação: NETWORK FIRST (sempre tenta rede pra pegar atualizações)
  // ============================================
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req)
        .then(function(resp) {
          // Cacheia a versão nova
          const cloneResp = resp.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(req, cloneResp);
          });
          return resp;
        })
        .catch(function() {
          // Offline → serve do cache
          return caches.match(req).then(function(cached) {
            return cached || caches.match('./index.html') || caches.match('./');
          });
        })
    );
    return;
  }

  // ============================================
  // Assets externos (fonts/cdn): CACHE FIRST
  // ============================================
  const isExternal = EXTERNAL_CACHE_PATTERNS.some(function(rx) {
    return rx.test(url.href);
  });

  if (isExternal) {
    event.respondWith(
      caches.match(req).then(function(cached) {
        if (cached) return cached;
        return fetch(req).then(function(resp) {
          if (resp && resp.status === 200) {
            const cloneResp = resp.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(req, cloneResp);
            });
          }
          return resp;
        }).catch(function() {
          // Sem rede e sem cache → falha silenciosa
          return new Response('', { status: 408, statusText: 'Offline' });
        });
      })
    );
    return;
  }

  // ============================================
  // Mesmo domínio (assets locais): CACHE FIRST
  // ============================================
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(function(cached) {
        if (cached) {
          // Atualiza no background (stale-while-revalidate)
          fetch(req).then(function(resp) {
            if (resp && resp.status === 200) {
              caches.open(CACHE_NAME).then(function(cache) {
                cache.put(req, resp);
              });
            }
          }).catch(function() {});
          return cached;
        }
        // Não está cacheado, busca da rede
        return fetch(req).then(function(resp) {
          if (resp && resp.status === 200) {
            const cloneResp = resp.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(req, cloneResp);
            });
          }
          return resp;
        }).catch(function() {
          return new Response('', { status: 408, statusText: 'Offline' });
        });
      })
    );
    return;
  }

  // Default: passa direto
});

// Mensagens (skipWaiting via UI)
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
