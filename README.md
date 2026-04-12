# TonalityFinder

A browser-based MIDI key/scale analyzer designed for [Tritonet](https://tritonet.com) users. No installation, no server, no dependencies — everything runs locally in your browser.

## What it does

- Analyzes MIDI files to detect the root note and scale for each segment of a song
- Detects **modulations** (key/scale changes mid-song) with a configurable timeline view
- Injects **MIDI CC 85** (root, 0–11) and **CC 86** (scale index, 0–34) into the MIDI file so Tritonet can read the tonality in real-time
- Plays back MIDI using the Web Audio API with a live piano keyboard showing active notes
- Supports all **35 Ableton scales** (same naming and ordering as Ableton Live)

## Supported Scales

Major, Minor, Dorian, Mixolydian, Lydian, Phrygian, Locrian, Whole Tone, Half-Whole Tone, Whole-Half Tone, Minor Blues, Minor Pentatonic, Major Pentatonic, Harmonic Minor, Harmonic Major, Dorian #4, Phrygian Dominant, Melodic Minor, Lydian Augmented, Lydian Dominant, Super Locrian, 8-Tone Spanish, Bhairav, Hungarian Minor, Hirajoshi, IN-sen, Iwato, Kumoi, Pelog Selisir, Pelog Tembung, Messiaen 3–7.

## How to use

1. Open `index.html` in any modern browser (Chrome, Firefox, Safari, Edge)
2. Drop one or more `.mid` / `.midi` files onto the drop zone, or use the file/folder picker
3. The app detects the key and scale automatically
4. Adjust the **analysis weights** (pitch count, duration, velocity, beat position) to refine results
5. Use the **modulation timeline** to review key changes across the song
6. Hit **Download** to get the MIDI file with CC 85/86 injected at every modulation boundary

## Modulation detection

The app splits the MIDI file into overlapping analysis windows (2–16 bars, configurable) and votes on the best key for each window. A new segment is created only when **N consecutive windows** all agree on a different key — this prevents false positives from short ornamental passages.

**Sensitivity** controls how quickly a modulation is accepted:
| Sensitivity | Windows required |
|-------------|-----------------|
| 1 (stable)  | 3 consecutive  |
| 2           | 3 consecutive  |
| 3           | 2 consecutive  |
| 4           | 2 consecutive  |
| 5 (reactive)| 1 window       |

## CC encoding for Tritonet

| CC | Meaning | Values |
|----|---------|--------|
| CC 85 | Root note | 0 = C, 1 = C#, …, 11 = B |
| CC 86 | Scale index | 0 = Major, 1 = Minor, …, 34 = Messiaen 7 |

Drum tracks (MIDI channel 10) receive `CC 85 = 12` as a sentinel value and no CC 86.

When a song has multiple segments, CC 85+86 are inserted at the exact tick where each new key begins, so Tritonet updates in real-time during playback.

## Privacy

All processing happens in your browser. No MIDI data is ever uploaded or sent anywhere.

## License

MIT
