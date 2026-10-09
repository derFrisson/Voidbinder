// Better Auth's client keeps the fetch it found when the module loaded, so a per-test
// vi.stubGlobal would come too late. The global fetch delegates to whatever the test set.
let handler: typeof fetch = () => Promise.reject(new Error('no fake API in this test'));

export function setFetch(next: typeof fetch) {
  handler = next;
}

globalThis.fetch = (input, init) => handler(input, init);
