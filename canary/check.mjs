// Kumsal gece kanaryası — kontrol.
//
// rules.json'ı okur, yer gerçeği sayfalarını çeker, kural dosyasındaki seçicileri/kalıpları uygular
// ve sonucu fixtures.json'daki değişmez değerlerle karşılaştırır. Hepsi tutarsa sessizce biter
// (exit 0). Bir kaynak "kırık"sa exit 1. Cloudflare doğrulaması / Google izin-JavaScript sayfası
// "belirsiz" sayılır, HATA SAYILMAZ (veri merkezi IP'lerinin bilinen sınırı).
//
// Hızlı Başlangıç (rules.json → quickstart): üç liste sayfası (akorlab tür, akorlar popüler, UG
// explore) için kategori adresinden asgari N şarkı satırı çıkarılabiliyor mu diye bakılır; akorlab
// listesi istemcide çizildiği için WKWebView çizicisiyle (canary/render.swift) okunur.
//
// Kullanım: node canary/check.mjs [--rules rules.json] [--only akorlar,quickstart.ug] [--snapshots dir] [--json]
// Bu betik HİÇBİR dosyaya yazmaz.

import * as cheerio from "cheerio";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");
export const RULES_PATH = path.join(ROOT, "rules.json");
const FIXTURES = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "fixtures.json"), "utf8"));
const FETCHER = path.join(here, "bin", "fetch");
const RENDERER = path.join(here, "bin", "render");
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export const fixtures = FIXTURES;

// MARK: Getirme

/** Sayfa: önce URLSession getiricisi (varsa), yoksa Node fetch. `snapshots` verilirse dosyadan. */
export async function fetchPage(url, { snapshots } = {}) {
  if (snapshots) {
    const file = path.join(snapshots, encodeURIComponent(url) + ".html");
    if (!fs.existsSync(file)) return { status: 0, html: "" };
    return { status: 200, html: fs.readFileSync(file, "utf8") };
  }
  if (fs.existsSync(FETCHER)) {
    return await new Promise((resolve) => {
      execFile(FETCHER, [url], { maxBuffer: 20 * 1024 * 1024, timeout: 30000 }, (error, stdout, stderr) => {
        const match = /status (\d+)/.exec(stderr || "");
        resolve({ status: match ? Number(match[1]) : 0, html: stdout || "" });
      });
    });
  }
  try {
    const response = await fetch(url, { headers: { "user-agent": UA, "accept-language": "tr-TR,tr;q=0.9,en;q=0.8" },
                                        signal: AbortSignal.timeout(30000) });
    return { status: response.status, html: await response.text() };
  } catch (error) {
    return { status: 0, html: "", error: String(error) };
  }
}

/** Çizilmiş sayfa (WKWebView; canary/render.swift). Çizici yoksa `null` → kontrol "belirsiz". */
export async function renderPage(url, readySelector, { snapshots } = {}) {
  if (snapshots) return fetchPage(url, { snapshots });
  if (!fs.existsSync(RENDERER)) return null;
  return await new Promise((resolve) => {
    execFile(RENDERER, [url, readySelector, "12"], { maxBuffer: 20 * 1024 * 1024, timeout: 40000 }, (error, stdout, stderr) => {
      const match = /status (\d+)/.exec(stderr || "");
      resolve({ status: match ? Number(match[1]) : 0, html: stdout || "" });
    });
  });
}

/** Bot duvarı: Cloudflare doğrulaması → belirsiz (seçici kırığı DEĞİL). */
export function isBotWall({ status, html }) {
  return (status === 403 || status === 503 || status === 429)
    // Normal Cloudflare sayfaları da `/cdn-cgi/challenge-platform/` betiği taşır — yalnız doğrulama
    // sayfasına özgü işaretler sayılır.
    || /<title>\s*Just a moment|window\._cf_chl_opt|Enable JavaScript and cookies to continue/i.test(html);
}

