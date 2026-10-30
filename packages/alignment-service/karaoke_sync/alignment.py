from __future__ import annotations

import importlib.util
import math
import os
import re
import threading
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Callable, Iterable


FORMATTING_TAG = re.compile(r"</?(?:i|b|u|font)(?:\s[^>]*)?>", re.IGNORECASE)


class AlignmentCancelled(RuntimeError):
    pass


class ExactAlignmentUnavailable(RuntimeError):
    pass


def strip_formatting(text: str) -> str:
    return FORMATTING_TAG.sub("", text)


def normalize_word(value: str) -> str:
    return "".join(character.lower() for character in strip_formatting(value) if character.isalnum())


def tokenize(text: str) -> list[dict[str, Any]]:
    words: list[dict[str, Any]] = []
    for token in re.findall(r"\S+", strip_formatting(text), flags=re.UNICODE):
        normalized = normalize_word(token)
        if normalized:
            words.append({"index": len(words), "text": token, "normalized": normalized})
    return words


def quick_align_entry(entry: dict[str, Any], minimum_word_duration: float = 0.08) -> dict[str, Any]:
    start = float(entry["start"])
    end = float(entry["end"])
    tokens = tokenize(entry.get("plainText") or entry["text"])
    duration = end - start
    if duration <= 0 or not tokens:
        raise ValueError("Wpis ma nieprawidłowy czas albo nie zawiera słów.")
    feasible_minimum = min(max(0.0, minimum_word_duration), duration / len(tokens))
    remaining = max(0.0, duration - feasible_minimum * len(tokens))
    weights = [max(1, len(token["normalized"])) ** 0.72 for token in tokens]
    total_weight = sum(weights)
    cursor = start
    words: list[dict[str, Any]] = []
    for index, token in enumerate(tokens):
        allocated = feasible_minimum + remaining * weights[index] / total_weight
        word_end = end if index == len(tokens) - 1 else min(end, cursor + allocated)
        words.append({**token, "start": cursor, "end": word_end, "confidence": None})
        cursor = word_end
    warnings = ["Tryb szybki — czasy są szacowane"]
    if minimum_word_duration * len(tokens) > duration:
        warnings.append("Wpis jest zbyt krótki dla wybranego minimum słowa")
    return {**entry, "words": words, "status": "quick", "warnings": warnings}


def _similarity(left: str, right: str) -> float:
    if left == right:
        return 1.0
    return SequenceMatcher(None, left, right).ratio()


def map_aligned_words(
    entry: dict[str, Any],
    aligned_words: Iterable[dict[str, Any]],
    minimum_word_duration: float = 0.04,
    allowed_start: float | None = None,
    allowed_end: float | None = None,
) -> dict[str, Any]:
    """Map model tokens back to original SRT tokens without changing displayed text."""
    originals = tokenize(entry.get("plainText") or entry["text"])
    candidates = [
        {
            "normalized": normalize_word(str(word.get("word", ""))),
            "start": word.get("start"),
            "end": word.get("end"),
            "confidence": word.get("score", word.get("confidence")),
        }
        for word in aligned_words
        if normalize_word(str(word.get("word", "")))
    ]
    mapped: list[dict[str, Any] | None] = []
    cursor = 0
    for original in originals:
        best_index = -1
        best_score = 0.0
        for candidate_index in range(cursor, min(len(candidates), cursor + 6)):
            score = _similarity(original["normalized"], candidates[candidate_index]["normalized"])
            if score > best_score:
                best_index, best_score = candidate_index, score
            if score == 1.0:
                break
        if best_index >= 0 and best_score >= 0.45:
            candidate = candidates[best_index]
            confidence = candidate["confidence"]
            mapped.append({
                **original,
                "start": candidate["start"],
                "end": candidate["end"],
                "confidence": float(confidence) if confidence is not None else best_score,
            })
            cursor = best_index + 1
        else:
            mapped.append(None)

    fallback = quick_align_entry(entry, minimum_word_duration)["words"]
    entry_start = float(entry["start"]) if allowed_start is None else float(allowed_start)
    entry_end = float(entry["end"]) if allowed_end is None else float(allowed_end)
    repaired: list[dict[str, Any]] = []
    previous_end = entry_start
    for index, original in enumerate(originals):
        value = mapped[index] or {**fallback[index], "confidence": 0.0}
        start_value = value.get("start")
        end_value = value.get("end")
        start = float(start_value) if start_value is not None and math.isfinite(float(start_value)) else fallback[index]["start"]
        end = float(end_value) if end_value is not None and math.isfinite(float(end_value)) else fallback[index]["end"]
        start = max(entry_start, previous_end, min(entry_end, start))
        end = max(start, min(entry_end, end))
        if end - start < minimum_word_duration and start + minimum_word_duration <= entry_end:
            end = start + minimum_word_duration
        if index == len(originals) - 1:
            end = min(entry_end, max(start, end))
        repaired.append({**original, "start": start, "end": end, "confidence": value.get("confidence")})
        previous_end = end

    confidences = [float(word["confidence"]) for word in repaired if word["confidence"] is not None]
    low = any(confidence < 0.5 for confidence in confidences) or any(value is None for value in mapped)
    warnings = ["Forced alignment: co najmniej jedno słowo ma niską pewność"] if low else []
    return {**entry, "words": repaired, "status": "low-confidence" if low else "aligned", "warnings": warnings}


