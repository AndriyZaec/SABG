const FLASH_MESSAGE = "New round!";
const FLASH_INTERVAL_MS = 1000;

let flashInterval: ReturnType<typeof setInterval> | undefined;
let originalTitle: string | undefined;

function onVisible(): void {
  if (!document.hidden) stopTabFlash();
}

export function startTabFlash(): void {
  if (flashInterval !== undefined) return;
  originalTitle = document.title;
  let showAlert = true;
  flashInterval = setInterval(() => {
    document.title = showAlert ? FLASH_MESSAGE : (originalTitle ?? "");
    showAlert = !showAlert;
  }, FLASH_INTERVAL_MS);
  document.addEventListener("visibilitychange", onVisible);
}

export function stopTabFlash(): void {
  if (flashInterval === undefined) return;
  clearInterval(flashInterval);
  flashInterval = undefined;
  if (originalTitle !== undefined) document.title = originalTitle;
  originalTitle = undefined;
  document.removeEventListener("visibilitychange", onVisible);
}
