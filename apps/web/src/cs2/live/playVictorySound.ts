export function playVictorySound(): void {
  try {
    const AudioContextCtor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    const master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);

    const playChordNote = (frequency: number, start: number, duration: number, detune: number): void => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sawtooth";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = detune;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.3, start + Math.min(0.08, duration * 0.25));
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain).connect(master);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.05);
    };

    const t0 = ctx.currentTime;
    const chords: { start: number; duration: number; notes: number[] }[] = [
      { start: t0, duration: 0.3, notes: [261.63, 329.63, 392.0] }, // C E G (I)
      { start: t0 + 0.34, duration: 0.3, notes: [196.0, 246.94, 392.0] }, // G B G (V)
      { start: t0 + 0.68, duration: 1.3, notes: [261.63, 329.63, 392.0, 523.25] }, // C E G C (I, held)
    ];
    for (const { start, duration, notes } of chords) {
      for (const frequency of notes) {
        playChordNote(frequency, start, duration, -6);
        playChordNote(frequency, start, duration, 6);
      }
    }

    let closed = false;
    const closeOnce = () => {
      if (closed) return;
      closed = true;
      void ctx.close();
    };
    setTimeout(closeOnce, 2400);
  } catch {
    /* audio unavailable (autoplay policy, unsupported browser) — silently skip */
  }
}
