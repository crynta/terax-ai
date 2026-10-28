// Served by the smoke's local report server and loaded in an iframe, so it is a
// genuine foreign origin (http://127.0.0.1:<port>) with no CSP of its own: a
// stand-in for a preview frame showing someone else's page. It is handed a
// valid stream token on purpose, to prove the origin check refuses it before
// the token matters.
(async () => {
  parent.postMessage({ hello: true }, "*");
  const { url, body, attempts } = JSON.parse(decodeURIComponent(location.hash.slice(1)));
  const results = [];
  for (let index = 0; index < attempts; index++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        body: new Uint8Array(body),
        cache: "no-store",
        credentials: "omit",
      });
      results.push({ readable: true, status: response.status });
    } catch (error) {
      results.push({ readable: false, error: String(error) });
    }
  }
  parent.postMessage({ frame: results }, "*");
})();
