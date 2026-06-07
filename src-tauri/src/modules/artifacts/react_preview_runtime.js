(() => {
const token = __TERAX_PREVIEW_TOKEN__;
function send(type, message) {
  if (!token) return;
  parent.postMessage({ source: "terax-artifact-preview", token, type, message: String(message || "") }, "*");
}
window.fetch = () => Promise.reject(new Error("Network access is disabled for artifact previews"));
window.XMLHttpRequest = undefined;
window.WebSocket = undefined;
window.EventSource = undefined;
const root = document.getElementById("terax-react-preview-root");
const Fragment = Symbol("terax.fragment");
let hooks = [];
let hookIndex = 0;
let effectCleanups = [];
let pendingEffects = [];
let scheduled = false;
function flatten(values) { return values.flat(Infinity).filter((value) => value !== false && value !== true && value !== null && value !== undefined); }
function h(type, props, ...children) { return { type, props: props || {}, children: flatten(children) }; }
const React = {
  createElement: h,
  Fragment,
  useState(initial) {
    const index = hookIndex++;
    if (hooks.length <= index) hooks[index] = typeof initial === "function" ? initial() : initial;
    const setState = (next) => {
      hooks[index] = typeof next === "function" ? next(hooks[index]) : next;
      scheduleRender();
    };
    return [hooks[index], setState];
  },
  useReducer(reducer, initialArg, init) {
    const [state, setState] = React.useState(() => init ? init(initialArg) : initialArg);
    return [state, (action) => setState((current) => reducer(current, action))];
  },
  useMemo(factory) { return factory(); },
  useCallback(callback) { return callback; },
  useRef(initial) { return { current: initial }; },
  useEffect(effect) { pendingEffects.push(effect); },
};
function toNode(value) {
  if (Array.isArray(value)) { const fragment = document.createDocumentFragment(); value.forEach((child) => fragment.appendChild(toNode(child))); return fragment; }
  if (value === null || value === undefined || value === false || value === true) return document.createTextNode("");
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return document.createTextNode(String(value));
  if (typeof value.type === "function") return toNode(value.type({ ...(value.props || {}), children: value.children }));
  if (value.type === Fragment) return toNode(value.children);
  const element = document.createElement(String(value.type));
  for (const [key, propValue] of Object.entries(value.props || {})) {
    if (key === "key" || propValue === false || propValue === null || propValue === undefined) continue;
    if (/^on[A-Z]/.test(key) && typeof propValue === "function") { element.addEventListener(key.slice(2).toLowerCase(), propValue); continue; }
    if (key === "className") { element.setAttribute("class", String(propValue)); continue; }
    if (key === "style" && propValue && typeof propValue === "object") { Object.assign(element.style, propValue); continue; }
    if (key === "dangerouslySetInnerHTML") continue;
    element.setAttribute(key, propValue === true ? "" : String(propValue));
  }
  value.children.forEach((child) => element.appendChild(toNode(child)));
  return element;
}
function runEffects() {
  const effects = pendingEffects;
  pendingEffects = [];
  for (const cleanup of effectCleanups) { try { cleanup?.(); } catch (error) { send("error", error?.message || error); } }
  effectCleanups = [];
  for (const effect of effects) { try { const cleanup = effect(); if (typeof cleanup === "function") effectCleanups.push(cleanup); } catch (error) { send("error", error?.message || error); } }
}
const Component = ((React, h, Fragment) => {
__TERAX_COMPONENT_MODULE__
})(React, h, Fragment);
function render() {
  try {
    hookIndex = 0;
    pendingEffects = [];
    root.replaceChildren(toNode(h(Component, null)));
    runEffects();
  } catch (error) {
    root.replaceChildren(document.createTextNode("React preview failed: " + (error?.message || error)));
    send("error", error?.message || error);
  }
}
function scheduleRender() { if (scheduled) return; scheduled = true; queueMicrotask(() => { scheduled = false; render(); }); }
window.addEventListener("error", (event) => send("error", event.message));
window.addEventListener("unhandledrejection", (event) => send("error", event.reason?.message || event.reason));
render();
})();
