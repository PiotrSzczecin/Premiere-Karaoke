/* TypeScript source for the prebuilt UXP runtime. Adobe's UXP DOM declarations are incomplete. */
// @ts-nocheck

const { entrypoints, storage } = require("uxp");
const ppro = require("premierepro");
const core = window.KaraokeCore;
const fs = storage.localFileSystem;
let helperCheckInFlight = false;

const mediaExtensions = new Set([
  "wav", "wave", "mp3", "mp2", "aac", "m4a", "flac", "ogg", "wma",
  "mpg", "mpeg", "mpe", "m2v", "mp4", "m4v", "mov", "mxf", "avi",
  "wmv", "m2t", "mts", "m2ts", "ts", "vob", "webm"
]);

const settingIds = [
  "paddingBefore", "paddingAfter", "displayLeadIn", "displayTail", "minWord", "minHighlight", "pauseMode", "font", "fontSize", "maxLines",
  "alignment", "baseColor", "activeColor", "pastColor", "strokeColor", "strokeWidth",
  "positionX", "positionY", "safeMargin", "textBoxWidth", "lineHeight", "highlightMode",
  "activeBackgroundColor", "backgroundColor", "usePastColor", "activeBold", "shadow", "background",
  "overlaySequenceName", "useOverlaySequence", "channelPreset"
];

const CHANNEL_PRESETS_KEY = "karaoke.channelPresets";
const LAST_CHANNEL_PRESET_KEY = "karaoke.lastChannelPreset";
const DEFAULT_CHANNEL_PRESET = "szlagier-tv";

const colorSettingIds = ["baseColor", "activeColor", "pastColor", "strokeColor", "activeBackgroundColor", "backgroundColor"];

const state = {
  entries: [],
  issues: [],
  srtPath: "",
  srtName: "",
  audioPath: "",
  eprPath: "",
  ttmlPath: "",
  ttmlEntry: null,
  ttmlProjectItem: null,
  states: [],
  activeProject: null,
  activeSequence: null,
  currentJob: null,
  selectedWord: null,
  initialized: false
};

const $ = (id) => document.getElementById(id);
const numberValue = (id, fallback = 0) => {
  const value = Number($(id).value);
  return Number.isFinite(value) ? value : fallback;
};

function log(message, level = "info") {
  const stamp = new Date().toLocaleTimeString("pl-PL");
  const target = $("log");
  target.textContent += `[${stamp}] ${level.toUpperCase()}: ${message}\n`;
  target.scrollTop = target.scrollHeight;
  if (level === "error") console.error(message); else console.log(message);
}

function showError(error, context = "Błąd") {
  const message = error instanceof Error ? error.message : String(error);
  log(`${context}: ${message}`, "error");
  $("syncMessage").textContent = `${context}: ${message}`;
}

