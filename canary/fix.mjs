// Kumsal gece kanaryası — otomatik tamir (yalnız kontrol düşünce koşar).
//
// Kırık kaynağın güncel HTML'ini kırpar (script/style atılmış, ~50 KB), Claude'a "şema bu, eski
// seçiciler bu, sayfa değişmiş; YALNIZ seçici/kalıp değerlerini güncelle" der ve aday blok alır.
// DOĞRULAMA KAPISI: aday kurallarla kontrol yeniden koşar; tamir edilen kaynak "ok" OLMALI ve diğer
// kaynaklarda yeni kırık olmamalı. Geçerse version+1, updatedAt güncellenir, rules.json yazılır
// (exit 0, stdout'ta FIXED_SOURCE=<kaynak>). Geçmezse HİÇBİR ŞEY yazılmaz (exit 2; stdout = issue
// gövdesi).
//
// Korkuluklar (kodda): koşu başına en çok 1 tamir denemesi (ilk kırık kaynak); betiğin yazabildiği
// tek dosya rules.json (writeRules yol denetler); şema alanı eklenemez/silinemez, tipler korunur.
//
// Kuru koşu (API anahtarı gerekmez): node canary/fix.mjs --dry-run --mock-response yanit.json
//   [--snapshots dir]  → kapı sahte yanıtla koşar, rules.json'a YAZILMAZ.

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { RULES_PATH, fixtures, readRules, runChecks } from "./check.mjs";

const MODEL = process.env.CANARY_MODEL || "claude-haiku-5-5";
const HTML_LIMIT = 50_000;

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const dryRun = process.argv.includes("--dry-run");
const snapshots = argValue("--snapshots");
const mockFile = argValue("--mock-response");

/** Betiğin TEK yazma noktası. */
function writeRules(file, rules) {
  if (path.resolve(file) !== path.resolve(RULES_PATH)) throw new Error(`yalnız rules.json yazılabilir: ${file}`);
  fs.writeFileSync(file, JSON.stringify(rules, null, 2) + "\n");
}

/** script/style/svg/yorum atılır, boşluk sıkıştırılır; söz parçasının çevresi öncelikli ~50 KB. */
export function trimHTML(html, anchors = []) {
  let text = html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(link|meta)\b[^>]*>/gi, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n");
  if (text.length <= HTML_LIMIT) return text;
  const lowerText = text.toLocaleLowerCase("tr");
  const hit = anchors.map((a) => lowerText.indexOf(a.toLocaleLowerCase("tr"))).find((i) => i >= 0) ?? 0;
  const start = Math.max(0, Math.min(hit - HTML_LIMIT / 2, text.length - HTML_LIMIT));
  return text.slice(start, start + HTML_LIMIT);
}

/** Mevcut bloktan katı JSON şeması: aynı anahtarlar, aynı tipler, ek alan YOK. */
export function schemaFor(block) {
  const properties = {};
  for (const [key, value] of Object.entries(block)) {
    properties[key] = Array.isArray(value) ? { type: "array", items: { type: "string" } }
      : typeof value === "number" ? { type: "number" } : typeof value === "boolean" ? { type: "boolean" } : { type: "string" };
  }
  return { type: "object", properties, required: Object.keys(block), additionalProperties: false };
}

/** Aday blok eski blokla AYNI şekilde mi (alan eklenmemiş/silinmemiş, tipler aynı). */
export function sameShape(oldBlock, candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const a = Object.keys(oldBlock).sort(), b = Object.keys(candidate).sort();
  if (a.length !== b.length || a.some((k, i) => k !== b[i])) return false;
  return a.every((k) => Array.isArray(oldBlock[k])
    ? Array.isArray(candidate[k]) && candidate[k].length > 0 && candidate[k].every((v) => typeof v === "string" && v.trim())
    : typeof oldBlock[k] === typeof candidate[k] && (typeof candidate[k] !== "string" || candidate[k].trim()));
}

const getBlock = (rules, blockPath) => blockPath.reduce((node, key) => node?.[key], rules);
function setBlock(rules, blockPath, block) {
  const parent = blockPath.slice(0, -1).reduce((node, key) => node[key], rules);
  parent[blockPath.at(-1)] = block;
}

/** Hızlı Başlangıç liste sayfası (quickstart.sources.*): beklenti asgari şarkı satırı. */
async function askClaudeForList(target, block) {
  const sourceId = target.blockPath.at(-1);
  const html = trimHTML(target.html || "", ["/akorlar/", "song-list", "js-store"]);
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { format: { type: "json_schema", schema: schemaFor(block) } },
    messages: [{
      role: "user",
      content:
        `Bir mobil uygulamanın kural dosyasında "${sourceId}" LİSTE sayfası bloğu artık sayfayla eşleşmiyor; site HTML yapısını değiştirmiş.\n` +
        `Görev: YALNIZ seçici DEĞERLERİNİ güncel HTML'e göre düzelt. Alan ekleme, silme, yeniden adlandırma YOK; aynı şemayı döndür; "rendered" değerini değiştirme.\n` +
        `Alanlar: rowSelector = listedeki her şarkının bağlantısı (<a href>) için CSS seçicisi (ug'de: veriyi data-content özniteliğinde taşıyan öğe); ` +
        `titleSelector / artistSelector = o bağlantının İÇİNDE şarkı adını / sanatçıyı taşıyan öğe (ug'de: JSON alan adı).\n\n` +
        `Eski blok:\n${JSON.stringify(block, null, 2)}\n\n` +
        `Kontrolün düşme nedenleri:\n- ${target.reasons.join("\n- ")}\n\n` +
        `Sayfa adresi: ${target.url}\nBeklenen: sayfadaki şarkı listesinden en az birkaç on şarkı bağlantısı (ad + sanatçı).\n\n` +
        `Güncel HTML (kırpılmış):\n${html}`,
    }],
  });
  if (response.stop_reason !== "end_turn") throw new Error(`model yanıtı tamamlanmadı: ${response.stop_reason}`);
  return JSON.parse(response.content.find((b) => b.type === "text")?.text ?? "");
}

