const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const required = [
  "packages/panel/manifest.json",
  "packages/panel/index.html",
  "packages/panel/styles.css",
  "packages/panel/dist/main.js",
  "packages/panel/dist/core.js",
  "packages/alignment-service/karaoke_sync/server.py",
  "examples/sample.srt"
];

for (const relative of required) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute) || fs.statSync(absolute).size === 0) throw new Error(`Brak wymaganego pliku: ${relative}`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, "packages/panel/manifest.json"), "utf8"));
if (manifest.host.app !== "premierepro" || manifest.host.minVersion !== "26.3.0") throw new Error("Nieprawidłowy target Premiere.");
const runtime = fs.readFileSync(path.join(root, "packages/panel/dist/main.js"), "utf8");
const panelHtml = fs.readFileSync(path.join(root, "packages/panel/index.html"), "utf8");
const panelStyles = fs.readFileSync(path.join(root, "packages/panel/styles.css"), "utf8");
const panelCore = fs.readFileSync(path.join(root, "packages/panel/dist/core.js"), "utf8");
const sharedCore = fs.readFileSync(path.join(root, "packages/shared/dist/core.js"), "utf8");
if (panelCore !== sharedCore) throw new Error("Panel zawiera nieaktualna kopie core.js. Skopiuj packages/shared/dist/core.js do packages/panel/dist/core.js.");
if (!panelCore.includes("suggestTtmlFileName")) throw new Error("Core panelu nie zawiera generatora nazwy TTML.");
if (!panelCore.includes("escapeXml(part.trim())} </span>")) throw new Error("Core panelu nie zachowuje spacji pomiedzy kolorowanymi slowami.");
if (!panelCore.includes("activeWordIndex: -1") || !panelCore.includes("activeWordIndex: entry.words.length")) throw new Error("Core panelu nie zawiera neutralnych stanow przed i po spiewie.");
if (!panelCore.includes("serializeGraphicStateGroups")) throw new Error("Core panelu nie zapobiega jednoczesnemu wyswietlaniu dwoch zdan.");
if (!runtime.includes("start: aligned.start, end: aligned.end")) throw new Error("Runtime panelu nie zachowuje rozszerzonego czasu wyswietlania z helpera.");
if (panelHtml.includes('type="color"')) throw new Error("Panel nadal uzywa nieobslugiwanych kontrolek input type=color.");
if (!panelHtml.includes("baseColorSwatch") || !runtime.includes("refreshColorPreviews")) throw new Error("Panel nie zawiera edytorow kolorow HEX z podgladem.");
if (panelStyles.includes("display: grid") || !panelStyles.includes(".grid { display: flex")) throw new Error("Panel uzywa CSS Grid, ktorego Premiere UXP nie renderuje poprawnie.");
if (!panelHtml.includes("v0.4.8")) throw new Error("Naglowek panelu nie pokazuje aktualnej wersji.");
if (!panelHtml.includes('id="minHighlight"') || !panelCore.includes("enforceMinimumActiveDurations")) throw new Error("Panel nie gwarantuje minimalnego czasu aktywnego koloru.");
if (!panelCore.includes("start: Math.max(0, firstWordStart - displayLeadIn)") || !panelCore.includes("end: lastWordEnd + displayTail")) throw new Error("Panel nie traktuje czasu przed i po jako twardych limitow.");
if (!runtime.includes("suggestTtmlFileName")) throw new Error("Runtime nie nadaje plikowi TTML nazwy źródłowego SRT.");
for (const mediaImportApi of ["getMediaFilePath", "Zaimportowano audio/wideo do projektu Premiere"]) {
  if (!runtime.includes(mediaImportApi)) throw new Error(`Runtime nie zawiera automatycznego importu mediów: ${mediaImportApi}`);
}
for (const requiredApi of ["createSequenceFromMedia", "createSetSettingsAction", "getCaptionTrackCount", "deleteSequence", "openSequence"]) {
  if (!runtime.includes(requiredApi)) throw new Error(`Runtime nie zawiera automatyzacji sekwencji: ${requiredApi}`);
}
for (const forbidden of ["insertMogrtFromPath", "importAEComps", "AfterFX"]) {
  if (runtime.includes(forbidden)) throw new Error(`Runtime zawiera zabroniony mechanizm: ${forbidden}`);
}
for (const presetId of ["channelPreset", "saveChannelPreset", "deleteChannelPreset", "applyChannelPreset"]) {
  if (!panelHtml.includes(`id="${presetId}"`)) throw new Error(`Brak kontrolki presetu kanalu: ${presetId}`);
}
if (!panelCore.includes("BUILT_IN_CHANNEL_PRESETS") || !panelCore.includes("Szlagier TV") || !panelCore.includes("Music Xmas")) throw new Error("Core panelu nie zawiera wbudowanego presetu Szlagier TV.");
if (!runtime.includes("applyChannelPreset")) throw new Error("Runtime nie obsluguje presetow kanalow.");
if (manifest.version !== "0.4.8") throw new Error("Manifest nie ma wersji 0.4.8.");
console.log("Prebuilt UXP distribution verified.");
