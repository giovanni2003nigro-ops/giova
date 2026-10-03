/** Öffnet das Coach-Overlay von überall (z. B. aus einer Kachel), optional mit einer Frage. */
export function openCoach(question?: string) {
  window.dispatchEvent(new CustomEvent('open-coach', { detail: question }));
}
