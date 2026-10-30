"use strict";

const TICKS_PER_SECOND = 254016000000n;

function parseTimecode(value) {
  const match = /^(\d{2,}):(\d{2}):(\d{2}),(\d{3})$/.exec(value.trim());
  if (!match) throw new Error(`Nieprawidłowy timecode SRT: ${value}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4]);
  if (minutes > 59 || seconds > 59) throw new Error(`Nieprawidłowy timecode SRT: ${value}`);
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

function formatTimecode(secondsValue) {
  const totalMs = Math.max(0, Math.round(secondsValue * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const milliseconds = totalMs % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}
function suggestTtmlFileName(srtNameOrPath, scope = "all") { const fileName = String(srtNameOrPath || "karaoke.srt").split(/[\\/]/).pop() || "karaoke.srt"; const stem = fileName.replace(/\.[^.]+$/, "") || "karaoke"; return scope === "all" ? `${stem}.xml` : `${stem}_${scope}.xml`; }

// Ustawienia wyglądu, które należą do kanału. Czasy analizy i ścieżki zostają poza presetem.
const CHANNEL_STYLE_KEYS = [
  "font", "fontSize", "maxLines", "alignment", "baseColor", "activeColor", "pastColor",
  "strokeColor", "strokeWidth", "positionX", "positionY", "safeMargin", "textBoxWidth",
  "lineHeight", "highlightMode", "activeBackgroundColor", "backgroundColor", "usePastColor",
  "activeBold", "shadow", "background", "displayLeadIn", "displayTail"
];

const BUILT_IN_CHANNEL_PRESETS = [
  {
    id: "szlagier-tv",
    name: "Szlagier TV",
    builtIn: true,
    settings: {
      font: "Arial-BoldMT", fontSize: 82, maxLines: "2", alignment: "center",
      baseColor: "#ffffff", activeColor: "#ffd400", pastColor: "#8ed8ff",
      strokeColor: "#000000", strokeWidth: 5, positionX: 50, positionY: 82, safeMargin: 8,
      textBoxWidth: 84, lineHeight: 110, highlightMode: "text", activeBackgroundColor: "#554400",
      backgroundColor: "#000000", usePastColor: true, activeBold: true, shadow: true, background: false,
      displayLeadIn: 0.30, displayTail: 0.25
    }
  },
  {
    id: "music-xmas",
    name: "Music Xmas",
    builtIn: true,
    settings: {
      font: "Arial-BoldMT", fontSize: 82, maxLines: "2", alignment: "center",
      baseColor: "#ffffff", activeColor: "#e31e24", pastColor: "#e8d5b0",
      strokeColor: "#000000", strokeWidth: 5, positionX: 50, positionY: 82, safeMargin: 8,
      textBoxWidth: 84, lineHeight: 110, highlightMode: "text", activeBackgroundColor: "#554400",
      backgroundColor: "#000000", usePastColor: true, activeBold: true, shadow: true, background: false,
      displayLeadIn: 0.30, displayTail: 0.25
    }
  }
];

function pickChannelStyle(settings) {
  const style = {};
  for (const key of CHANNEL_STYLE_KEYS) if (settings[key] !== undefined) style[key] = settings[key];
  return style;
}

function channelPresetId(name) {
  const slug = String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/Ł/g, "L")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug ? `user-${slug}` : "";
}

function mergeChannelPresets(userPresets) {
  const builtInIds = new Set(BUILT_IN_CHANNEL_PRESETS.map((preset) => preset.id));
  const extra = Array.isArray(userPresets) ? userPresets
    .filter((preset) => preset && typeof preset.id === "string" && typeof preset.name === "string" && preset.settings && !builtInIds.has(preset.id))
    .map((preset) => ({ id: preset.id, name: preset.name, builtIn: false, settings: pickChannelStyle(preset.settings) })) : [];
  return [...BUILT_IN_CHANNEL_PRESETS, ...extra];
}

function stripSrtFormatting(text) {
  return text.replace(/<\/?(?:i|b|u|font)(?:\s[^>]*)?>/gi, "");
}

function normalizeWord(value) {
  return stripSrtFormatting(value).normalize("NFC").toLocaleLowerCase("pl-PL").replace(/[^\p{L}\p{N}]+/gu, "");
}

function tokenizeWords(text) {
  const candidates = stripSrtFormatting(text).match(/\S+/gu) || [];
  const result = [];
  for (const candidate of candidates) {
    const normalized = normalizeWord(candidate);
    if (normalized) result.push({ index: result.length, text: candidate, normalized });
  }
  return result;
}

function tokenizeWordSpans(text) {
  const plain = stripSrtFormatting(text);
  const result = [];
  const expression = /\S+/gu;
  let match;
  while ((match = expression.exec(plain)) !== null) {
    const normalized = normalizeWord(match[0]);
    if (normalized) result.push({ index: result.length, text: match[0], normalized, startOffset: match.index, endOffset: match.index + match[0].length });
  }
  return result;
}

function stableEntryId(number, start, end, text) {
  const input = `${number}|${start.toFixed(3)}|${end.toFixed(3)}|${text}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `k-${number}-${hash.toString(16).padStart(8, "0")}`;
}

function parseSrt(source) {
  const normalizedSource = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!normalizedSource) return { entries: [], issues: [{ severity: "error", code: "empty", message: "Plik SRT jest pusty." }] };
  const blocks = normalizedSource.split(/\n{2,}/);
  const entries = [];
  const issues = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const number = Number(lines.shift());
    const timingLine = lines.shift() || "";
    const timing = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(timingLine);
    if (!Number.isInteger(number) || number < 0 || !timing) {
      issues.push({ severity: "error", code: "malformed-block", message: `Nieprawidłowy blok SRT: ${block.slice(0, 80)}` });
      continue;
    }
    try {
      const start = parseTimecode(timing[1]);
      const end = parseTimecode(timing[2]);
      const text = lines.join("\n");
      if (end <= start) throw new Error("Koniec wpisu musi być później niż początek.");
      if (!text.trim()) throw new Error("Wpis nie zawiera tekstu.");
      const tokens = tokenizeWords(text);
      if (!tokens.length) throw new Error("Wpis nie zawiera słów do synchronizacji.");
      entries.push({ id: stableEntryId(number, start, end, text), number, start, end, text, plainText: stripSrtFormatting(text), words: tokens.map((token) => ({ ...token, start, end: start, confidence: null })), status: "unmatched", dirty: true, selected: true, warnings: [] });
    } catch (error) {
      issues.push({ severity: "error", code: "invalid-entry", entryNumber: number, message: error instanceof Error ? error.message : String(error) });
    }
  }
  entries.sort((a, b) => a.start - b.start || a.number - b.number);
  for (let i = 1; i < entries.length; i += 1) {
    if (entries[i].start < entries[i - 1].end) {
      issues.push({ severity: "warning", code: "overlap", entryNumber: entries[i].number, message: `Wpis ${entries[i].number} nakłada się na wpis ${entries[i - 1].number}.` });
      entries[i].warnings.push("Nakładanie z poprzednim wpisem");
    }
  }
  return { entries, issues };
}

