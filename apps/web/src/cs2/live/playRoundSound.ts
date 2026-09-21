export function playRoundSound(): void {
  try {
    const AudioContextCtor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.3);
    let closed = false;
    const closeOnce = () => {
      if (closed) return;
      closed = true;
      void ctx.close();
    };
    oscillator.onended = closeOnce;
    setTimeout(closeOnce, 1000);
  } catch {
    /* audio unavailable (autoplay policy, unsupported browser) — silently skip */
  }
}
