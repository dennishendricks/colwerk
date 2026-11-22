/**
 * Switches for the editor's checks, on by default. Cookies, since localStorage is tied to the port, which the
 * desktop app picks anew on every start (see zoom.ts).
 */
export function useLintSettings() {
  const cookie = (name: string) => useCookie<boolean>(name, { default: () => true, maxAge: 10 * 365 * 24 * 3600 })
  return { names: cookie('colwerk-lint-names'), writes: cookie('colwerk-lint-writes') }
}