function nativePath(file) {
  return file && (file.nativePath || file.nativePath === "") ? file.nativePath : "";
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

function suggestedTtmlFileName(srtNameOrPath, scope = "all") {
  if (typeof core.suggestTtmlFileName === "function") {
    return core.suggestTtmlFileName(srtNameOrPath, scope);
  }
  const fileName = String(srtNameOrPath || "karaoke.srt").split(/[\\/]/).pop() || "karaoke.srt";
  const stem = fileName.replace(/\.[^.]+$/, "") || "karaoke";
  return scope === "all" ? `${stem}.xml` : `${stem}_${scope}.xml`;
}

function refreshColorPreviews() {
  for (const id of colorSettingIds) {
    const input = $(id);
    const swatch = $(`${id}Swatch`);
    if (!input || !swatch) continue;
    const value = String(input.value || "").trim();
    const valid = /^#[0-9a-f]{6}$/i.test(value);
    swatch.style.backgroundColor = valid ? value : "transparent";
    input.style.borderColor = valid ? "#555" : "#c94b4b";
    input.title = valid ? value.toUpperCase() : "Wpisz kolor HEX, np. #FFD400";
  }
}

function collectSettings() {
  const settings = {};
  for (const id of settingIds) {
    const element = $(id);
    if (!element) continue;
    if (element.type === "checkbox") settings[id] = element.checked;
    else if (element.type === "number") settings[id] = Number(element.value);
    else settings[id] = element.value;
  }
  settings.targetVideoTrack = Number($("videoTrack").value || 0);
  settings.targetAudioTrack = Number($("audioTrack").value || 0);
  settings.mode = document.querySelector('input[name="mode"]:checked').value;
  return settings;
}

function applySettings(settings) {
  for (const id of settingIds) {
    const element = $(id);
    if (!element || settings[id] === undefined) continue;
    if (element.type === "checkbox") element.checked = Boolean(settings[id]);
    else element.value = String(settings[id]);
  }
  if (settings.mode) {
    const radio = document.querySelector(`input[name="mode"][value="${settings.mode}"]`);
    if (radio) radio.checked = true;
  }
  refreshColorPreviews();
}

function readStored(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch (_) { return fallback; }
}

function writeStored(key, value) {
  try { localStorage.setItem(key, value); }
  catch (error) { log(`Nie udało się zapisać ustawień panelu: ${error instanceof Error ? error.message : String(error)}`, "warning"); }
}

function readUserChannelPresets() {
  try { return JSON.parse(readStored(CHANNEL_PRESETS_KEY, "[]")); }
  catch (_) { return []; }
}

function allChannelPresets() {
  return core.mergeChannelPresets(readUserChannelPresets());
}

function renderChannelPresets(selectedId) {
  const presets = allChannelPresets();
  const select = $("channelPreset");
  select.innerHTML = presets.map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}${preset.builtIn ? " (wbudowany)" : ""}</option>`).join("");
  const chosen = presets.find((preset) => preset.id === selectedId) || presets[0];
  select.value = chosen.id;
  $("deleteChannelPreset").disabled = chosen.builtIn;
}

function applyChannelPreset(id) {
  const preset = allChannelPresets().find((candidate) => candidate.id === id);
  if (!preset) throw new Error("Nie znaleziono wybranego presetu kanału.");
  applySettings(preset.settings);
  renderChannelPresets(preset.id);
  writeStored(LAST_CHANNEL_PRESET_KEY, preset.id);
  log(`Zastosowano preset kanału: ${preset.name}.`);
}

function saveChannelPreset() {
  const name = String($("channelPresetName").value || "").trim();
  if (!name) throw new Error("Wpisz nazwę nowego presetu, np. nazwę kanału.");
  const id = core.channelPresetId(name);
  if (!id) throw new Error("Nazwa presetu musi zawierać litery lub cyfry.");
  if (core.BUILT_IN_CHANNEL_PRESETS.some((preset) => preset.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Preset „${name}” jest wbudowany i nie można go nadpisać. Wybierz inną nazwę.`);
  }
  const presets = readUserChannelPresets().filter((preset) => preset && preset.id !== id);
  presets.push({ id, name, settings: core.pickChannelStyle(collectSettings()) });
  writeStored(CHANNEL_PRESETS_KEY, JSON.stringify(presets));
  writeStored(LAST_CHANNEL_PRESET_KEY, id);
  renderChannelPresets(id);
  $("channelPresetName").value = "";
  log(`Zapisano preset kanału: ${name}.`);
}

function deleteChannelPreset() {
  const id = $("channelPreset").value;
  const preset = allChannelPresets().find((candidate) => candidate.id === id);
  if (!preset) return;
  if (preset.builtIn) throw new Error("Wbudowanego presetu nie można usunąć.");
  writeStored(CHANNEL_PRESETS_KEY, JSON.stringify(readUserChannelPresets().filter((candidate) => candidate && candidate.id !== id)));
  applyChannelPreset(DEFAULT_CHANNEL_PRESET);
  log(`Usunięto preset kanału: ${preset.name}.`);
}

function renderIssues() {
  $("issues").innerHTML = state.issues.map((issue) => `<div class="${issue.severity === "error" ? "issue-error" : ""}">${escapeHtml(issue.message)}</div>`).join("");
}

