const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../dist/core.js");

const SIMPLE = `1\n00:00:01,000 --> 00:00:04,000\nDzisiaj w Szczecinie będzie słonecznie.`;

test("parses a regular SRT and preserves Polish text", () => {
  const result = core.parseSrt(SIMPLE);
  assert.equal(result.issues.length, 0);
  assert.equal(result.entries[0].plainText, "Dzisiaj w Szczecinie będzie słonecznie.");
  assert.deepEqual(result.entries[0].words.map((word) => word.normalized), ["dzisiaj", "w", "szczecinie", "będzie", "słonecznie"]);
});

test("handles UTF-8 BOM, CRLF, multiline entries and formatting tags", () => {
  const source = "\uFEFF1\r\n00:00:00,000 --> 00:00:02,000\r\n<i>Zażółć gęślą</i>\r\njaźń.\r\n";
  const { entries, issues } = core.parseSrt(source);
  assert.equal(issues.length, 0);
  assert.equal(entries[0].text, "<i>Zażółć gęślą</i>\njaźń.");
  assert.equal(entries[0].plainText, "Zażółć gęślą\njaźń.");
  assert.equal(entries[0].words.length, 3);
});

test("reports malformed timecode", () => {
  const result = core.parseSrt("1\n00:61:00,000 --> 00:00:02,000\nBłąd");
  assert.equal(result.entries.length, 0);
  assert.equal(result.issues[0].severity, "error");
});

test("warns about overlapping entries", () => {
  const result = core.parseSrt(`${SIMPLE}\n\n2\n00:00:03,900 --> 00:00:05,000\nDrugi wpis.`);
  assert.ok(result.issues.some((issue) => issue.code === "overlap"));
});

test("quick alignment is weighted, monotonic and bounded", () => {
  const entry = core.quickAlignEntry(core.parseSrt(SIMPLE).entries[0], 0.08);
  assert.equal(entry.words[0].start, 1);
  assert.equal(entry.words.at(-1).end, 4);
  for (let index = 1; index < entry.words.length; index += 1) assert.ok(entry.words[index].start >= entry.words[index - 1].end);
  assert.ok(entry.words[2].end - entry.words[2].start > entry.words[1].end - entry.words[1].start);
});

test("punctuation is not a separate active word and offsets include punctuation", () => {
  const spans = core.tokenizeWordSpans("Halo, świecie!");
  assert.equal(spans.length, 2);
  assert.equal(spans[1].text, "świecie!");
  assert.equal(spans[1].endOffset, "Halo, świecie!".length);
});

test("creates HOLD Active Word keyframes", () => {
  const entry = core.quickAlignEntry(core.parseSrt(SIMPLE).entries[0]);
  const keyframes = core.createActiveWordKeyframes(entry);
  assert.equal(keyframes.length, 6);
  assert.deepEqual(keyframes.map((keyframe) => keyframe.value), [1, 2, 3, 4, 5, 0]);
  assert.ok(keyframes.every((keyframe) => keyframe.interpolation === "HOLD"));
});

test("TickTime conversion has no frame drift at 25 fps", () => {
  const frameTicks = BigInt(core.secondsToTicks(1 / 25));
  assert.equal(frameTicks * 25n, core.TICKS_PER_SECOND);
  assert.equal(BigInt(core.secondsToTicks(10)), core.TICKS_PER_SECOND * 10n);
});

test("TTML filename follows the selected SRT filename", () => {
  assert.equal(core.suggestTtmlFileName("C:\\Napisy\\K_A-ANDRE_-_POWER BIESIADA.srt"), "K_A-ANDRE_-_POWER BIESIADA.xml");
  assert.equal(core.suggestTtmlFileName("piosenka.srt", "selected"), "piosenka_selected.xml");
});

test("project JSON round-trips", () => {
  const entries = [core.quickAlignEntry(core.parseSrt(SIMPLE).entries[0])];
  const encoded = JSON.stringify(core.createProjectDocument(entries, { font: "Arial" }, { srtPath: "a.srt" }));
  const decoded = core.readProjectDocument(encoded);
  assert.equal(decoded.entries[0].words[2].text, "Szczecinie");
  assert.equal(decoded.settings.font, "Arial");
});

test("graphic states are independent and touch without gaps or overlaps", () => {
  const entry = core.quickAlignEntry(core.parseSrt(SIMPLE).entries[0]);
  const states = core.createGraphicStates(entry, "midpoint");
  assert.equal(states.length, 5);
  assert.equal(states[0].start, entry.start);
  assert.equal(states.at(-1).end, entry.end);
  assert.equal(states.filter((state) => state.intro).length, 1);
  assert.equal(states.filter((state) => state.outro).length, 1);
  for (let index = 1; index < states.length; index += 1) assert.equal(states[index - 1].end, states[index].start);
});