function quickAlignEntry(entry, minimumWordDuration = 0.08) {
  const duration = entry.end - entry.start;
  const count = entry.words.length;
  if (!count || duration <= 0) throw new Error("Nie można zsynchronizować pustego lub ujemnego wpisu.");
  const feasibleMinimum = Math.min(Math.max(0, minimumWordDuration), duration / count);
  const remaining = Math.max(0, duration - feasibleMinimum * count);
  const weights = entry.words.map((word) => Math.pow(Math.max(1, Array.from(word.normalized).length), 0.72));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = entry.start;
  const words = entry.words.map((word, index) => {
    const allocated = feasibleMinimum + remaining * weights[index] / weightSum;
    const start = cursor;
    const end = index === count - 1 ? entry.end : Math.min(entry.end, cursor + allocated);
    cursor = end;
    return { ...word, index, start, end, confidence: null };
  });
  const warnings = entry.warnings.filter((warning) => warning !== "Tryb szybki — czasy są szacowane");
  warnings.push("Tryb szybki — czasy są szacowane");
  if (minimumWordDuration * count > duration) warnings.push("Wpis jest zbyt krótki dla wybranego minimum słowa");
  return { ...entry, words, status: "quick", dirty: true, warnings };
}

function quickAlignAll(entries, minimumWordDuration = 0.08) { return entries.map((entry) => quickAlignEntry(entry, minimumWordDuration)); }