function renderEntries() {
  $("entryCount").textContent = `${state.entries.length} wpisów`;
  $("entryList").innerHTML = state.entries.map((entry, entryIndex) => {
    const low = entry.status === "low-confidence" || entry.words.some((word) => word.confidence !== null && word.confidence < 0.5);
    const words = entry.words.map((word, wordIndex) => {
      const active = state.selectedWord && state.selectedWord.entryIndex === entryIndex && state.selectedWord.wordIndex === wordIndex;
      const confidence = word.confidence === null ? "" : ` (${Math.round(word.confidence * 100)}%)`;
      return `<button class="word-chip${active ? " active" : ""}${word.confidence !== null && word.confidence < 0.5 ? " low" : ""}" data-action="word" data-entry="${entryIndex}" data-word="${wordIndex}" title="${word.start.toFixed(3)}–${word.end.toFixed(3)}${confidence}">${escapeHtml(word.text)}</button>`;
    }).join("");
    return `<article class="entry${low ? " low" : ""}" data-entry-id="${escapeHtml(entry.id)}">
      <div class="entry-head">
        <input type="checkbox" data-action="select" data-entry="${entryIndex}" ${entry.selected ? "checked" : ""}>
        <strong>#${entry.number}</strong><span class="status">${escapeHtml(entry.status)}</span>
        <span class="time">${core.formatTimecode(entry.start)} → ${core.formatTimecode(entry.end)}</span>
      </div>
      <div class="entry-text">${escapeHtml(entry.plainText)}</div>
      <div class="words">${words}</div>
      <div class="entry-actions">
        <button data-action="shift" data-delta="-0.1" data-entry="${entryIndex}">−0,1 s</button>
        <button data-action="shift" data-delta="0.1" data-entry="${entryIndex}">+0,1 s</button>
        <button data-action="reanalyze" data-entry="${entryIndex}">Analizuj ponownie</button>
        <button data-action="listen" data-entry="${entryIndex}">Odsłuch / głowica</button>
        <button data-action="preview" data-entry="${entryIndex}">Podgląd słów</button>
      </div>
      ${entry.warnings.length ? `<div class="hint">⚠ ${entry.warnings.map(escapeHtml).join(" · ")}</div>` : ""}
    </article>`;
  }).join("");
  renderWordEditor();
}

function renderWordEditor() {
  const target = $("wordEditor");
  if (!state.selectedWord) {
    target.className = "word-editor empty";
    target.textContent = "Kliknij słowo, aby ręcznie zmienić jego czas.";
    return;
  }
  const { entryIndex, wordIndex } = state.selectedWord;
  const entry = state.entries[entryIndex];
  const word = entry && entry.words[wordIndex];
  if (!word) { state.selectedWord = null; renderWordEditor(); return; }
  target.className = "word-editor";
  target.innerHTML = `<strong>${escapeHtml(word.text)}</strong><div class="grid">
    <label>Start (s)<input id="wordStart" type="number" step="0.001" value="${word.start.toFixed(3)}"></label>
    <label>Koniec (s)<input id="wordEnd" type="number" step="0.001" value="${word.end.toFixed(3)}"></label>
    <button id="applyWordTime">Zastosuj</button>
  </div><div class="hint">Pewność: ${word.confidence === null ? "brak (tryb szybki)" : `${Math.round(word.confidence * 100)}%`}</div>`;
  $("applyWordTime").addEventListener("click", () => {
    try {
      state.entries[entryIndex] = core.updateWordTime(entry, wordIndex, Number($("wordStart").value), Number($("wordEnd").value));
      renderEntries();
    } catch (error) { showError(error, "Korekta słowa"); }
  });
}

async function pickSrt() {
  const file = await fs.getFileForOpening({ types: ["srt"] });
  if (!file) return;
  const parsed = core.parseSrt(await file.read());
  state.entries = parsed.entries;
  state.issues = parsed.issues;
  state.srtPath = nativePath(file);
  state.srtName = file.name;
  $("srtPath").textContent = state.srtPath || file.name;
  renderIssues();
  renderEntries();
  log(`Wczytano ${state.entries.length} wpisów z ${file.name}.`);
}