def apply_display_bounds(entry: dict[str, Any], display_lead_in: float, display_tail: float) -> dict[str, Any]:
    if not entry.get("words"):
        return entry
    original_start = float(entry["start"])
    original_end = float(entry["end"])
    first_start = float(entry["words"][0]["start"])
    last_end = float(entry["words"][-1]["end"])
    return {
        **entry,
        "start": max(0.0, min(original_start, first_start - max(0.0, display_lead_in))),
        "end": max(original_end, last_end + max(0.0, display_tail)),
    }


@dataclass
class WhisperXAligner:
    device: str | None = None

    def __post_init__(self) -> None:
        self.device = self.device or os.environ.get("KARAOKE_DEVICE", "cpu")
        self._model: Any = None
        self._metadata: Any = None
        self._audio_path: str | None = None
        self._audio: Any = None
        self._lock = threading.Lock()

    @staticmethod
    def available() -> bool:
        return importlib.util.find_spec("whisperx") is not None

    def _ensure_model(self, language: str) -> None:
        if not self.available():
            raise ExactAlignmentUnavailable("WhisperX nie jest zainstalowany. Użyj trybu szybkiego albo zainstaluj pakiet [exact].")
        import whisperx  # type: ignore

        if self._model is None:
            self._model, self._metadata = whisperx.load_align_model(language_code=language, device=self.device)

    def _load_audio(self, path: str) -> Any:
        import whisperx  # type: ignore

        if self._audio_path != path:
            self._audio = whisperx.load_audio(path)
            self._audio_path = path
        return self._audio

    def align_entry(
        self,
        audio_path: str,
        entry: dict[str, Any],
        language: str,
        padding_before: float,
        padding_after: float,
        minimum_word_duration: float,
        display_lead_in: float,
        display_tail: float,
    ) -> dict[str, Any]:
        with self._lock:
            self._ensure_model(language)
            import whisperx  # type: ignore

            audio = self._load_audio(audio_path)
            segment = {
                "start": max(0.0, float(entry["start"]) - padding_before),
                "end": float(entry["end"]) + padding_after,
                "text": strip_formatting(entry.get("plainText") or entry["text"]),
            }
            result = whisperx.align(
                [segment],
                self._model,
                self._metadata,
                audio,
                self.device,
                return_char_alignments=False,
            )
            aligned = result.get("word_segments") or [word for item in result.get("segments", []) for word in item.get("words", [])]
            mapped = map_aligned_words(
                entry,
                aligned,
                minimum_word_duration,
                float(segment["start"]),
                float(segment["end"]),
            )
            return apply_display_bounds(mapped, display_lead_in, display_tail)


def resolve_display_overlaps(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Split overlapping display tails/leads at a stable midpoint."""
    for current, following in zip(entries, entries[1:]):
        if float(current["end"]) <= float(following["start"]):
            continue
        current_word_end = float(current["words"][-1]["end"]) if current.get("words") else float(current["end"])
        following_word_start = float(following["words"][0]["start"]) if following.get("words") else float(following["start"])
        boundary = (current_word_end + following_word_start) / 2.0
        boundary = max(float(current["start"]) + 0.001, min(float(following["end"]) - 0.001, boundary))
        current["end"] = boundary
        following["start"] = boundary
        warning = "Skorygowano zapas wyświetlania, aby sąsiednie napisy się nie nakładały"
        if warning not in current["warnings"]:
            current["warnings"].append(warning)
        if warning not in following["warnings"]:
            following["warnings"].append(warning)
    return entries


def align_entries(
    request: dict[str, Any],
    cancel_event: threading.Event,
    progress: Callable[[float, str], None],
    aligner: WhisperXAligner | None = None,
) -> dict[str, Any]:
    entries = request.get("entries") or []
    if not entries:
        raise ValueError("Brak wpisów do analizy.")
    mode = request.get("mode", "exact")
    minimum = float(request.get("minimumWordDuration", 0.08))
    results: list[dict[str, Any]] = []

    if mode == "exact":
        audio_path = str(request.get("audioPath", ""))
        if not audio_path or not Path(audio_path).is_file():
            raise ValueError("Plik audio nie istnieje lub nie został wskazany.")
        if Path(audio_path).suffix.lower() not in {
            ".wav", ".wave", ".mp3", ".mp2", ".aac", ".m4a", ".flac", ".ogg", ".wma",
            ".mpg", ".mpeg", ".mpe", ".m2v", ".mp4", ".m4v", ".mov", ".mxf", ".avi",
            ".wmv", ".m2t", ".mts", ".m2ts", ".ts", ".vob", ".webm",
        }:
            raise ValueError("Nieobsługiwany typ pliku audio/wideo.")
        aligner = aligner or WhisperXAligner()

    for index, entry in enumerate(entries):
        if cancel_event.is_set():
            raise AlignmentCancelled("Analiza została anulowana.")
        progress(index / len(entries), f"Wpis {index + 1}/{len(entries)}")
        if mode == "quick":
            result = quick_align_entry(entry, minimum)
        else:
            assert aligner is not None
            result = aligner.align_entry(
                str(request["audioPath"]),
                entry,
                str(request.get("language", "pl")),
                float(request.get("paddingBefore", 1.00)),
                float(request.get("paddingAfter", 1.50)),
                minimum,
                float(request.get("displayLeadIn", 0.20)),
                float(request.get("displayTail", 0.60)),
            )
        results.append(result)
    if mode == "exact":
        results = resolve_display_overlaps(results)
    progress(1.0, "Gotowe")
    return {"entries": results, "mode": mode}
