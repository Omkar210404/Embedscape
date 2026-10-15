# Blocklist

Words in these files are removed from the vocabulary before anything else happens, so they
never appear in the 3D scene, search, neighbours, compare or analogy results.

## Files

| File | Source | Licence |
|---|---|---|
| `ldnoobw-en.txt` | [List of Dirty, Naughty, Obscene, and Otherwise Bad Words](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words), English list, commit `5faf2ba42d7b1c0977169ec3611df25a3c08eb13`, unmodified | CC BY 4.0, © the LDNOOBW contributors |
| `supplement.txt` | Written for this project | MIT (same as the repo) |

## Categories removed

- Profanity and vulgar terms
- Sexual and sexually explicit terms
- Slurs: racial and ethnic, religious, homophobic, transphobic and ableist

## Matching rule

A GloVe token is removed if it exactly equals a single-word entry, or if it equals an entry plus
`s` or `es` (simple plurals). There is no substring matching, so innocent words that happen to
*contain* a listed string are kept. Multi-word phrases in the LDNOOBW list cannot match a single
GloVe token and are ignored.

## Judgement calls in `supplement.txt`

These were checked and left **out** on purpose, because their main use in news and Wikipedia text
(GloVe's training data) is neutral:

- `cracker`: a food
- `cripple`: also a verb (to cripple an economy)
- `queer`: reclaimed, and used in academic fields such as queer studies
- `gypsy`: the right word is still debated, and some Romani groups use it themselves
- `homo`: the scientific genus (Homo sapiens)

## Known gaps

No blocklist is complete. Offensive meaning often depends on context, which a word list cannot see.
Coded or new slurs and misspellings are not covered. Biased *associations* between harmless words
(for example gender and occupations) are a property of the vectors themselves and are not removed.
The site shows one of these on purpose (see the analogy presets).