function normalizedWindowsPath(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

async function findMediaItem(folder, nativeMediaPath) {
  const wanted = normalizedWindowsPath(nativeMediaPath);
  for (const item of await folder.getItems()) {
    if (item.type === ppro.ProjectItem.TYPE_BIN) {
      const nested = await findMediaItem(ppro.FolderItem.cast(item), nativeMediaPath);
      if (nested) return nested;
      continue;
    }
    try {
      const clip = ppro.ClipProjectItem.cast(item);
      if (normalizedWindowsPath(await clip.getMediaFilePath()) === wanted) return item;
    } catch (_) {}
  }
  return null;
}

async function importSelectedMedia(nativeMediaPath, displayName) {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("Brak aktywnego projektu Premiere.");
  const root = await project.getRootItem();
  if (await findMediaItem(root, nativeMediaPath)) {
    log(`Plik ${displayName} jest już w projekcie Premiere.`);
    return;
  }
  const imported = await project.importFiles([nativeMediaPath], false, ppro.ProjectItem.cast(root), false);
  if (!imported) throw new Error(`Premiere nie zaimportował pliku ${displayName}.`);
  log(`Zaimportowano audio/wideo do projektu Premiere: ${displayName}.`);
}

async function pickAudio() {
  // Brak filtra jest celowy: systemowy picker UXP potrafi ukrywać poprawne
  // kontenery MPEG-2, gdy host nie rozpoznaje któregoś rozszerzenia w `types`.
  const file = await fs.getFileForOpening();
  if (!file) return;
  const extension = String(file.name || "").split(".").pop().toLowerCase();
  if (!mediaExtensions.has(extension)) {
    throw new Error(`Nieobsługiwany plik .${extension || "?"}. Wybierz audio lub wideo, np. WAV, MP3, MPG/MPEG, M2V, MTS, M2TS, MP4, MOV albo MXF.`);
  }
  state.audioPath = nativePath(file);
  $("audioPath").textContent = state.audioPath || file.name;
  log(`Wybrano źródło audio: ${file.name}.`);
  try { await importSelectedMedia(state.audioPath, file.name); }
  catch (error) { log(`Nie udało się automatycznie zaimportować audio/wideo: ${error instanceof Error ? error.message : String(error)}`, "warning"); }
}

async function pickEpr() {
  const file = await fs.getFileForOpening({ types: ["epr"] });
  if (!file) return;
  state.eprPath = nativePath(file);
  $("eprPath").textContent = state.eprPath || file.name;
}

async function exportMix() {
  if (!state.eprPath) throw new Error("Najpierw wybierz preset PCM/WAV (.epr).");
  await refreshSequence();
  const output = await fs.getFileForSaving("karaoke_mix.wav", { types: ["wav"] });
  if (!output) return;
  const manager = ppro.EncoderManager.getManager();
  const ok = await manager.exportSequence(state.activeSequence, ppro.Constants.ExportType.IMMEDIATELY, nativePath(output), state.eprPath, true);
  if (!ok) throw new Error("Premiere nie rozpoczął eksportu miksu.");
  state.audioPath = nativePath(output);
  $("audioPath").textContent = state.audioPath;
  log("Eksport miksu został przekazany do Encoder Managera.");
}

async function refreshSequence() {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("Brak aktywnego projektu Premiere.");
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("Brak aktywnej sekwencji.");
  state.activeProject = project;
  state.activeSequence = sequence;
  const frame = await sequence.getFrameSize();
  const settings = await sequence.getSettings();
  const frameRate = settings.getVideoFrameRate();
  $("sequenceName").value = sequence.name;
  $("sequenceFormat").value = `${Math.round(frame.width)}×${Math.round(frame.height)} · ${Number(frameRate.value).toFixed(3)} fps`;
  const audioCount = await sequence.getAudioTrackCount();
  const videoCount = await sequence.getVideoTrackCount();
  $("audioTrack").innerHTML = Array.from({ length: audioCount }, (_, index) => `<option value="${index}">A${index + 1}</option>`).join("");
  const videoOptions = Array.from({ length: videoCount }, (_, index) => `<option value="${index}">V${index + 1}</option>`).join("");
  $("videoTrack").innerHTML = videoOptions;
  $("videoTrackMirror").innerHTML = videoOptions;
  const defaultVideo = Math.max(0, Math.min(videoCount - 1, 3));
  $("videoTrack").value = String(defaultVideo);
  $("videoTrackMirror").value = String(defaultVideo);
  log(`Aktywna sekwencja: ${sequence.name}.`);
}

async function checkHelper(manual = false) {
  if (helperCheckInFlight) return;
  helperCheckInFlight = true;
  try {
    const response = await fetch("http://127.0.0.1:8765/v1/health", { credentials: "omit" });
    if (!response.ok) throw new Error(String(response.status));
    const health = await response.json();
    $("serviceStatus").className = "badge ok";
    $("serviceStatus").textContent = health.exactAvailable ? "helper: exact ✓" : "helper: tylko quick";
    $("serviceStatus").title = `Połączono: 127.0.0.1:8765 · helper ${health.version || "?"}`;
    if (manual) $("syncMessage").textContent = `Helper online · wersja ${health.version || "?"} · tryb dokładny: ${health.exactAvailable ? "dostępny" : "niedostępny"}.`;
  } catch (error) {
    $("serviceStatus").className = "badge warn";
    $("serviceStatus").textContent = "helper: offline";
    $("serviceStatus").title = `Kliknij, aby sprawdzić ponownie. ${error instanceof Error ? error.message : String(error)}`;
    if (manual) showError(error, "Połączenie z helperem");
  } finally {
    helperCheckInFlight = false;
  }
}

function mergeAlignedEntries(resultEntries) {
  const byId = new Map(resultEntries.map((entry) => [entry.id, entry]));
  state.entries = state.entries.map((entry) => {
    const aligned = byId.get(entry.id);
    if (!aligned) return entry;
    return { ...entry, start: aligned.start, end: aligned.end, words: aligned.words, status: aligned.status, warnings: [...entry.warnings.filter((warning) => !warning.startsWith("Forced alignment")), ...(aligned.warnings || [])], dirty: true };
  });
  renderEntries();
}

async function startExactJob(entries) {
  if (!state.audioPath) throw new Error("Wybierz plik audio lub wyeksportuj miks WAV.");
  const response = await fetch("http://127.0.0.1:8765/v1/jobs", {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "exact",
      language: "pl",
      audioPath: state.audioPath,
      paddingBefore: numberValue("paddingBefore", 1.00),
      paddingAfter: numberValue("paddingAfter", 1.50),
      displayLeadIn: numberValue("displayLeadIn", 0.30),
      displayTail: numberValue("displayTail", 0.25),
      minimumWordDuration: numberValue("minWord", 0.08),
      entries
    })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Helper zwrócił HTTP ${response.status}.`);
  state.currentJob = body.jobId;
  $("cancelAnalysis").disabled = false;
  while (state.currentJob === body.jobId) {
    await new Promise((resolve) => setTimeout(resolve, 450));
    const poll = await fetch(`http://127.0.0.1:8765/v1/jobs/${body.jobId}`, { credentials: "omit" });
    const job = await poll.json();
    $("progress").value = Math.round((job.progress || 0) * 100);
    $("syncMessage").textContent = job.message || job.status;
    if (job.status === "completed") { state.currentJob = null; mergeAlignedEntries(job.result.entries); break; }
    if (job.status === "failed") { state.currentJob = null; throw new Error(job.error || "Forced alignment nie powiódł się."); }
    if (job.status === "cancelled") { state.currentJob = null; log("Analiza anulowana.", "warning"); break; }
  }
  $("cancelAnalysis").disabled = true;
}

