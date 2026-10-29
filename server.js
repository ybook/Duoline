const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 3000);
const MYMEMORY_EMAIL = (process.env.MYMEMORY_EMAIL || "").trim();
const PUBLIC_DIR = path.join(__dirname, "public");
const API_URL = "https://api.mymemory.translated.net/get";
const MAX_INPUT_CHARS = 30000;
const MAX_SEGMENT_BYTES = 450; // Keep margin under the API documented 500-byte limit.
const MAX_CONCURRENT_REQUESTS = 4; // Parallel calls reduce waiting without flooding the public service.
const TRANSLATION_CACHE_MAX = 500;
const translationCache = new Map();
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png" };
const LANGUAGE_TAGS = {
  en: "en-US",
  pt: "pt-BR",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  it: "it-IT",
  ja: "ja-JP",
  ko: "ko-KR"
};

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  if (req.method === "POST" && req.url === "/api/translate") {
    try {
      const body = await readBody(req);
      const { text, source, target } = body;
      if (typeof text !== "string" || !text.trim()) return sendJson(res, 400, { error: "Cole um texto para traduzir." });
      if (text.length > MAX_INPUT_CHARS) return sendJson(res, 413, { error: "O texto excede o limite de 30.000 caracteres." });
      if (!Object.hasOwn(LANGUAGE_TAGS, source)) return sendJson(res, 400, { error: "Escolha o idioma original do texto." });
      if (!Object.hasOwn(LANGUAGE_TAGS, target)) return sendJson(res, 400, { error: "Escolha um idioma de destino válido." });
      if (source === target) return sendJson(res, 400, { error: "Escolha idiomas diferentes." });

      // MyMemory accepts one segment (up to 500 bytes) per request. Prepare the
      // segments first, then translate distinct segments with a small worker pool.
      // This avoids one-by-one network waits and reuses repeated lines/phrases.
      const lines = text.split("\n");
      const segmentLists = lines.map(line => line.trim() ? splitIntoSegments(line, MAX_SEGMENT_BYTES) : []);
      const sourceTag = LANGUAGE_TAGS[source];
      const targetTag = LANGUAGE_TAGS[target];
      const translatedByKey = new Map();
      const tasksByKey = new Map();
      let processedChars = 0;

      for (const segments of segmentLists) {
        for (const segment of segments) {
          const key = cacheKey(segment, sourceTag, targetTag);
          if (translationCache.has(key)) {
            const cached = translationCache.get(key);
            // Refresh insertion order so frequently reused items remain in cache.
            translationCache.delete(key);
            translationCache.set(key, cached);
            translatedByKey.set(key, cached);
          } else if (!tasksByKey.has(key)) {
            tasksByKey.set(key, { key, segment });
          }
          processedChars += segment.length;
        }
      }

      const tasks = [...tasksByKey.values()];
      let nextTask = 0;
      async function worker() {
        while (true) {
          const index = nextTask++;
          if (index >= tasks.length) return;
          const task = tasks[index];
          const translated = await translateSegment(task.segment, sourceTag, targetTag);
          translatedByKey.set(task.key, translated);
          cacheTranslation(task.key, translated);
        }
      }
      const workerCount = Math.min(MAX_CONCURRENT_REQUESTS, tasks.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      const translatedLines = segmentLists.map(segments => segments
        .map(segment => translatedByKey.get(cacheKey(segment, sourceTag, targetTag)))
        .join(" "));

      return sendJson(res, 200, {
        translatedText: translatedLines.join("\n"),
        provider: "MyMemory",
        charsProcessed: processedChars,
        requestsMade: tasks.length,
        cacheHits: segmentLists.reduce((total, segments) => total + segments.filter(segment => translationCache.has(cacheKey(segment, sourceTag, targetTag)) && !tasksByKey.has(cacheKey(segment, sourceTag, targetTag))).length, 0),
        freeTierNote: MYMEMORY_EMAIL ? "A solicitação incluiu o e-mail de contato configurado no servidor." : "Uso anônimo gratuito: a cota publicada é de 5.000 caracteres por dia."
      });
    } catch (error) {
      const status = error.statusCode || 502;
      return sendJson(res, status, { error: error.message || "Não foi possível concluir a tradução." });
    }
  }

  if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Método não permitido." });
  const pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  let relative;
  try { relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, ""); }
  catch { return sendJson(res, 400, { error: "Caminho inválido." }); }
  const filePath = path.resolve(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, "index.html")) return sendJson(res, 403, { error: "Acesso negado." });
  fs.readFile(filePath, (error, content) => {
    if (error) return sendJson(res, 404, { error: "Arquivo não encontrado." });
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : content);
  });
});


