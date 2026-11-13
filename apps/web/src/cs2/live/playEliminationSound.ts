export function playEliminationSound(): void {
  try {
    const AudioContextCtor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    const master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);

    const playNote = (frequency: number, start: number, duration: number): OscillatorNode => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.5, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain).connect(master);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.05);
      return oscillator;
    };

    playNote(329.63, ctx.currentTime, 0.14); // E4
    const lastNote = playNote(196, ctx.currentTime + 0.13, 0.35); // G3
    let closed = false;
    const closeOnce = () => {
      if (closed) return;
      closed = true;
      void ctx.close().catch(() => {});
    };
    lastNote.onended = closeOnce;
    setTimeout(closeOnce, 1000);
  } catch {
    /* audio unavailable (autoplay policy, unsupported browser) — silently skip */
  }
}