async function analyze(entries = state.entries) {
  if (!entries.length) throw new Error("Najpierw wczytaj SRT.");
  $("progress").value = 0;
  const mode = document.querySelector('input[name="mode"]:checked').value;
  if (mode === "quick") {
    const ids = new Set(entries.map((entry) => entry.id));
    state.entries = state.entries.map((entry) => ids.has(entry.id) ? core.quickAlignEntry(entry, numberValue("minWord", 0.08)) : entry);
    $("progress").value = 100;
    $("syncMessage").textContent = "Gotowe. Tryb szybki jest przybliżony.";
    renderEntries();
    log("Wykonano szybki podział czasu słów.");
  } else {
    await startExactJob(entries);
    log("Zakończono lokalny forced alignment.");
  }
}

async function cancelAnalysis() {
  const jobId = state.currentJob;
  if (!jobId) return;
  state.currentJob = null;
  await fetch(`http://127.0.0.1:8765/v1/jobs/${jobId}`, { method: "DELETE", credentials: "omit" });
  $("cancelAnalysis").disabled = true;
  $("syncMessage").textContent = "Anulowanie…";
}

async function saveProject() {
  const file = await fs.getFileForSaving("projekt.karaoke.json", { types: ["json"] });
  if (!file) return;
  const documentValue = core.createProjectDocument(state.entries, collectSettings(), { srtPath: state.srtPath, srtName: state.srtName, audioPath: state.audioPath, ttmlPath: state.ttmlPath, states: state.states });
  await file.write(JSON.stringify(documentValue, null, 2));
  log(`Zapisano ${file.name}.`);
}

async function loadProject() {
  const file = await fs.getFileForOpening({ types: ["json"] });
  if (!file) return;
  const loaded = core.readProjectDocument(await file.read());
  state.entries = loaded.entries;
  state.srtPath = loaded.source.srtPath || "";
  state.srtName = loaded.source.srtName || state.srtPath.split(/[\\/]/).pop() || "";
  state.audioPath = loaded.source.audioPath || "";
  state.ttmlPath = loaded.source.ttmlPath || "";
  state.states = loaded.source.states || [];
  applySettings(loaded.settings);
  renderChannelPresets(loaded.settings.channelPreset);
  $("srtPath").textContent = state.srtPath || "Źródło zapisane w projekcie";
  $("audioPath").textContent = state.audioPath || "Nie wybrano audio";
  renderEntries();
  log(`Wczytano projekt ${file.name}.`);
  if (state.audioPath) {
    const mediaName = state.audioPath.split(/[\\/]/).pop() || "audio/wideo";
    try { await importSelectedMedia(state.audioPath, mediaName); }
    catch (error) { log(`Nie udało się automatycznie zaimportować audio/wideo z projektu karaoke: ${error instanceof Error ? error.message : String(error)}`, "warning"); }
  }
}