test("TTML repeats the full sentence and styles only the active span", () => {
  const entry = core.quickAlignEntry(core.parseSrt(SIMPLE).entries[0]);
  const { xml, states } = core.generateTtml([entry], { activeColor: "#FFD400", baseColor: "#FFFFFF", font: "Arial" });
  assert.equal((xml.match(/<p /g) || []).length, states.length);
  assert.match(xml, /xml:id="active" tts:color="#FFD400"/);
  assert.match(xml, /<span xml:space="preserve" style="active">Szczecinie <\/span>/);
  assert.ok(!xml.includes("<span xml:space=\"preserve\" style=\"active\">. </span>"));
});

test("TTML preserves spaces around the highlighted word", () => {
  const source = "1\n00:00:01,000 --> 00:00:02,000\ndrogie panie\n";
  const entry = core.quickAlignEntry(core.parseSrt(source).entries[0]);
  const { xml } = core.generateTtml([entry], { usePastColor: true });
  assert.match(xml, /style="paragraph" xml:space="preserve"/);
  assert.match(xml, /<span xml:space="preserve" style="past">drogie <\/span><span xml:space="preserve" style="active">panie <\/span>/);
  assert.match(xml, /<span xml:space="preserve" style="active">drogie <\/span><span xml:space="preserve" style="base">panie <\/span>/);
  const spanClosings = xml.match(/ <\/span>/g) || [];
  assert.equal(spanClosings.length, (xml.match(/<span /g) || []).length);
});

test("TTML shows a neutral sentence before singing and keeps it after the last word", () => {
  const entry = core.quickAlignEntry(core.parseSrt(SIMPLE).entries[0]);
  const { xml, states } = core.generateTtml([entry], { displayLeadIn: 0.40, displayTail: 0.80, usePastColor: true });
  const intro = states[0];
  const outro = states.at(-1);
  assert.equal(intro.activeWordIndex, -1);
  assert.equal(intro.end, entry.words[0].start);
  assert.equal(outro.activeWordIndex, entry.words.length);
  assert.equal(outro.start, entry.words.at(-1).end);
  assert.equal(Number((entry.words[0].start - intro.start).toFixed(2)), 0.40);
  assert.equal(Number((outro.end - entry.words.at(-1).end).toFixed(2)), 0.80);
  const paragraphs = xml.match(/<p [^>]+>.*?<\/p>/g) || [];
  assert.ok(!paragraphs[0].includes('style="active"'));
  assert.match(paragraphs[0], /style="base">Dzisiaj w Szczecinie będzie słonecznie\. <\/span>/);
  assert.ok(!paragraphs.at(-1).includes('style="active"'));
  assert.match(paragraphs.at(-1), /style="past">Dzisiaj w Szczecinie będzie słonecznie\. <\/span>/);
});

test("overlapping captions are serialized so only one sentence is visible", () => {
  const source = "1\n00:00:01,000 --> 00:00:03,000\nJak go tańczyć?\n\n2\n00:00:02,400 --> 00:00:04,500\nProsta sprawa, ręka lewa.\n";
  const entries = core.parseSrt(source).entries.map((entry) => core.quickAlignEntry(entry));
  const { states } = core.generateTtml(entries, { displayLeadIn: 0.40, displayTail: 0.80, minHighlight: 0.12 });
  for (let index = 1; index < states.length; index += 1) {
    assert.ok(states[index - 1].end <= states[index].start, `${states[index - 1].id} nakłada się na ${states[index].id}`);
  }
  const firstSentenceStates = states.filter((state) => state.entryId === entries[0].id);
  const secondSentenceStates = states.filter((state) => state.entryId === entries[1].id);
  const activeStates = states.filter((state) => state.activeEndOffset > state.activeStartOffset);
  assert.equal(activeStates.length, entries[0].words.length + entries[1].words.length);
  for (const state of activeStates) assert.ok(state.end - state.start >= 0.1199, `${state.id} jest widoczny za krótko`);
  const firstActiveStates = firstSentenceStates.filter((state) => state.activeEndOffset > state.activeStartOffset);
  const secondActiveStates = secondSentenceStates.filter((state) => state.activeEndOffset > state.activeStartOffset);
  assert.ok(firstActiveStates.at(-1).end <= secondActiveStates[0].start);
});

