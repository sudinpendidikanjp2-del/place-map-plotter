(() => {
  class Evt { constructor() { this._l = {}; this._v = {}; }
    addListener(n, f) { (this._l[n] ??= []).push(f); return { remove: () => { this._l[n] = (this._l[n] || []).filter((x) => x !== f); } }; }
    trigger(n, ...a) { (this._l[n] || []).slice().forEach((f) => f(...a)); }
    get(k) { return this._v[k]; } set(k, v) { this._v[k] = v; } setValues(o) { Object.assign(this._v, o); } }
  class LatLng { constructor(a, b) { if (typeof a === "object") { this._a = a.lat; this._b = a.lng; } else { this._a = a; this._b = b; } } lat() { return this._a; } lng() { return this._b; } toJSON() { return { lat: this._a, lng: this._b }; } }
  class LatLngBounds { constructor(sw, ne) { this.w = sw?.lng; this.s = sw?.lat; this.e = ne?.lng; this.n = ne?.lat; }
    getNorthEast() { return new LatLng(this.n, this.e); } getSouthWest() { return new LatLng(this.s, this.w); }
    contains(p) { const lat = typeof p.lat === "function" ? p.lat() : p.lat; const lng = typeof p.lng === "function" ? p.lng() : p.lng; return lat >= this.s && lat <= this.n && lng >= this.w && lng <= this.e; } }
  class MapMock extends Evt {
    constructor(el, o = {}) { super(); this.el = el; this._v = { ...o }; const c = o.center || { lat: -2.5, lng: 118 }; this.c = { lat: c.lat, lng: c.lng }; this.z = o.zoom ?? 5; this.idleT = null;
      el.style.background = "linear-gradient(135deg,#d7e6f2,#e9efe3)"; el.style.position = "relative"; el.style.overflow = "hidden"; el.dataset.mockmap = "1"; (window.__maps = window.__maps || []).push(this); this.sched(); }
    sched() { clearTimeout(this.idleT); this.idleT = setTimeout(() => { this.layout(); this.trigger("bounds_changed"); this.trigger("idle"); }, 40); }
    span() { const w = this.el.clientWidth || 1000, h = this.el.clientHeight || 700; const k = 360 / (256 * 2 ** this.z); return { lng: w * k, lat: h * k * 0.8 }; }
    getBounds() { const s = this.span(); return new LatLngBounds({ lat: this.c.lat - s.lat / 2, lng: this.c.lng - s.lng / 2 }, { lat: this.c.lat + s.lat / 2, lng: this.c.lng + s.lng / 2 }); }
    getZoom() { return this.z; } setZoom(z) { this.z = z; this.sched(); } getCenter() { return new LatLng(this.c); } setCenter(c) { this.c = { lat: c.lat, lng: c.lng }; this.sched(); }
    panTo(c) { this.setCenter(c); } fitBounds(b) { const w = b.east - b.west, h = b.north - b.south; this.c = { lat: (b.north + b.south) / 2, lng: (b.east + b.west) / 2 }; this.z = Math.max(3, Math.min(17, Math.floor(Math.log2((360 * (this.el.clientWidth || 1000)) / (256 * Math.max(w, 0.0001) * 1.3))))); this.sched(); }
    setOptions(o) { Object.assign(this._v, o); } getDiv() { return this.el; } getMapTypeId() { return this._v.mapTypeId; } getHeading() { return 0; } getTilt() { return 0; } getProjection() { return null; }
    project(lat, lng) { const s = this.span(); const W = this.el.clientWidth || 1000, H = this.el.clientHeight || 700; return { x: ((lng - (this.c.lng - s.lng / 2)) / s.lng) * W, y: ((this.c.lat + s.lat / 2 - lat) / s.lat) * H }; }
    layout() { document.querySelectorAll("[data-mockmarker]").forEach((m) => m.__place && m.__place()); } }
  customElements.define("mock-marker", class extends HTMLElement { constructor() { super(); this._l = {}; this.addEventListener("click", () => this.dispatchEvent(new CustomEvent("gmp-click"))); }
    set map(m) { this._map = m; if (m) { this.style.position = "absolute"; this.dataset.mockmarker = "1"; this.style.transform = "translate(-50%,-50%)"; m.el.appendChild(this); this.__place = () => { const p = this._pos; if (!p) return; const pt = m.project(p.lat, p.lng); this.style.left = pt.x + "px"; this.style.top = pt.y + "px"; }; this.__place(); } else this.remove(); }
    get map() { return this._map; } set position(p) { this._pos = p && (typeof p.lat === "function" ? { lat: p.lat(), lng: p.lng() } : p); this.__place && this.__place(); } get position() { return this._pos; }
    set content(c) { this.replaceChildren(c); } get content() { return this.firstChild; } set zIndex(z) { this.style.zIndex = z; } set title(t) { this.setAttribute("title", t || ""); }
    set gmpClickable(v) {} addListener(n, f) { this.addEventListener(n === "gmp-click" ? "click" : n, f); return { remove: () => this.removeEventListener("click", f) }; } });
  class Shape extends Evt { constructor(o = {}) { super(); this.o = o; this.map = o.map; this.path = o.paths || []; window.__shapes = (window.__shapes || []).concat([this]); } setMap(m) { this.map = m; if (!m) window.__shapes = (window.__shapes || []).filter((x) => x !== this); } setCenter() {} setRadius(r) { this.r = r; } setPath(p) { this.path = p; } }
  const maps = { Map: MapMock, LatLng, LatLngBounds, Circle: Shape, Polygon: Shape, Polyline: Shape, MapsEventListener: Evt, marker: {}, ControlPosition: {}, TravelMode: { DRIVING: "DRIVING" },
    DirectionsService: class { route() { return Promise.reject({ code: "REQUEST_DENIED" }); } }, DirectionsRenderer: class extends Evt { setMap() {} setDirections() {} },
    event: { addListener: (o, n, f) => o.addListener(n, f), removeListener: (l) => l.remove(), clearInstanceListeners: () => {}, trigger: () => {} },
    AdvancedMarkerElement: class { constructor() { return document.createElement("mock-marker"); } }, PinElement: class {},
    importLibrary: async () => maps, version: "mock", Settings: { getInstance: () => ({}) } };
  maps.marker = { AdvancedMarkerElement: maps.AdvancedMarkerElement, PinElement: maps.PinElement };
  Object.defineProperty(window, "__map", { get() { return (window.__maps || []).filter((m) => m.el.isConnected).pop(); } });
  window.google = window.google || {};
  window.google.maps = Object.assign(window.google.maps || {}, maps);
})();
