import threading
import unittest

from karaoke_sync.alignment import (
    AlignmentCancelled,
    align_entries,
    apply_display_bounds,
    map_aligned_words,
    quick_align_entry,
    resolve_display_overlaps,
)


ENTRY = {
    "id": "k-1-test",
    "number": 1,
    "start": 1.0,
    "end": 4.0,
    "text": "Dzisiaj w Szczecinie będzie słonecznie.",
    "plainText": "Dzisiaj w Szczecinie będzie słonecznie.",
}


class AlignmentTests(unittest.TestCase):
    def test_quick_alignment_is_monotonic(self):
        result = quick_align_entry(ENTRY)
        self.assertEqual(result["words"][0]["start"], 1.0)
        self.assertEqual(result["words"][-1]["end"], 4.0)
        for previous, current in zip(result["words"], result["words"][1:]):
            self.assertGreaterEqual(current["start"], previous["end"])

    def test_maps_model_words_to_original_spelling(self):
        candidates = [
            {"word": "dzisiaj", "start": 1.01, "end": 1.4, "score": 0.95},
            {"word": "w", "start": 1.41, "end": 1.5, "score": 0.9},
            {"word": "szczecinie", "start": 1.51, "end": 2.2, "score": 0.93},
            {"word": "będzie", "start": 2.21, "end": 2.7, "score": 0.91},
            {"word": "słonecznie", "start": 2.71, "end": 3.8, "score": 0.94},
        ]
        result = map_aligned_words(ENTRY, candidates)
        self.assertEqual(result["words"][2]["text"], "Szczecinie")
        self.assertEqual(result["words"][-1]["text"], "słonecznie.")
        self.assertEqual(result["status"], "aligned")

    def test_missing_candidate_is_low_confidence_but_bounded(self):
        result = map_aligned_words(ENTRY, [{"word": "dzisiaj", "start": 0.2, "end": 1.3, "score": 0.8}])
        self.assertEqual(result["status"], "low-confidence")
        self.assertGreaterEqual(result["words"][0]["start"], ENTRY["start"])
        self.assertLessEqual(result["words"][-1]["end"], ENTRY["end"])

    def test_exact_mapping_can_reach_into_padded_audio_window(self):
        candidates = [
            {"word": "dzisiaj", "start": 0.72, "end": 1.2, "score": 0.95},
            {"word": "w", "start": 1.21, "end": 1.3, "score": 0.95},
            {"word": "szczecinie", "start": 1.31, "end": 2.0, "score": 0.95},
            {"word": "będzie", "start": 2.01, "end": 2.5, "score": 0.95},
            {"word": "słonecznie", "start": 2.51, "end": 4.25, "score": 0.95},
        ]
        mapped = map_aligned_words(ENTRY, candidates, allowed_start=0.25, allowed_end=4.75)
        adjusted = apply_display_bounds(mapped, 0.20, 0.45)
        self.assertAlmostEqual(mapped["words"][0]["start"], 0.72)
        self.assertAlmostEqual(mapped["words"][-1]["end"], 4.25)
        self.assertAlmostEqual(adjusted["start"], 0.52)
        self.assertAlmostEqual(adjusted["end"], 4.70)

    def test_display_padding_does_not_overlap_next_caption(self):
        first = {**ENTRY, "start": 1.0, "end": 3.5, "words": [{"start": 1.1, "end": 3.3}], "warnings": []}
        second = {**ENTRY, "id": "second", "start": 3.2, "end": 5.0, "words": [{"start": 3.6, "end": 4.8}], "warnings": []}
        resolved = resolve_display_overlaps([first, second])
        self.assertAlmostEqual(resolved[0]["end"], 3.45)
        self.assertAlmostEqual(resolved[1]["start"], 3.45)

    def test_job_honors_cancellation(self):
        cancel = threading.Event()
        cancel.set()
        with self.assertRaises(AlignmentCancelled):
            align_entries({"mode": "quick", "entries": [ENTRY]}, cancel, lambda *_: None)


if __name__ == "__main__":
    unittest.main()
