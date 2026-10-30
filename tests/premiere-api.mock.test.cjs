const test = require("node:test");
const assert = require("node:assert/strict");
const adapter = require("../packages/panel/dist/premiereAdapter.js");

function time(seconds) { return { seconds, ticks: String(Math.round(seconds * 254016000000)) }; }

test("inspects active sequence through only official methods", async () => {
  const calls = [];
  const sequence = {
    name: "Sekwencja testowa",
    getFrameSize: async () => ({ width: 1920, height: 1080 }),
    getSettings: async () => ({ getVideoFrameRate: () => ({ value: 25 }) }),
    getAudioTrackCount: async () => 2,
    getVideoTrackCount: async () => 5
  };
  const project = { getActiveSequence: async () => { calls.push("getActiveSequence"); return sequence; } };
  const ppro = { Project: { getActiveProject: async () => { calls.push("getActiveProject"); return project; } } };
  const info = await adapter.inspectActiveSequence(ppro);
  assert.equal(info.frameRate, 25);
  assert.equal(info.videoTrackCount, 5);
  assert.deepEqual(calls, ["getActiveProject", "getActiveSequence"]);
});

test("imports TTML with Project.importFiles", async () => {
  const root = { name: "Root" };
  let argumentsSeen;
  const project = {
    getRootItem: async () => root,
    importFiles: async (...args) => { argumentsSeen = args; return true; }
  };
  const castRoot = { name: "Root as ProjectItem" };
  const ppro = { Project: { getActiveProject: async () => project }, ProjectItem: { cast: (value) => value === root ? castRoot : null } };
  assert.equal(await adapter.importTtml(ppro, "C:\\tmp\\karaoke.ttml"), true);
  assert.deepEqual(argumentsSeen, [["C:\\tmp\\karaoke.ttml"], false, castRoot, false]);
});

test("matches upgraded clips by TickTime-derived state boundaries", async () => {
  const items = [
    { getStartTime: async () => time(1), getEndTime: async () => time(1.5) },
    { getStartTime: async () => time(1.5), getEndTime: async () => time(2.1) },
    { getStartTime: async () => time(9), getEndTime: async () => time(10) }
  ];
  const sequence = { getVideoTrack: async () => ({ getTrackItems: () => items }) };
  const ppro = { Constants: { TrackItemType: { CLIP: 1 } } };
  const states = [{ start: 1, end: 1.5 }, { start: 1.5, end: 2.1 }];
  const matched = await adapter.findItemsAtStates(ppro, sequence, 3, states);
  assert.equal(matched.length, 2);
});
