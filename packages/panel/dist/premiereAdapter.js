"use strict";

async function inspectActiveSequence(ppro) {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("Brak aktywnego projektu Premiere.");
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("Brak aktywnej sekwencji.");
  const frame = await sequence.getFrameSize();
  const settings = await sequence.getSettings();
  const rate = settings.getVideoFrameRate();
  return { project, sequence, name: sequence.name, width: frame.width, height: frame.height, frameRate: rate.value, audioTrackCount: await sequence.getAudioTrackCount(), videoTrackCount: await sequence.getVideoTrackCount() };
}

async function importTtml(ppro, filePath) {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("Brak aktywnego projektu Premiere.");
  const root = await project.getRootItem();
  return project.importFiles([filePath], false, ppro.ProjectItem.cast(root), false);
}

async function findItemsAtStates(ppro, sequence, videoTrackIndex, states, tolerance = 0.003) {
  const track = await sequence.getVideoTrack(videoTrackIndex);
  const items = track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
  const matching = [];
  for (const item of items) {
    const start = (await item.getStartTime()).seconds;
    const end = (await item.getEndTime()).seconds;
    if (states.some((state) => Math.abs(state.start - start) < tolerance && Math.abs(state.end - end) < tolerance)) matching.push(item);
  }
  return matching;
}

module.exports = { inspectActiveSequence, importTtml, findItemsAtStates };
