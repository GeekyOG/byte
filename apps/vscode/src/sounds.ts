/**
 * Byte's voice, made with the Web Audio API so there are no sound files to ship.
 * This is plain browser JavaScript, injected into the webview as a string.
 * Every sound takes (audioContext, startTime, volume) so it can also be
 * rendered offline (that's how the preview WAV files are made).
 */
export const SOUND_SCRIPT = /* js */ `
const ByteSounds = (() => {
  // One short note with a quick fade in and out, optionally sliding in pitch
  function note(a, out, t, freq, dur, opts) {
    opts = opts || {};
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = opts.type || "square";
    osc.frequency.setValueAtTime(freq, t);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur);
    if (opts.vibrato) {
      const lfo = a.createOscillator();
      const depth = a.createGain();
      lfo.frequency.value = opts.vibrato;
      depth.gain.value = freq * 0.06;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.02);
    }
    const peak = opts.gain == null ? 1 : opts.gain;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.012, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Master volume plus a gentle low-pass so square waves sound cute, not harsh
  function bus(a, vol) {
    const master = a.createGain();
    master.gain.value = vol;
    const soften = a.createBiquadFilter();
    soften.type = "lowpass";
    soften.frequency.value = 3200;
    master.connect(soften).connect(a.destination);
    return master;
  }

  return {
    // Classic robot "beep-boop"
    beep(a, t, vol) {
      const out = bus(a, vol * 0.5);
      note(a, out, t, 880, 0.09);
      note(a, out, t + 0.11, 587, 0.11);
    },
    // A single short chirp, for small things like clicks
    blip(a, t, vol) {
      const out = bus(a, vol * 0.35);
      note(a, out, t, 1046, 0.06, { type: "triangle", slideTo: 1318 });
    },
    // "Hehehehe": quick bouncy chirps that rise, wobble, then trail off
    giggle(a, t, vol) {
      const out = bus(a, vol * 0.55);
      const steps = [1180, 1420, 1250, 1500, 1300, 1560, 1200];
      steps.forEach((f, i) => {
        const at = t + i * 0.085 + (i % 2 ? 0.01 : 0);
        const len = i === steps.length - 1 ? 0.16 : 0.065;
        note(a, out, at, f, len, { type: "triangle", slideTo: f * (i % 2 ? 0.82 : 1.18), vibrato: 32, gain: 1 - i * 0.07 });
      });
      // a tiny squeak at the end
      note(a, out, t + steps.length * 0.085 + 0.05, 1900, 0.07, { type: "sine", slideTo: 2400, gain: 0.6 });
    },
    // Rising three-note chime when XP is earned
    xp(a, t, vol) {
      const out = bus(a, vol * 0.45);
      [784, 988, 1318].forEach((f, i) => note(a, out, t + i * 0.08, f, i === 2 ? 0.22 : 0.09, { type: "square" }));
    },
    // Sad falling "boo-oop" when something breaks
    sad(a, t, vol) {
      const out = bus(a, vol * 0.45);
      note(a, out, t, 523, 0.18, { type: "square", slideTo: 392 });
      note(a, out, t + 0.2, 392, 0.32, { type: "square", slideTo: 262, vibrato: 7 });
    },
    // Springy upward "boing" for jumps
    jump(a, t, vol) {
      const out = bus(a, vol * 0.4);
      note(a, out, t, 330, 0.2, { type: "square", slideTo: 990 });
    },
  };
})();
`;