function clampMonotonicWords(entry) {
  let cursor = entry.start;
  const words = entry.words.map((word, index) => {
    const start = Math.max(entry.start, Math.min(entry.end, Math.max(cursor, word.start)));
    const proposedEnd = Math.max(start, Math.min(entry.end, word.end));
    const end = index === entry.words.length - 1 ? entry.end : proposedEnd;
    cursor = end;
    return { ...word, index, start, end };
  });
  return { ...entry, words, dirty: true };
}

function updateWordTime(entry, wordIndex, start, end) {
  if (!entry.words[wordIndex]) throw new Error("Nieprawidłowy indeks słowa.");
  const words = entry.words.map((word, index) => index === wordIndex ? { ...word, start, end } : { ...word });
  return clampMonotonicWords({ ...entry, words });
}

function shiftEntry(entry, deltaSeconds) {
  return { ...entry, start: entry.start + deltaSeconds, end: entry.end + deltaSeconds, words: entry.words.map((word) => ({ ...word, start: word.start + deltaSeconds, end: word.end + deltaSeconds })), dirty: true };
}

function secondsToTicks(seconds) {
  if (!Number.isFinite(seconds)) throw new Error("Czas musi być liczbą skończoną.");
  return (BigInt(Math.round(seconds * 1000000)) * TICKS_PER_SECOND / 1000000n).toString();
}

function createActiveWordKeyframes(entry) {
  const keyframes = [];
  let previousRelative = -1;
  for (const word of entry.words) {
    const relative = Math.max(0, Math.min(entry.end - entry.start, word.start - entry.start));
    if (relative < previousRelative) throw new Error(`Niemonotoniczne czasy słów we wpisie ${entry.number}.`);
    keyframes.push({ time: relative, ticks: secondsToTicks(relative), value: word.index + 1, interpolation: "HOLD" });
    previousRelative = relative;
  }
  const out = entry.end - entry.start;
  keyframes.push({ time: out, ticks: secondsToTicks(out), value: 0, interpolation: "HOLD" });
  return keyframes;
}

function createGraphicStates(entry, pauseMode = "midpoint", displayLeadIn = 0, displayTail = 0) {
  if (!entry.words.length) return [];
  const spans = tokenizeWordSpans(entry.plainText);
  if (spans.length !== entry.words.length) throw new Error(`Nie można zmapować słów wpisu ${entry.number} na oryginalny tekst.`);
  const firstWordStart = entry.words[0].start;
  const lastWordEnd = entry.words[entry.words.length - 1].end;
  const displayStart = Math.max(0, Math.min(entry.start, firstWordStart - Math.max(0, displayLeadIn)));
  const displayEnd = Math.max(entry.end, lastWordEnd + Math.max(0, displayTail));
  const boundaries = [firstWordStart];
  for (let index = 1; index < entry.words.length; index += 1) {
    const previous = entry.words[index - 1];
    const current = entry.words[index];
    let boundary = pauseMode === "previous" ? current.start : pauseMode === "next" ? previous.end : (previous.end + current.start) / 2;
    boundary = Math.max(boundaries[index - 1], Math.min(lastWordEnd, boundary));
    boundaries.push(boundary);
  }
  boundaries.push(lastWordEnd);
  const states = entry.words.map((word, index) => ({ id: `${entry.id}-w${index + 1}`, entryId: entry.id, entryNumber: entry.number, activeWordIndex: index, start: boundaries[index], end: boundaries[index + 1], startTicks: secondsToTicks(boundaries[index]), endTicks: secondsToTicks(boundaries[index + 1]), text: entry.plainText, activeStartOffset: spans[index].startOffset, activeEndOffset: spans[index].endOffset, intro: false, outro: false }));
  if (displayStart < firstWordStart - 0.0005) states.unshift({ id: `${entry.id}-intro`, entryId: entry.id, entryNumber: entry.number, activeWordIndex: -1, start: displayStart, end: firstWordStart, startTicks: secondsToTicks(displayStart), endTicks: secondsToTicks(firstWordStart), text: entry.plainText, activeStartOffset: 0, activeEndOffset: 0, intro: false, outro: false });
  if (displayEnd > lastWordEnd + 0.0005) states.push({ id: `${entry.id}-outro`, entryId: entry.id, entryNumber: entry.number, activeWordIndex: entry.words.length, start: lastWordEnd, end: displayEnd, startTicks: secondsToTicks(lastWordEnd), endTicks: secondsToTicks(displayEnd), text: entry.plainText, activeStartOffset: entry.plainText.length, activeEndOffset: entry.plainText.length, intro: false, outro: false });
  states[0].intro = true;
  states[states.length - 1].outro = true;
  return states;
}

