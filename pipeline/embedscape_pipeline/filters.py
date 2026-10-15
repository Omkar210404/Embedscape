"""Vocabulary selection: walk GloVe rows in frequency order and keep the first N that pass every rule."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import numpy as np
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS

ALPHA = re.compile(r"^[a-z]+$")
MIN_LEN = 3

# Order matters: a word is counted under the first rule it fails.
RULES = ("not_alphabetic", "too_short", "stop_word", "blocklisted")


def load_blocklist(directory: Path) -> set[str]:
    """Single-token entries from every *.txt file in the blocklist folder.

    Multi-word phrases can never equal a GloVe token, so they are skipped.
    Lines starting with '#' are comments.
    """
    words: set[str] = set()
    for path in sorted(directory.glob("*.txt")):
        for line in path.read_text(encoding="utf-8").splitlines():
            entry = line.strip().lower()
            if entry and not entry.startswith("#") and " " not in entry:
                words.add(entry)
    return words


def is_blocked(word: str, blocklist: set[str]) -> bool:
    """Exact token match, plus simple plurals ("<entry>s", "<entry>es").

    No substring matching, so innocent words that merely contain a listed
    string are kept.
    """
    if word in blocklist:
        return True
    if word.endswith("es") and word[:-2] in blocklist:
        return True
    return word.endswith("s") and word[:-1] in blocklist


def rejection_reason(word: str, blocklist: set[str]) -> str | None:
    if not ALPHA.match(word):
        return "not_alphabetic"
    if len(word) < MIN_LEN:
        return "too_short"
    if word in ENGLISH_STOP_WORDS:
        return "stop_word"
    if is_blocked(word, blocklist):
        return "blocklisted"
    return None


@dataclass
class Selection:
    words: list[str]
    vectors: np.ndarray
    rows_examined: int
    removed: Counter = field(default_factory=Counter)


def select_vocab(rows: Iterable[tuple[str, np.ndarray]], n_words: int, blocklist: set[str]) -> Selection:
    words: list[str] = []
    vecs: list[np.ndarray] = []
    removed: Counter = Counter({rule: 0 for rule in RULES})
    examined = 0
    for word, vec in rows:
        examined += 1
        reason = rejection_reason(word, blocklist)
        if reason:
            removed[reason] += 1
            continue
        words.append(word)
        vecs.append(vec)
        if len(words) == n_words:
            break
    if len(words) < n_words:
        raise ValueError(f"only {len(words)} words passed the filters, wanted {n_words}")
    return Selection(words, np.stack(vecs).astype(np.float32), examined, removed)