// MARK: Yardımcılar

const lower = (s) => (s || "").toLocaleLowerCase("tr");
const squash = (s) => (s || "").replace(/\s+/g, " ").trim();
const matches = (value, pattern) => new RegExp(pattern, "i").test(value);
function hasChordToken(text, chord) {
  const escaped = chord.replace(/[.*+?^${}()|[\]\\#]/g, "\\$&");
  return new RegExp(`(^|[\\s\\[\\]>])${escaped}($|[\\s\\[\\]<])`, "m").test(text);
}
function missing(haystack, needles, label) {
  return needles.filter((n) => !lower(haystack).includes(lower(n))).map((n) => `${label} yok: "${n}"`);
}

// MARK: Kaynak kontrolleri (yalnız kural dosyasındaki değerleri sınar + sayfa akıl sağlığı)

function checkUrlPattern(fixture, block, reasons) {
  const urlPath = new URL(fixture.url).pathname.toLowerCase();
  const pattern = block.songPathPattern || block.tabPathPattern;
  if (!matches(urlPath, pattern)) reasons.push(`URL kalıbı eşleşmedi: ${pattern}`);
  const slug = urlPath.replace(/^\/|\/$/g, "");
  if ((block.nonSongPaths || []).includes(slug)) reasons.push("URL şarkı-dışı listede");
}

function checkAkorlar(fixture, block, $) {
  const reasons = [];
  checkUrlPattern(fixture, block, reasons);
  const marker = block.songMarkers.find((sel) => $(sel).toArray().some((el) => squash($(el).text())));
  if (!marker) reasons.push(`songMarkers hiçbiri dolu değil: ${block.songMarkers.join(", ")}`);
  const container = block.chordContainers.map((sel) => $(sel).toArray().find((el) => squash($(el).text())))
    .find(Boolean);
  if (!container) {
    reasons.push(`chordContainers hiçbiri dolu değil: ${block.chordContainers.join(", ")}`);
  } else {
    const text = $(container).text();
    reasons.push(...missing(text, fixture.lyrics, "söz"));
    reasons.push(...fixture.chords.filter((c) => !hasChordToken(text, c)).map((c) => `akor yok: ${c}`));
  }
  return reasons;
}

function checkAkorlab(fixture, block, $) {
  const reasons = [];
  checkUrlPattern(fixture, block, reasons);
  const markerTexts = block.songMarkers.flatMap((sel) => $(sel).toArray().map((el) => squash($(el).text()))).filter(Boolean);
  if (markerTexts.length === 0) reasons.push(`songMarkers hiçbiri dolu değil: ${block.songMarkers.join(", ")}`);
  else reasons.push(...fixture.chords.filter((c) => !markerTexts.includes(c)).map((c) => `akor yok (işaretlerde): ${c}`));
  reasons.push(...missing($("body").text(), fixture.lyrics, "söz"));
  return reasons;
}

function checkUltimateGuitar(fixture, block, $) {
  const reasons = [];
  checkUrlPattern(fixture, block, reasons);
  const raw = $(block.storeSelector).first().attr("data-content");
  if (!raw) return [...reasons, `storeSelector verisi yok: ${block.storeSelector}`];
  let json;
  try { json = JSON.parse(raw); } catch { return [...reasons, "storeSelector verisi JSON değil"]; }
  const content = JSON.stringify(json);
  reasons.push(...missing(content, fixture.lyrics, "söz"));
  reasons.push(...fixture.chords.filter((c) => !content.includes(`[ch]${c}[/ch]`)).map((c) => `akor yok: ${c}`));
  return reasons;
}

const PROVIDER_CHECKS = { akorlar: checkAkorlar, akorlab: checkAkorlab, ultimateGuitar: checkUltimateGuitar };

/** Tek kaynak: { id, status: ok|fail|inconclusive, reasons, html } */
export async function checkSource(rules, fixture, options = {}) {
  const page = await fetchPage(fixture.url, options);
  if (isBotWall(page)) return { id: fixture.id, status: "inconclusive", reasons: [`bot duvarı (HTTP ${page.status})`] };
  if (page.status === 0 || page.status >= 400) {
    return { id: fixture.id, status: "fail", reasons: [`sayfa gelmedi (HTTP ${page.status})`], html: page.html };
  }
  const $ = cheerio.load(page.html);
  const reasons = PROVIDER_CHECKS[fixture.id](fixture, rules.providers[fixture.id], $);
  // Akıl sağlığı (kural dışı): sayfa hâlâ o şarkı mı — tutmazsa tamir edilemez, issue açılır.
  const pageText = fixture.id === "ultimateGuitar" ? page.html : $("title").text() + " " + $("h1").text() + " " + $("body").text();
  reasons.push(...missing(pageText, [fixture.title, fixture.artist], "başlık/sanatçı"));
  return { id: fixture.id, blockPath: ["providers", fixture.id], status: reasons.length ? "fail" : "ok", reasons, html: page.html };
}

// MARK: Hızlı Başlangıç liste sayfaları (quickstart bölümü)

/** Liste sayfasından şarkı satırları: uygulamadaki `QuickStartListParser` ile aynı kurallar. */
export function listSongs(rules, sourceId, html, pageUrl) {
  const block = rules.quickstart.sources[sourceId];
  const $ = cheerio.load(html || "");
  if (sourceId === "ug") {
    const raw = $(block.rowSelector).first().attr("data-content");
    let tabs = [];
    try { tabs = JSON.parse(raw).store.page.data.data.tabs || []; } catch { return []; }
    const pattern = rules.providers.ultimateGuitar.tabPathPattern;
    return tabs.filter((tab) => {
      if (tab.type && String(tab.type).toLowerCase() !== "chords") return false;
      if (typeof tab[block.titleSelector] !== "string" || !tab[block.titleSelector]) return false;
      try { return matches(new URL(tab.tab_url).pathname.toLowerCase(), pattern); } catch { return false; }
    }).map((tab) => ({ title: tab[block.titleSelector], artist: tab[block.artistSelector] || "", url: tab.tab_url }));
  }
  const provider = rules.providers[sourceId];
  const songs = [];
  $(block.rowSelector).each((_, el) => {
    let url;
    try { url = new URL($(el).attr("href") || "", pageUrl); } catch { return; }
    const urlPath = url.pathname.toLowerCase();
    if (!matches(urlPath, provider.songPathPattern)) return;
    if ((provider.nonSongPaths || []).includes(urlPath.replace(/^\/|\/$/g, ""))) return;
    const title = squash($(el).find(block.titleSelector).first().text());
    if (!title) return;
    songs.push({ title, artist: squash($(el).find(block.artistSelector).first().text()), url: url.href });
  });
  return songs;
}

/** Tek liste sayfası: kategori adresi rules.json'dan; asgari N şarkı çıkarılabiliyor mu? */
export async function checkList(rules, fixture, options = {}) {
  const sourceId = fixture.source;
  const id = `quickstart.${sourceId}`;
  const blockPath = ["quickstart", "sources", sourceId];
  const category = (rules.quickstart?.locales?.[fixture.locale] || []).find((c) => c.id === fixture.category);
  const block = rules.quickstart?.sources?.[sourceId];
  if (!category || !block || category.source !== sourceId) {
    return { id, blockPath, status: "fail", reasons: [`quickstart: ${fixture.locale}/${fixture.category} (${sourceId}) kural dosyasında yok`] };
  }
  const page = block.rendered ? await renderPage(category.url, block.rowSelector, options) : await fetchPage(category.url, options);
  if (page === null) return { id, blockPath, status: "inconclusive", reasons: ["çizici yok (canary/bin/render derlenmemiş)"] };
  if (isBotWall(page)) return { id, blockPath, status: "inconclusive", reasons: [`bot duvarı (HTTP ${page.status})`] };
  if (page.status === 0 || page.status >= 400) {
    // Çizici ekransız ortamda sayfa üretemeyebilir: seçici kırığı değil.
    const status = block.rendered ? "inconclusive" : "fail";
    return { id, blockPath, status, reasons: [`sayfa gelmedi (HTTP ${page.status})`], html: page.html, url: category.url };
  }
  const songs = listSongs(rules, sourceId, page.html, category.url);
  const reasons = songs.length >= fixture.minSongs ? []
    : [`liste: ${songs.length} şarkı < ${fixture.minSongs} (rowSelector: ${block.rowSelector})`];
  return { id, blockPath, status: reasons.length ? "fail" : "ok", reasons, html: page.html, url: category.url, count: songs.length };
}

/** Google: sabit sorgu, organik sonuç sayısı ≥ beklenen. İzin / JavaScript sayfası → belirsiz. */
export async function checkGoogle(rules, options = {}) {
  const google = FIXTURES.google;
  const url = `https://www.google.com/search?hl=en&q=${encodeURIComponent(google.query)}`;
  const page = await fetchPage(url, options);
  const serp = rules.serp;
  const $ = cheerio.load(page.html || "");
  const consent = new RegExp(serp.consentHostPattern).test(page.html) || $(serp.consentFormSelector).length > 0;
  const jsWall = /enablejs|Please click here if you are not redirected|httpservice\/retry/i.test(page.html);
  const container = $(serp.resultContainer).first();
  if (!container.length && (consent || jsWall || isBotWall(page) || page.status !== 200)) {
    return { id: "google", status: "inconclusive", reasons: ["izin / JavaScript / doğrulama sayfası (veri merkezi IP'si)"] };
  }
  if (!container.length) return { id: "google", status: "fail", reasons: [`resultContainer yok: ${serp.resultContainer}`], html: page.html };
  const adRoots = serp.adContainers.map((sel) => $(sel)).filter((el) => el.length);
  const results = container.find("a[href]").toArray().filter((a) => {
    if (!$(a).find(serp.headingSelector).length) return false;
    if ($(a).closest(serp.adMarkerSelector).length) return false;
    return !adRoots.some((root) => root.find(a).length);
  });
  const reasons = results.length >= google.minResults ? [] : [`organik sonuç ${results.length} < ${google.minResults}`];
  return { id: "google", status: reasons.length ? "fail" : "ok", reasons, html: page.html };
}

export async function runChecks(rules, { only, snapshots } = {}) {
  const results = [];
  for (const fixture of FIXTURES.sources) {
    if (only && !only.includes(fixture.id)) continue;
    results.push(await checkSource(rules, fixture, { snapshots }));
  }
  for (const fixture of FIXTURES.lists || []) {
    if (only && !only.includes(`quickstart.${fixture.source}`) && !only.includes("quickstart")) continue;
    results.push(await checkList(rules, fixture, { snapshots }));
  }
  if (!only || only.includes("google")) results.push(await checkGoogle(rules, { snapshots }));
  return results;
}

export function readRules(file = RULES_PATH) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// MARK: CLI

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rules = readRules(argValue("--rules") ? path.resolve(argValue("--rules")) : RULES_PATH);
  const only = argValue("--only")?.split(",");
  const results = await runChecks(rules, { only, snapshots: argValue("--snapshots") });
  const failed = results.filter((r) => r.status === "fail");
  for (const r of results) {
    const mark = { ok: "✓", fail: "✗", inconclusive: "?" }[r.status];
    console.log(`${mark} ${r.id}: ${r.status}${r.reasons.length ? " — " + r.reasons.join("; ") : ""}`);
  }
  if (process.argv.includes("--json")) {
    console.log("CANARY_RESULT " + JSON.stringify(results.map(({ html, ...r }) => r)));
  }
  process.exit(failed.length ? 1 : 0);
}