async function generateTtml(scope) {
  let entries = state.entries.filter((entry) => entry.status !== "unmatched" && entry.status !== "error");
  if (scope === "selected") entries = entries.filter((entry) => entry.selected);
  if (scope === "dirty") entries = entries.filter((entry) => entry.dirty);
  if (!entries.length) throw new Error("Brak zsynchronizowanych wpisów w wybranym zakresie.");
  const settings = collectSettings();
  const result = core.generateTtml(entries, settings, settings.pauseMode);
  const suggestedName = suggestedTtmlFileName(state.srtName || state.srtPath, scope);
  const file = await fs.getFileForSaving(suggestedName, { types: ["xml"] });
  if (!file) return;
  await file.write(result.xml);
  state.ttmlPath = nativePath(file);
  state.ttmlEntry = file;
  state.states = result.states;
  const generatedIds = new Set(entries.map((entry) => entry.id));
  state.entries = state.entries.map((entry) => generatedIds.has(entry.id) ? { ...entry, dirty: false } : entry);
  $("generateProgress").value = 100;
  renderEntries();
  log(`Wygenerowano ${result.states.length} niezależnych stanów w ${file.name}.`);
  if (settings.useOverlaySequence) await importTtml(true);
}

async function uniqueSequenceName(project, baseName) {
  const existingNames = new Set((await project.getSequences()).map((sequence) => sequence.name));
  if (!existingNames.has(baseName)) return baseName;
  let suffix = 2;
  while (existingNames.has(`${baseName}_${suffix}`)) suffix += 1;
  return `${baseName}_${suffix}`;
}

