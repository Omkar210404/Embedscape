// Preset examples. Every claim in a `note` was checked on the shipped data, and
// tests/realData.test.ts fails if the data stops supporting it.

export interface AnalogyPreset {
  a: string;
  b: string;
  c: string;
  kind: "works" | "fails" | "bias";
  note: string;
}

export const ANALOGY_PRESETS: AnalogyPreset[] = [
  {
    a: "king", b: "man", c: "woman", kind: "works",
    note: "The famous example. It works here, but note that without excluding the inputs the closest word would be \"king\" itself.",
  },
  {
    a: "paris", b: "france", c: "japan", kind: "works",
    note: "Capital-of relations are well represented in news text, so these tend to work.",
  },
  {
    a: "actor", b: "man", c: "woman", kind: "works",
    note: "A clear grammatical gender pair, and the model gets it.",
  },
  {
    a: "better", b: "good", c: "bad", kind: "works",
    note: "Comparatives can work too. Without excluding the inputs, the closest word would be \"bad\".",
  },
  {
    a: "teacher", b: "school", c: "hospital", kind: "works",
    note: "A looser \"who works where\" relation that happens to land.",
  },
  {
    a: "brother", b: "man", c: "woman", kind: "fails",
    note: "You would expect \"sister\", but it only comes 9th. Family words all sit close together, so the arithmetic lands on the wrong one.",
  },
  {
    a: "bigger", b: "big", c: "small", kind: "fails",
    note: "Near miss: \"smaller\" is 2nd. \"larger\" wins because it is so close to \"bigger\" to begin with.",
  },
  {
    a: "doctor", b: "man", c: "woman", kind: "bias",
    note: "Learned bias. You might expect another doctor, but the results are about pregnancy, children and patients. The vectors absorbed how news text writes about women; this is not a fact about the world. (\"nurse\" is not in this 5,000-word vocabulary.)",
  },
];

export interface ComparePreset {
  a: string;
  b: string;
  note?: string;
}

export const COMPARE_PRESETS: ComparePreset[] = [
  { a: "cat", b: "dog" },
  { a: "ocean", b: "sea" },
  { a: "coffee", b: "tea" },
  {
    a: "good", b: "bad",
    note: "Opposites often score high: they are used in the same kinds of sentences. Similar here means \"used in similar contexts\", not \"means the same\".",
  },
  { a: "computer", b: "river" },
];

export const EXPLORE_SUGGESTIONS = ["ocean", "music", "coffee", "computer", "france", "king"];