function cacheKey(segment, source, target) {
  return `${source}\u0000${target}\u0000${segment}`;
}

function cacheTranslation(key, translated) {
  if (translationCache.has(key)) translationCache.delete(key);
  translationCache.set(key, translated);
  while (translationCache.size > TRANSLATION_CACHE_MAX) {
    translationCache.delete(translationCache.keys().next().value);
  }
}

async function translateSegment(segment, source, target) {
  if (Buffer.byteLength(segment, "utf8") > 500) {
    throw new Error("Um trecho do texto excedeu o limite da API. Tente dividir a linha em partes menores.");
  }
  const url = new URL(API_URL);
  url.searchParams.set("q", segment);
  url.searchParams.set("langpair", `${source}|${target}`);
  url.searchParams.set("mt", "1");
  if (MYMEMORY_EMAIL) url.searchParams.set("de", MYMEMORY_EMAIL);

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "Accept": "application/json" } });
  } catch {
    throw new Error("Não foi possível conectar ao MyMemory. Verifique sua conexão e tente novamente.");
  }

  let data;
  try { data = await response.json(); }
  catch { throw new Error("O MyMemory retornou uma resposta inválida."); }

  if (!response.ok) {
    if (response.status === 429) throw new Error("O MyMemory limitou as solicitações temporariamente. Aguarde e tente novamente.");
    throw new Error(data?.responseDetails || `O MyMemory respondeu com erro HTTP ${response.status}.`);
  }
  if (data?.quotaFinished) throw new Error("A cota gratuita diária do MyMemory foi atingida. Tente novamente amanhã.");
  if (data?.responseStatus && data.responseStatus !== 200) {
    const detail = data.responseDetails || "O serviço não concluiu a tradução.";
    throw new Error(detail);
  }
  const translated = data?.responseData?.translatedText;
  if (typeof translated !== "string" || !translated.trim()) {
    throw new Error("O MyMemory não encontrou uma tradução para um dos trechos. Tente outra combinação de idiomas.");
  }
  return decodeBasicEntities(translated);
}

function splitIntoSegments(line, maxBytes) {
  if (Buffer.byteLength(line, "utf8") <= maxBytes) return [line];
  const words = line.match(/\S+\s*/gu) || [line];
  const segments = [];
  let current = "";
  for (const word of words) {
    if (Buffer.byteLength(word, "utf8") > maxBytes) {
      if (current.trim()) segments.push(current.trimEnd());
      current = "";
      let fragment = "";
      for (const char of word) {
        if (Buffer.byteLength(fragment + char, "utf8") > maxBytes) {
          segments.push(fragment);
          fragment = char;
        } else fragment += char;
      }
      current = fragment;
      continue;
    }
    if (Buffer.byteLength(current + word, "utf8") > maxBytes) {
      if (current.trim()) segments.push(current.trimEnd());
      current = word.trimStart();
    } else current += word;
  }
  if (current.trim()) segments.push(current.trimEnd());
  return segments;
}

function decodeBasicEntities(value) {
  // MyMemory occasionally returns HTML entities; decode common entities without interpreting HTML.
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 100000) { reject(new Error("Solicitação muito grande.")); req.destroy(); }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch { reject(new Error("JSON inválido.")); }
    });
    req.on("error", reject);
  });
}
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}
server.listen(PORT, () => {
  console.log(`Duoline disponível em http://localhost:${PORT}`);
  console.log("Tradução: MyMemory API (sem chave de API).");
  console.log(MYMEMORY_EMAIL ? "E-mail de contato configurado; a cota publicada é de até 50.000 caracteres/dia." : "Modo anônimo: cota gratuita publicada de 5.000 caracteres/dia.");
});