async function waitForImportedItem(root, previousIds, preferredName) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const items = await root.getItems();
    const fresh = items.filter((item) => !previousIds.has(item.getId()));
    const exact = fresh.find((item) => item.name === preferredName);
    if (exact) return exact;
    if (fresh.length === 1) return fresh[0];
    const existing = items.find((item) => item.name === preferredName);
    if (existing) return existing;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function createOverlaySequence(project, importedItem) {
  const sourceSequence = state.activeSequence || await project.getActiveSequence();
  const sourceSettings = sourceSequence ? await sourceSequence.getSettings() : null;
  const requestedName = String($("overlaySequenceName").value || "KARAOKE_OVERLAY").trim() || "KARAOKE_OVERLAY";
  const sequenceName = await uniqueSequenceName(project, requestedName);
  let sequence = null;

  try {
    const captionItem = ppro.ClipProjectItem.cast(importedItem);
    sequence = await project.createSequenceFromMedia(sequenceName, [captionItem]);
    if (!sequence) throw new Error("Premiere nie zwrócił sekwencji.");
    let captionTrackCount = 0;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      captionTrackCount = await sequence.getCaptionTrackCount();
      if (captionTrackCount > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (captionTrackCount === 0) throw new Error("Premiere utworzył sekwencję, ale nie wstawił ścieżki Caption.");
  } catch (error) {
    const createdSequences = await project.getSequences();
    const emptySequence = sequence || createdSequences.find((candidate) => candidate.name === sequenceName);
    if (emptySequence) {
      const removed = await project.deleteSequence(emptySequence);
      if (removed) log(`Usunięto pustą sekwencję ${sequenceName}.`, "warning");
    }
    throw new Error(`Automatyczne umieszczenie TTML nie jest obsługiwane przez ten host Premiere (${error instanceof Error ? error.message : String(error)}). TTML jest już w projekcie: utwórz sekwencję i przeciągnij go na timeline ręcznie.`);
  }

  if (sourceSettings) {
    const settingsCommitted = project.executeTransaction((compound) => {
      compound.addAction(sequence.createSetSettingsAction(sourceSettings));
    }, "Ustawienia sekwencji karaoke");
    if (!settingsCommitted) log("Nie udało się skopiować wszystkich ustawień sekwencji źródłowej.", "warning");
  }

  await project.openSequence(sequence);
  await project.setActiveSequence(sequence);
  state.activeSequence = sequence;
  log(`Utworzono i otwarto sekwencję ${sequenceName} ze ścieżką Caption.`);
  await refreshSequence();
  return sequence;
}

async function importTtml(createSequence = false) {
  if (!state.ttmlPath) throw new Error("Najpierw wygeneruj TTML.");
  const project = state.activeProject || await ppro.Project.getActiveProject();
  const root = await project.getRootItem();
  const previousIds = new Set((await root.getItems()).map((item) => item.getId()));
  const ok = await project.importFiles([state.ttmlPath], false, ppro.ProjectItem.cast(root), false);
  if (!ok) throw new Error("Premiere nie zaimportował pliku TTML.");
  const fileName = state.ttmlEntry?.name || state.ttmlPath.split(/[\\/]/).pop();
  const importedItem = await waitForImportedItem(root, previousIds, fileName);
  state.ttmlProjectItem = importedItem;
  log("TTML zaimportowany do projektu.");
  if (createSequence) {
    if (!importedItem) throw new Error("TTML został zaimportowany, ale Premiere nie udostępnił jego ProjectItem. Utwórz sekwencję i przeciągnij plik ręcznie.");
    await createOverlaySequence(project, importedItem);
  } else {
    log("Przeciągnij TTML na sekwencję albo włącz automatyczną sekwencję overlay.");
  }
}

async function matchingItems(statesToMatch) {
  await refreshSequence();
  const trackIndex = Number($("videoTrack").value || 0);
  const track = await state.activeSequence.getVideoTrack(trackIndex);
  const items = track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
  const result = [];
  for (const item of items) {
    const start = (await item.getStartTime()).seconds;
    const end = (await item.getEndTime()).seconds;
    if (statesToMatch.some((graphicState) => Math.abs(graphicState.start - start) < 0.003 && Math.abs(graphicState.end - end) < 0.003)) result.push(item);
  }
  return result;
}

function makeSelection(items) {
  let selection = null;
  ppro.TrackItemSelection.createEmptySelection((created) => { selection = created; });
  if (!selection) throw new Error("Premiere nie utworzył obiektu zaznaczenia.");
  for (const item of items) selection.addItem(item, true);
  return selection;
}

async function selectBoundaryClips(kind) {
  if (!state.states.length) throw new Error("Brak manifestu wygenerowanych stanów.");
  const wanted = state.states.filter((graphicState) => kind === "intro" ? graphicState.intro : graphicState.outro);
  const items = await matchingItems(wanted);
  if (!items.length) throw new Error("Nie znaleziono odpowiadających grafik na wybranej ścieżce.");
  state.activeSequence.setSelection(makeSelection(items));
  log(`Zaznaczono ${items.length} klipów ${kind}. Zastosuj preset Text Animator w Premiere.`);
}

async function removeGenerated() {
  if (!state.states.length) throw new Error("Brak manifestu stanów do bezpiecznego dopasowania.");
  const items = await matchingItems(state.states);
  if (!items.length) throw new Error("Nie znaleziono poprzednio wygenerowanych klipów na tej ścieżce.");
  const approved = typeof window.confirm === "function" ? window.confirm(`Usunąć ${items.length} klipów dopasowanych dokładnie po czasie?`) : false;
  if (!approved) { log("Usuwanie anulowane."); return; }
  const editor = ppro.SequenceEditor.getEditor(state.activeSequence);
  const selection = makeSelection(items);
  const ok = state.activeProject.executeTransaction((compound) => {
    compound.addAction(editor.createRemoveItemsAction(selection, false, ppro.Constants.MediaType.VIDEO, false));
  }, "Usuń grafiki karaoke");
  if (!ok) throw new Error("Transakcja usuwania nie została wykonana.");
  log(`Usunięto ${items.length} dopasowanych klipów karaoke.`);
}

async function verifyNative() {
  await refreshSequence();
  const captions = await state.activeSequence.getCaptionTrackCount();
  const matched = state.states.length ? (await matchingItems(state.states)).length : 0;
  const messages = [`Dopasowane klipy na V${Number($("videoTrack").value) + 1}: ${matched}/${state.states.length}.`, `Pozostałe ścieżki Caption: ${captions}.`];
  if (captions > 0) messages.push("Usuń tymczasową ścieżkę Caption przed zakończeniem.");
  messages.push("UXP nie udostępnia typu Graphic, dlatego edytowalność sprawdź przez panel Properties na jednym klipie.");
  log(messages.join(" "), captions > 0 ? "warning" : "info");
  $("syncMessage").textContent = messages.join(" ");
}

async function seekAndListen(entryIndex) {
  const entry = state.entries[entryIndex];
  await refreshSequence();
  await state.activeSequence.setPlayerPosition(ppro.TickTime.createWithSeconds(entry.start));
  if (!state.audioPath) { log("Ustawiono głowicę. Wybierz audio, aby spróbować odsłuchu w panelu."); return; }
  try {
    const audio = new Audio(`file:///${state.audioPath.replace(/\\/g, "/")}`);
    audio.currentTime = entry.start;
    await audio.play();
    setTimeout(() => audio.pause(), Math.max(50, (entry.end - entry.start) * 1000));
  } catch (_) {
    log("UXP nie udostępnił odtwarzania lokalnego pliku; głowica została ustawiona w Premiere.", "warning");
  }
}

function previewEntry(entryIndex) {
  const entry = state.entries[entryIndex];
  const started = performance.now();
  const duration = entry.end - entry.start;
  const tick = () => {
    const elapsed = (performance.now() - started) / 1000;
    if (elapsed > duration) { state.selectedWord = null; renderEntries(); return; }
    const absolute = entry.start + elapsed;
    const wordIndex = Math.max(0, entry.words.findIndex((word) => absolute >= word.start && absolute < word.end));
    state.selectedWord = { entryIndex, wordIndex };
    renderEntries();
    setTimeout(tick, 60);
  };
  tick();
}

function bind(id, event, handler) {
  $(id).addEventListener(event, (evt) => Promise.resolve().then(() => handler(evt)).catch((error) => showError(error, $(id).textContent || id)));
}

function init() {
  if (state.initialized) return;
  state.initialized = true;
  for (const id of colorSettingIds) {
    const input = $(id);
    if (input) input.addEventListener("input", refreshColorPreviews);
  }
  refreshColorPreviews();
  try { applyChannelPreset(readStored(LAST_CHANNEL_PRESET_KEY, DEFAULT_CHANNEL_PRESET)); }
  catch (_) { applyChannelPreset(DEFAULT_CHANNEL_PRESET); }
  bind("channelPreset", "change", () => applyChannelPreset($("channelPreset").value));
  bind("applyChannelPreset", "click", () => applyChannelPreset($("channelPreset").value));
  bind("saveChannelPreset", "click", saveChannelPreset);
  bind("deleteChannelPreset", "click", deleteChannelPreset);
  bind("pickSrt", "click", pickSrt);
  bind("pickAudio", "click", pickAudio);
  bind("pickEpr", "click", pickEpr);
  bind("exportMix", "click", exportMix);
  bind("refreshSequence", "click", refreshSequence);
  bind("analyze", "click", () => analyze());
  bind("cancelAnalysis", "click", cancelAnalysis);
  bind("saveProject", "click", saveProject);
  bind("loadProject", "click", loadProject);
  bind("generateAll", "click", () => generateTtml("all"));
  bind("generateSelected", "click", () => generateTtml("selected"));
  bind("generateDirty", "click", () => generateTtml("dirty"));
  bind("importTtml", "click", () => importTtml(false));
  bind("selectIntroClips", "click", () => selectBoundaryClips("intro"));
  bind("selectOutroClips", "click", () => selectBoundaryClips("outro"));
  bind("removeGenerated", "click", removeGenerated);
  bind("verifyNative", "click", verifyNative);
  bind("clearLog", "click", () => { $("log").textContent = ""; });
  $("videoTrack").addEventListener("change", () => { $("videoTrackMirror").value = $("videoTrack").value; });
  $("videoTrackMirror").addEventListener("change", () => { $("videoTrack").value = $("videoTrackMirror").value; });
  $("entryList").addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const entryIndex = Number(target.dataset.entry);
    const action = target.dataset.action;
    if (action === "word") { state.selectedWord = { entryIndex, wordIndex: Number(target.dataset.word) }; renderEntries(); }
    if (action === "shift") { state.entries[entryIndex] = core.shiftEntry(state.entries[entryIndex], Number(target.dataset.delta)); renderEntries(); }
    if (action === "reanalyze") analyze([state.entries[entryIndex]]).catch((error) => showError(error, "Ponowna analiza"));
    if (action === "listen") seekAndListen(entryIndex).catch((error) => showError(error, "Odsłuch"));
    if (action === "preview") previewEntry(entryIndex);
  });
  $("entryList").addEventListener("change", (event) => {
    if (event.target.dataset.action === "select") state.entries[Number(event.target.dataset.entry)].selected = event.target.checked;
  });
  $("serviceStatus").addEventListener("click", () => checkHelper(true));
  checkHelper();
  setInterval(checkHelper, 3000);
  refreshSequence().catch((error) => log(`Sekwencja nie jest jeszcze dostępna: ${error.message}`, "warning"));
}

entrypoints.setup({
  panels: {
    karaokeCaptionsPanel: {
      create() { init(); },
      show() { checkHelper(); refreshSequence().catch(() => {}); }
    }
  }
});

init();
