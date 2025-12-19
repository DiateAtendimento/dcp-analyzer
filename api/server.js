import express from "express";
import cors from "cors";
import multer from "multer";
import pdfParse from "pdf-parse";

const app = express();

// Para capturar IP real atrás do proxy (Render)
app.set("trust proxy", 1);

// Ajuste depois para o domínio Netlify
app.use(
  cors({
    origin: ["https://cdp-analizador.netlify.app"],
  })
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 10,
    fileSize: 20 * 1024 * 1024, // 20 MB
  },
});

// -------------------- Funções auxiliares --------------------
function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function extractAgreementNumber(text) {
  const t = normalizeText(text);

  const m1 = t.match(/\b(n[úu]mero\s+do\s+acordo)\s*:\s*(\d{3,6}\/\d{4})\b/i);
  if (m1?.[2]) return m1[2];

  const m2 = t.match(
    /\b(n[ºo]\.?\s*do\s*acordo|n[ºo]\.?\s*acordo)\s*[:\-]?\s*(\d{3,6}\/\d{4})\b/i
  );
  if (m2?.[2]) return m2[2];

  const any = t.match(/\b\d{3,6}\/\d{4}\b/);
  return any?.[0] || null;
}

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
  return req.ip || "unknown";
}

function isDatePrefix(str, matchIndex) {
  // Verifica se imediatamente antes do mm/aaaa há algo como "dd/"
  // Ex.: "...30/12/2020" -> antes de "12/2020" tem "30/"
  const before = str.slice(Math.max(0, matchIndex - 3), matchIndex);
  return /\d{1,2}\//.test(before);
}

/**
 * Extrai competências reais (mm/aaaa) e gera diagnóstico:
 * - ignora mm/aaaa que vier de datas completas (dd/mm/aaaa)
 * - prioriza a seção "3. LANÇAMENTOS DA RUBRICA" (quando existir)
 */
function extractCompetenciesWithDebug(text) {
  if (!text) {
    return {
      competencies: [],
      debug: {
        sectionFound: false,
        ignoredFromDates: [],
        foundOutsideSection: [],
      },
    };
  }

  const rx = /\b(0[1-9]|1[0-3])\/(19\d{2}|20\d{2})\b/g;

  // 1) capturar tudo que parece mm/aaaa no texto inteiro (para diagnóstico)
  const allMatches = [];
  let mAll;
  while ((mAll = rx.exec(text)) !== null) {
    allMatches.push({ value: `${mAll[1]}/${mAll[2]}`, index: mAll.index });
  }

  const ignoredFromDates = [];
  for (const mmYyyy of allMatches) {
    if (isDatePrefix(text, mmYyyy.index)) ignoredFromDates.push(mmYyyy.value);
  }

  // 2) recortar apenas a parte de “3. LANÇAMENTOS DA RUBRICA” até “TOTAL”
  const lower = text.toLowerCase();
  let section = text;
  const start = lower.indexOf("3. lançamentos da rubrica");
  const end = lower.indexOf("total");

  const sectionFound = start !== -1;
  if (sectionFound) {
    section = end !== -1 ? text.slice(start, end) : text.slice(start);
  }

  // 3) extrair competências da seção (ignorando datas dd/mm/aaaa)
  const found = new Set();
  const rx2 = /\b(0[1-9]|1[0-3])\/(19\d{2}|20\d{2})\b/g;

  let m;
  while ((m = rx2.exec(section)) !== null) {
    const idx = m.index;
    const value = `${m[1]}/${m[2]}`;

    // Se for precedido por dd/ dentro da seção, ignora
    if (isDatePrefix(section, idx)) continue;

    found.add(value);
  }

  const competencies = [...found].sort();

  // 4) diagnóstico: itens capturados no texto inteiro que NÃO aparecem na seção/competências
  const compSet = new Set(competencies);
  const foundOutsideSection = allMatches
    .map((x) => x.value)
    .filter((v) => !compSet.has(v));

  return {
    competencies,
    debug: {
      sectionFound,
      ignoredFromDates: [...new Set(ignoredFromDates)].slice(0, 6), // só exemplos
      foundOutsideSection: [...new Set(foundOutsideSection)].slice(0, 6), // só exemplos
    },
  };
}

function buildYearStatus(competencies) {
  const byYear = {};
  for (const c of competencies) {
    const [mm, yyyy] = c.split("/");
    if (!byYear[yyyy]) byYear[yyyy] = new Set();
    byYear[yyyy].add(`${mm}/${yyyy}`);
  }

  const years = {};
  for (const year of Object.keys(byYear)) {
    const presentSet = byYear[year];
    const present = [...presentSet].sort();

    const missing = [];
    for (let i = 1; i <= 12; i++) {
      const mm = String(i).padStart(2, "0");
      const key = `${mm}/${year}`;
      if (!presentSet.has(key)) missing.push(key);
    }

    years[year] = { present, missing, complete: missing.length === 0 };
  }
  return years;
}

// -------------------- Rotas --------------------
app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/analyze-dcps", upload.array("pdfs", 10), async (req, res) => {
  const t0 = Date.now();
  const ip = getClientIp(req);

  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).send("Nenhum PDF enviado.");
    }

    console.log(`[DCP] POST /api/analyze-dcps ip=${ip} arquivos=${files.length}`);

    const items = [];
    for (const f of files) {
      const parsed = await pdfParse(f.buffer);
      const text = parsed?.text || "";

      const agreementNumber = extractAgreementNumber(text);
      const { competencies: rawCompetencies, debug } = extractCompetenciesWithDebug(text);
      const years = buildYearStatus(rawCompetencies);

      const yearKeys = Object.keys(years || {}).sort();
      console.log(
        `[DCP] arquivo="${f.originalname}" acordo="${agreementNumber || "N/I"}" comps=${rawCompetencies.length} anos=${yearKeys.join(",") || "N/I"}`
      );

      // Warnings úteis
      if (!debug.sectionFound) {
        console.warn(
          `[DCP][WARN] Seção "3. LANÇAMENTOS DA RUBRICA" não encontrada. Extração pode ficar mais suscetível a ruído. arquivo="${f.originalname}"`
        );
      }

      if (debug.ignoredFromDates.length > 0) {
        console.warn(
          `[DCP][WARN] Ignoradas ocorrências que pareciam competência, mas vieram de datas (dd/mm/aaaa). arquivo="${f.originalname}" exemplos=${JSON.stringify(
            debug.ignoredFromDates
          )}`
        );
      }

      // Se quiser, esse warn ajuda a mapear PDFs “sujos”/diferentes:
      if (debug.foundOutsideSection.length > 0) {
        console.warn(
          `[DCP][WARN] Encontradas ocorrências mm/aaaa fora da seção analisada (diagnóstico). arquivo="${f.originalname}" exemplos=${JSON.stringify(
            debug.foundOutsideSection
          )}`
        );
      }

      items.push({
        fileName: f.originalname,
        agreementNumber,
        rawCompetencies,
        years,
      });
    }

    const ms = Date.now() - t0;
    console.log(`[DCP] OK ip=${ip} arquivos=${(req.files || []).length} tempo=${ms}ms`);

    res.json({ ok: true, items });
  } catch (err) {
    const ms = Date.now() - t0;
    console.error(`[DCP][ERROR] ip=${ip} tempo=${ms}ms msg=${err?.message || err}`);
    res.status(500).send(err?.message || "Erro interno.");
  }
});

// -------------------- Inicialização --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ API rodando na porta ${PORT}`));