function entriesWithDisplayBounds(entries, displayLeadIn, displayTail) {
  return entries.map((entry) => {
    if (!entry.words.length) return { ...entry };
    const firstWordStart = entry.words[0].start;
    const lastWordEnd = entry.words[entry.words.length - 1].end;
    return { ...entry, start: Math.max(0, firstWordStart - displayLeadIn), end: lastWordEnd + displayTail };
  });
}

function markBoundaryStates(states) {
  if (!states.length) return states;
  const marked = states.map((state) => ({ ...state, intro: false, outro: false }));
  marked[0].intro = true;
  marked[marked.length - 1].outro = true;
  return marked;
}

function trimStatesAtEnd(states, boundary) {
  const kept = states.filter((state) => state.start < boundary - 0.0005).map((state) => state.end > boundary ? { ...state, end: boundary, endTicks: secondsToTicks(boundary) } : state);
  return markBoundaryStates(kept);
}

function trimStatesAtStart(states, boundary) {
  const kept = states.filter((state) => state.end > boundary + 0.0005).map((state) => state.start < boundary ? { ...state, start: boundary, startTicks: secondsToTicks(boundary) } : state);
  return markBoundaryStates(kept);
}

function enforceMinimumActiveDurations(groups, minimumDuration, displayLeadIn, displayTail) {
  const scheduled = groups.map((group) => group.map((state) => ({ ...state })));
  let previousActiveEnd = 0;
  for (const group of scheduled) {
    const activeStates = group.filter((state) => state.activeEndOffset > state.activeStartOffset);
    if (!activeStates.length) continue;
    for (const state of activeStates) {
      state.start = Math.max(state.start, previousActiveEnd);
      state.end = Math.max(state.end, state.start + minimumDuration);
      state.startTicks = secondsToTicks(state.start);
      state.endTicks = secondsToTicks(state.end);
      previousActiveEnd = state.end;
    }
    const intro = group.find((state) => state.activeWordIndex < 0);
    if (intro) { intro.start = Math.max(0, activeStates[0].start - displayLeadIn); intro.end = activeStates[0].start; intro.startTicks = secondsToTicks(intro.start); intro.endTicks = secondsToTicks(intro.end); }
    const outro = group.find((state) => state.activeWordIndex >= 0 && state.activeStartOffset === state.activeEndOffset);
    if (outro) {
      outro.start = activeStates[activeStates.length - 1].end;
      outro.end = outro.start + displayTail;
      outro.startTicks = secondsToTicks(outro.start);
      outro.endTicks = secondsToTicks(outro.end);
    }
  }
  return scheduled.map(markBoundaryStates);
}

function serializeGraphicStateGroups(groups, displayLeadIn, displayTail) {
  for (let index = 0; index < groups.length - 1; index += 1) {
    const currentStates = groups[index];
    const followingStates = groups[index + 1];
    if (!currentStates.length || !followingStates.length) continue;
    const currentEnd = currentStates[currentStates.length - 1].end;
    const followingStart = followingStates[0].start;
    if (currentEnd <= followingStart) continue;
    const currentActiveStates = currentStates.filter((state) => state.activeEndOffset > state.activeStartOffset);
    const followingActiveStates = followingStates.filter((state) => state.activeEndOffset > state.activeStartOffset);
    if (!currentActiveStates.length || !followingActiveStates.length) continue;
    const currentWordEnd = currentActiveStates[currentActiveStates.length - 1].end;
    const followingWordStart = followingActiveStates[0].start;
    const availableGap = Math.max(0, followingWordStart - currentWordEnd);
    const requestedPadding = displayTail + displayLeadIn;
    const tailShare = requestedPadding > 0 ? availableGap * displayTail / requestedPadding : 0;
    const preferredBoundary = currentWordEnd + tailShare;
    const boundary = Math.max(currentStates[0].start, Math.min(followingStates[followingStates.length - 1].end, preferredBoundary));
    groups[index] = trimStatesAtEnd(currentStates, boundary);
    groups[index + 1] = trimStatesAtStart(followingStates, boundary);
  }
  return groups.flat();
}