async function askClaude(sourceId, block, failure) {
  const fixture = fixtures.sources.find((s) => s.id === sourceId);
  const html = trimHTML(failure.html || "", [...fixture.lyrics, fixture.title]);
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { format: { type: "json_schema", schema: schemaFor(block) } },
    messages: [{
      role: "user",
      content:
        `Bir mobil uygulamanın web sayfası kural dosyasında "${sourceId}" bloğu artık sayfayla eşleşmiyor; site HTML yapısını değiştirmiş.\n` +
        `Görev: YALNIZ seçici/kalıp DEĞERLERİNİ güncel HTML'e göre düzelt. Alan ekleme, silme, yeniden adlandırma YOK; aynı şemayı döndür.\n` +
        `Alanlar: songMarkers/chordContainers = CSS seçicileri (akor içeriği taşıyan öğe); *PathPattern = küçük harfli URL yoluna uygulanan düzenli ifade; storeSelector = veriyi data-content özniteliğinde taşıyan öğe.\n\n` +
        `Eski blok:\n${JSON.stringify(block, null, 2)}\n\n` +
        `Kontrolün düşme nedenleri:\n- ${failure.reasons.join("\n- ")}\n\n` +
        `Sayfa adresi: ${fixture.url}\nBeklenen: başlık "${fixture.title}", sanatçı "${fixture.artist}", akorlar ${fixture.chords.join(" ")}, söz parçaları ${fixture.lyrics.map((l) => `"${l}"`).join(", ")}.\n\n` +
        `Güncel HTML (kırpılmış):\n${html}`,
    }],
  });
  if (response.stop_reason !== "end_turn") throw new Error(`model yanıtı tamamlanmadı: ${response.stop_reason}`);
  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  return JSON.parse(text);
}

async function main() {
  const rules = readRules();
  const before = await runChecks(rules, { snapshots });
  const failures = before.filter((r) => r.status === "fail");
  const lines = [];
  if (failures.length === 0) {
    console.log("Kırık kaynak yok; tamir gerekmiyor.");
    return 0;
  }
  // Korkuluk: koşu başına en çok 1 tamir denemesi — ilk kırık SAĞLAYICI ya da LİSTE bloğu
  // (blockPath taşıyan: providers.* / quickstart.sources.*).
  const target = failures.find((f) => f.blockPath && getBlock(rules, f.blockPath));
  const oldBlock = target ? getBlock(rules, target.blockPath) : undefined;
  const isList = target?.blockPath[0] === "quickstart";
  const others = failures.filter((f) => f !== target).map((f) => `${f.id}: ${f.reasons.join("; ")}`);
  if (!target) {
    lines.push("Otomatik tamir kapsamı dışında kırık (yalnız sağlayıcı ve liste blokları tamir edilir):", ...others);
    console.log(lines.join("\n"));
    return 2;
  }
  lines.push(`Kaynak: ${target.id}`, `Düşme nedenleri: ${target.reasons.join("; ")}`);

  let candidateBlock;
  try {
    candidateBlock = mockFile ? JSON.parse(fs.readFileSync(mockFile, "utf8"))
      : isList ? await askClaudeForList(target, oldBlock) : await askClaude(target.id, oldBlock, target);
  } catch (error) {
    lines.push(`Tamir önerisi alınamadı: ${error.message}`);
    console.log(lines.join("\n"));
    return 2;
  }
  if (!sameShape(oldBlock, candidateBlock)) {
    lines.push("Aday reddedildi: şema değişmiş (alan eklenmiş/silinmiş ya da tip farklı).");
    console.log(lines.join("\n"));
    return 2;
  }

  // DOĞRULAMA KAPISI
  const candidate = structuredClone(rules);
  setBlock(candidate, target.blockPath, candidateBlock);
  const after = await runChecks(candidate, { snapshots });
  const fixed = after.find((r) => r.id === target.id);
  const regressions = after.filter((r) => r.status === "fail" && before.find((b) => b.id === r.id)?.status !== "fail");
  if (fixed?.status !== "ok" || regressions.length) {
    lines.push("Doğrulama kapısı GEÇMEDİ — hiçbir şey yazılmadı.",
      `Aday: ${JSON.stringify(candidateBlock)}`,
      `Aday sonuç: ${fixed?.status} ${fixed?.reasons?.join("; ") ?? ""}`,
      ...regressions.map((r) => `Yeni kırık: ${r.id}: ${r.reasons.join("; ")}`));
    if (others.length) lines.push("Diğer kırıklar:", ...others);
    console.log(lines.join("\n"));
    return 2;
  }

  candidate.version = rules.version + 1;
  candidate.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  if (dryRun) {
    console.log([...lines, `KURU KOŞU: kapı geçti; rules.json'a yazılmadı (olacak sürüm ${candidate.version}).`,
      `Aday: ${JSON.stringify(candidateBlock)}`].join("\n"));
  } else {
    writeRules(RULES_PATH, candidate);
    console.log([...lines, `Tamir edildi: sürüm ${candidate.version}.`].join("\n"));
  }
  if (others.length) console.log(["Ayrıca kırık (bu koşuda denenmedi):", ...others].join("\n"));
  console.log(`FIXED_SOURCE=${target.id}`);
  return 0;
}

process.exit(await main());
