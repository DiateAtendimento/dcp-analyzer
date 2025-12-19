import express from "express";
import cors from "cors";
import multer from "multer";
import pdfParse from "pdf-parse";

const app = express();

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

/**
 * Extrai apenas competências reais (mm/aaaa),
 * ignorando datas completas (dd/mm/aaaa) e campos de cabeçalho.
 */
function extractCompetencies(text) {
  if (!text) return [];

  // Recorta apenas a parte de “3. LANÇAMENTOS DA RUBRICA” até “TOTAL”
  const lower = text.toLowerCase();
  let section = text;
  const start = lower.indexOf("3. lançamentos da rubrica");
  const end = lower.indexOf("total");

  if (start !== -1) {
    section = end !== -1 ? text.slice(start, end) : text.slice(start);
  }

  // Captura mm/aaaa, mas ignora se vier precedido de dd/ (evita 30/12/2020 etc)
  const rx = /(?<!\d{1,2}\/)\b(0[1-9]|1[0-3])\/(19\d{2}|20\d{2})\b/g;
  const found = new Set();
  let m;

  while ((m = rx.exec(section)) !== null) {
    found.add(`${m[1]}/${m[2]}`);
  }

  return [...found].sort();
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
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).send("Nenhum PDF enviado.");
    }

    const items = [];
    for (const f of files) {
      const parsed = await pdfParse(f.buffer);
      const text = parsed?.text || "";

      const agreementNumber = extractAgreementNumber(text);
      const rawCompetencies = extractCompetencies(text);
      const years = buildYearStatus(rawCompetencies);

      items.push({
        fileName: f.originalname,
        agreementNumber,
        rawCompetencies,
        years,
      });
    }

    res.json({ ok: true, items });
  } catch (err) {
    console.error(err);
    res.status(500).send(err?.message || "Erro interno.");
  }
});

// -------------------- Inicialização --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ API rodando na porta ${PORT}`));
