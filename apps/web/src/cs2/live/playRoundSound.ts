export function playRoundSound(): void {
  try {
    const AudioContextCtor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    const master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);

    const playNote = (frequency: number, start: number, duration: number): OscillatorNode => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.6, start + Math.min(0.02, duration * 0.15));
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain).connect(master);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.05);
      return oscillator;
    };

    playNote(392, ctx.currentTime, 0.16); // G4
    const lastNote = playNote(659.25, ctx.currentTime + 0.14, 0.5); // E5

    let closed = false;
    const closeOnce = () => {
      if (closed) return;
      closed = true;
      void ctx.close();
    };
    lastNote.onended = closeOnce;
    setTimeout(closeOnce, 1200);
  } catch {
    /* audio unavailable (autoplay policy, unsupported browser) — silently skip */
  }
}
