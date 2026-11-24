// SOLMAR FM — original WebAudio loops. No audio files, no network: three
// short chord loops (pad + bass + pluck) scheduled ahead, a jingle on
// switch-on, M mutes, R cycles the loop. Safe to construct anywhere;
// start() is a no-op where AudioContext is unavailable (never throws).
const NOTE = {
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, B5: 987.77,
  D6: 1174.66, F4s: 369.99, C4s: 277.18,
};

export const LOOPS = [
  {
    name: 'Boulevard Cruise', bpm: 100,
    chords: [
      ['C4', 'E4', 'G4', 'B4'], ['A3', 'C4', 'E4', 'G4'],
      ['F4', 'A4', 'C5', 'E5'], ['G3', 'B3', 'D4', 'F4'],
    ],
    bass: ['C3', 'A3', 'F3', 'G3'],
  },
  {
    name: 'Neon Nights', bpm: 112,
    chords: [
      ['A3', 'C4', 'E4'], ['F3', 'A3', 'C4'],
      ['C4', 'E4', 'G4'], ['G3', 'B3', 'D4'],
    ],
    bass: ['A3', 'F3', 'C3', 'G3'],
  },
  {
    name: 'Sunset Drive', bpm: 92,
    chords: [
      ['D4', 'F4s', 'A4'], ['B3', 'D4', 'F4s'],
      ['G3', 'B3', 'D4'], ['A3', 'C4s', 'E4'],
    ],
    bass: ['D3', 'B3', 'G3', 'A3'],
  },
];

const CHORD_DUR = 4; // seconds per chord: 4 chords = 16 s per cycle
const JINGLE = ['C5', 'E5', 'G5', 'B5', 'D6'];

export function createRadio() {
  const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
  const radio = {
    on: false, muted: false, loopIdx: 0, ctx: null, master: null, analyser: null,
    timer: null, nextChord: 0, chordIdx: 0, cycles: 0, scheduled: 0,
    start() {
      if (radio.on || !AC) return false;
      try {
        radio.ctx = new AC();
        radio.master = radio.ctx.createGain();
        radio.master.gain.value = radio.muted ? 0 : 0.22;
        radio.analyser = radio.ctx.createAnalyser();
        radio.analyser.fftSize = 256;
        radio.master.connect(radio.analyser);
        radio.analyser.connect(radio.ctx.destination);
        radio.on = true;
        // Jingle first, then loop 1 starts 1.2 s in.
        const t0 = radio.ctx.currentTime + 0.05;
        JINGLE.forEach((n, i) => radio.note(NOTE[n], t0 + i * 0.14, 0.5, 'triangle', 0.5));
        radio.nextChord = t0 + 1.2;
        radio.chordIdx = 0;
        radio.cycles = 0;
        radio.timer = setInterval(() => radio.tick(), 100);
        return true;
      } catch {
        radio.on = false;
        return false;
      }
    },
    note(freq, when, dur, type, vol) {
      if (!radio.ctx) return;
      const o = radio.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = radio.ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(vol, when + 0.05);
      g.gain.setValueAtTime(vol, when + Math.max(0.05, dur - 0.4));
      g.gain.linearRampToValueAtTime(0, when + dur);
      o.connect(g);
      g.connect(radio.master);
      o.start(when);
      o.stop(when + dur + 0.05);
      radio.scheduled += 1;
    },
    scheduleChord(idx, when) {
      const loop = LOOPS[radio.loopIdx];
      const chord = loop.chords[idx];
      for (const n of chord) radio.note(NOTE[n], when, CHORD_DUR + 0.8, 'triangle', 0.05);
      radio.note(NOTE[loop.bass[idx]], when, CHORD_DUR, 'sine', 0.16);
      // Pluck: the chord's notes as a short arpeggio across the chord.
      chord.forEach((n, i) => radio.note(NOTE[n], when + 0.4 + i * 0.7, 0.35, 'triangle', 0.12));
    },
    tick() {
      if (!radio.ctx) return;
      while (radio.nextChord < radio.ctx.currentTime + 0.35) {
        radio.scheduleChord(radio.chordIdx, radio.nextChord);
        radio.chordIdx = (radio.chordIdx + 1) % 4;
        radio.nextChord += CHORD_DUR;
        if (radio.chordIdx === 0) {
          radio.cycles += 1;
          if (radio.cycles >= 4) radio.cycleLoop();
        }
      }
    },
    cycleLoop() {
      radio.loopIdx = (radio.loopIdx + 1) % LOOPS.length;
      radio.cycles = 0;
    },
    setMuted(m) {
      radio.muted = !!m;
      if (radio.master && radio.ctx) radio.master.gain.setValueAtTime(radio.muted ? 0 : 0.22, radio.ctx.currentTime);
      return radio.muted;
    },
    toggleMute() {
      return radio.setMuted(!radio.muted);
    },
    level() {
      if (!radio.analyser) return 0;
      const data = new Uint8Array(radio.analyser.fftSize);
      radio.analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) { const d = (v - 128) / 128; sum += d * d; }
      return Math.sqrt(sum / data.length);
    },
    state() {
      return {
        on: radio.on, muted: radio.muted, loop: radio.loopIdx,
        loopName: LOOPS[radio.loopIdx].name,
        ctxState: radio.ctx ? radio.ctx.state : 'none',
        level: radio.level(), scheduled: radio.scheduled,
      };
    },
  };
  return radio;
}
