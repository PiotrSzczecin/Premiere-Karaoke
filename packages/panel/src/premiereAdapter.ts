import type { premierepro, Project, Sequence, VideoClipTrackItem } from "@adobe/premierepro";
import type { GraphicState } from "../../shared/src/core";

export interface SequenceInfo {
  project: Project;
  sequence: Sequence;
  name: string;
  width: number;
  height: number;
  frameRate: number;
  audioTrackCount: number;
  videoTrackCount: number;
}

export async function inspectActiveSequence(ppro: premierepro): Promise<SequenceInfo> {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("Brak aktywnego projektu Premiere.");
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("Brak aktywnej sekwencji.");
  const frame = await sequence.getFrameSize();
  const settings = await sequence.getSettings();
  const rate = settings.getVideoFrameRate();
  return {
    project,
    sequence,
    name: sequence.name,
    width: frame.width,
    height: frame.height,
    frameRate: rate.value,
    audioTrackCount: await sequence.getAudioTrackCount(),
    videoTrackCount: await sequence.getVideoTrackCount()
  };
}

export async function importTtml(ppro: premierepro, filePath: string): Promise<boolean> {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("Brak aktywnego projektu Premiere.");
  const root = await project.getRootItem();
  return project.importFiles([filePath], false, ppro.ProjectItem.cast(root), false);
}

export async function findItemsAtStates(
  ppro: premierepro,
  sequence: Sequence,
  videoTrackIndex: number,
  states: GraphicState[],
  tolerance = 0.003
): Promise<VideoClipTrackItem[]> {
  const track = await sequence.getVideoTrack(videoTrackIndex);
  const items = track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
  const matching: VideoClipTrackItem[] = [];
  for (const item of items) {
    const start = (await item.getStartTime()).seconds;
    const end = (await item.getEndTime()).seconds;
    if (states.some((state) => Math.abs(state.start - start) < tolerance && Math.abs(state.end - end) < tolerance)) matching.push(item);
  }
  return matching;
}