function escapeXml(value) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;"); }
function ttmlTime(secondsValue) { return formatTimecode(secondsValue).replace(",", "."); }
function cleanColor(value, fallback) { const color = String(value || fallback); return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : fallback; }
// Pusta część (tekst zaczyna się lub kończy na \n) nie dostaje spanu. Inaczej
// wiersz zyskałby dodatkową spację tylko w niektórych stanach i wyśrodkowany
// tekst przesuwałby się przy zmianie aktywnego słowa.
function spanXml(text, style) { if (!text) return ""; return text.split("\n").map((part) => part.trim() ? `<span xml:space="preserve" style="${style}">${escapeXml(part.trim())} </span>` : "").join("<br/>"); }

function generateTtml(entries, settings = {}, pauseMode = "midpoint") {
  const requestedLeadIn = Number(settings.displayLeadIn);
  const requestedTail = Number(settings.displayTail);
  const displayLeadIn = Number.isFinite(requestedLeadIn) ? Math.max(0, requestedLeadIn) : 0.30;
  const displayTail = Number.isFinite(requestedTail) ? Math.max(0, requestedTail) : 0.25;
  const requestedMinimumHighlight = Number(settings.minHighlight);
  const minimumHighlight = Number.isFinite(requestedMinimumHighlight) ? Math.max(0.04, requestedMinimumHighlight) : 0.12;
  const displayEntries = entriesWithDisplayBounds(entries, displayLeadIn, displayTail);
  const rawStateGroups = displayEntries.map((entry) => createGraphicStates(entry, pauseMode));
  const stateGroups = enforceMinimumActiveDurations(rawStateGroups, minimumHighlight, displayLeadIn, displayTail);
  const states = serializeGraphicStateGroups(stateGroups, displayLeadIn, displayTail);
  const font = escapeXml(String(settings.font || "Arial"));
  const fontSize = Math.max(8, Number(settings.fontSize || 82));
  const lineHeight = Math.max(50, Number(settings.lineHeight || 110));
  const baseColor = cleanColor(settings.baseColor, "#FFFFFF");
  const activeColor = cleanColor(settings.activeColor, "#FFD400");
  const pastColor = cleanColor(settings.pastColor, "#8ED8FF");
  const strokeColor = cleanColor(settings.strokeColor, "#000000");
  const strokeWidth = Math.max(0, Number(settings.strokeWidth || 0));
  const align = ["left", "center", "right"].includes(String(settings.alignment)) ? String(settings.alignment) : "center";
  const positionX = Math.max(0, Math.min(100, Number(settings.positionX || 50)));
  const positionY = Math.max(0, Math.min(100, Number(settings.positionY || 82)));
  const width = Math.max(10, Math.min(100, Number(settings.textBoxWidth || 84)));
  const originX = Math.max(0, Math.min(100 - width, positionX - width / 2));
  const originY = Math.max(0, Math.min(90, positionY - 12));
  const usePast = settings.usePastColor !== false;
  const activeBold = settings.activeBold !== false;
  const activeBox = settings.highlightMode === "box";
  const activeBackground = cleanColor(settings.activeBackgroundColor, "#554400");
  const sentenceBackground = settings.background ? cleanColor(settings.backgroundColor, "#000000") : "transparent";
  const textOutline = strokeWidth > 0 ? ` tts:textOutline="${strokeColor} ${strokeWidth}px"` : "";
  const textShadow = settings.shadow ? " tts:textShadow=\"2px 2px 3px #000000AA\"" : "";
  const paragraphs = states.map((state) => {
    const before = state.text.slice(0, state.activeStartOffset);
    const active = state.text.slice(state.activeStartOffset, state.activeEndOffset);
    const after = state.text.slice(state.activeEndOffset);
    let past = "";
    let pendingBefore = before;
    if (usePast && state.activeWordIndex > 0) {
      past = before;
      pendingBefore = "";
    }
    return `      <p xml:id="${state.id}" begin="${ttmlTime(state.start)}" end="${ttmlTime(state.end)}" region="karaoke" style="paragraph" xml:space="preserve">${spanXml(past, "past")}${spanXml(pendingBefore, "base")}${spanXml(active, activeBox ? "activeBox" : "active")}${spanXml(after, "base")}</p>`;
  }).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xml:lang="pl" ttp:timeBase="media">\n  <head>\n    <styling>\n      <style xml:id="paragraph" tts:fontFamily="${font}" tts:fontSize="${fontSize}px" tts:lineHeight="${lineHeight}%" tts:textAlign="${align}" tts:color="${baseColor}" tts:backgroundColor="${sentenceBackground}"${textOutline}${textShadow}/>\n      <style xml:id="base" tts:color="${baseColor}"/>\n      <style xml:id="past" tts:color="${pastColor}"/>\n      <style xml:id="active" tts:color="${activeColor}" tts:fontWeight="${activeBold ? "bold" : "normal"}"/>\n      <style xml:id="activeBox" tts:color="${activeColor}" tts:fontWeight="${activeBold ? "bold" : "normal"}" tts:backgroundColor="${activeBackground}"/>\n    </styling>\n    <layout>\n      <region xml:id="karaoke" tts:origin="${originX.toFixed(2)}% ${originY.toFixed(2)}%" tts:extent="${width.toFixed(2)}% 24%" tts:displayAlign="after"/>\n    </layout>\n  </head>\n  <body><div>\n${paragraphs}\n  </div></body>\n</tt>\n`;
  return { xml, states };
}

function validateEntries(entries) {
  const issues = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.end <= entry.start) issues.push({ severity: "error", code: "duration", entryNumber: entry.number, message: "Nieprawidłowy czas wpisu." });
    let cursor = entry.start;
    for (const word of entry.words) {
      if (word.start < entry.start || word.end > entry.end || word.start < cursor || word.end < word.start) issues.push({ severity: "error", code: "word-time", entryNumber: entry.number, message: `Niemonotoniczny czas słowa „${word.text}”.` });
      cursor = word.end;
    }
    if (i > 0 && entry.start < entries[i - 1].end) issues.push({ severity: "warning", code: "overlap", entryNumber: entry.number, message: "Nakładanie wpisów SRT." });
  }
  return issues;
}

function createProjectDocument(entries, settings, source = {}) {
  return { schemaVersion: 1, app: "Premiere Karaoke UXP", savedAt: new Date().toISOString(), source, settings, entries };
}

function readProjectDocument(json) {
  const value = JSON.parse(json);
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.entries)) throw new Error("Nieobsługiwany plik .karaoke.json.");
  const issues = validateEntries(value.entries);
  if (issues.some((issue) => issue.severity === "error")) throw new Error(`Uszkodzone czasy w projekcie: ${issues[0].message}`);
  return { entries: value.entries, settings: value.settings || {}, source: value.source || {} };
}

const KaraokeCore = { TICKS_PER_SECOND, CHANNEL_STYLE_KEYS, BUILT_IN_CHANNEL_PRESETS, pickChannelStyle, channelPresetId, mergeChannelPresets, parseTimecode, formatTimecode, suggestTtmlFileName,stripSrtFormatting, normalizeWord, tokenizeWords, tokenizeWordSpans, stableEntryId, parseSrt, quickAlignEntry, quickAlignAll, clampMonotonicWords, updateWordTime, shiftEntry, secondsToTicks, createActiveWordKeyframes, createGraphicStates, generateTtml, validateEntries, createProjectDocument, readProjectDocument };
if (typeof module !== "undefined") module.exports = KaraokeCore;
if (typeof window !== "undefined") window.KaraokeCore = KaraokeCore;