test("display lead and tail are hard limits and may leave a blank gap", () => {
  const source = "1\n00:00:01,000 --> 00:00:02,000\nPierwszy wers.\n\n2\n00:00:04,000 --> 00:00:05,000\nNastępny wers.\n";
  const entries = core.parseSrt(source).entries.map((entry) => core.quickAlignEntry(entry));
  entries[0].end = 3.8;
  entries[1].start = 2.2;
  const { states } = core.generateTtml(entries, { displayLeadIn: 0.30, displayTail: 0.25, minHighlight: 0.12 });
  const firstStates = states.filter((state) => state.entryId === entries[0].id);
  const secondStates = states.filter((state) => state.entryId === entries[1].id);
  const expectedFirstEnd = entries[0].words.at(-1).end + 0.25;
  const expectedSecondStart = entries[1].words[0].start - 0.30;
  assert.equal(Number(firstStates.at(-1).end.toFixed(3)), Number(expectedFirstEnd.toFixed(3)));
  assert.equal(Number(secondStates[0].start.toFixed(3)), Number(expectedSecondStart.toFixed(3)));
  assert.ok(firstStates.at(-1).end < secondStates[0].start);
});

function lineTexts(paragraph) {
  // Tekst każdego wiersza dokładnie tak, jak zobaczy go Premiere (bez znaczników).
  return paragraph.replace(/^.*?>(?=<span|<br)/, "").replace(/<\/p>.*$/, "").split("<br/>")
    .map((line) => line.replace(/<[^>]+>/g, ""));
}

test("every state of a multiline entry has identical line text (no layout jump)", () => {
  const { entries } = core.parseSrt("1\n00:00:01,000 --> 00:00:03,000\nZażółć gęślą,\njaźń — 100%!");
  const { xml } = core.generateTtml(core.quickAlignAll(entries), {});
  const paragraphs = xml.split("\n").filter((line) => line.includes("<p "));
  assert.ok(paragraphs.length >= 4);
  const expected = JSON.stringify(lineTexts(paragraphs[0]));
  for (const paragraph of paragraphs) assert.equal(JSON.stringify(lineTexts(paragraph)), expected, paragraph);
  assert.doesNotMatch(xml, /<span[^>]*> <\/span>/);
});

test("Szlagier TV preset is built in and matches the panel defaults", () => {
  const preset = core.BUILT_IN_CHANNEL_PRESETS.find((candidate) => candidate.id === "szlagier-tv");
  assert.ok(preset);
  assert.equal(preset.name, "Szlagier TV");
  assert.equal(preset.settings.baseColor, "#ffffff");
  assert.equal(preset.settings.activeColor, "#ffd400");
  assert.equal(preset.settings.pastColor, "#8ed8ff");
  assert.equal(preset.settings.strokeWidth, 5);
  assert.equal(preset.settings.font, "Arial-BoldMT");
  for (const key of core.CHANNEL_STYLE_KEYS) assert.notEqual(preset.settings[key], undefined, key);
});

test("user channel presets keep only style keys and cannot replace built-ins", () => {
  const merged = core.mergeChannelPresets([
    { id: "szlagier-tv", name: "Podróbka", settings: { baseColor: "#000000" } },
    { id: core.channelPresetId("Polo TV"), name: "Polo TV", settings: { activeColor: "#ff0000", audioTrack: 2, paddingBefore: 3 } },
    null,
    "zepsuty"
  ]);
  assert.deepEqual(merged.map((preset) => preset.id), ["szlagier-tv", "music-xmas", "user-polo-tv"]);
  assert.equal(merged[0].settings.baseColor, "#ffffff");
  assert.deepEqual(merged[2].settings, { activeColor: "#ff0000" });
  assert.equal(core.channelPresetId("Łódź Śląsk TV"), "user-lodz-slask-tv");
  assert.equal(core.channelPresetId("!!!"), "");
});
test("Music Xmas preset: white text, red active word, beige sung words", () => {
  const preset = core.BUILT_IN_CHANNEL_PRESETS.find((candidate) => candidate.id === "music-xmas");
  assert.ok(preset);
  assert.equal(preset.name, "Music Xmas");
  assert.equal(preset.settings.baseColor, "#ffffff");
  assert.equal(preset.settings.activeColor, "#e31e24");
  assert.equal(preset.settings.pastColor, "#e8d5b0");
  for (const key of core.CHANNEL_STYLE_KEYS) assert.notEqual(preset.settings[key], undefined, key);
  const { xml } = core.generateTtml(core.quickAlignAll(core.parseSrt("1\n00:00:01,000 --> 00:00:03,000\nCicha noc").entries), preset.settings);
  assert.match(xml, /xml:id="active" tts:color="#E31E24"/);
  assert.match(xml, /xml:id="past" tts:color="#E8D5B0"/);
});
