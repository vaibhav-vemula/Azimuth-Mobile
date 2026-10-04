/* Hex grid used to turn a latitude/longitude into an Azimuth cell id. Must match src/mapping/hexGrid.ts exactly;
   a test compares the two. Works in the browser (window.AzimuthHex) and in Node (module.exports). */
(function (root) {
  var R = 6378137;
  var MAX_LAT = 85.0511;
  var DEFAULT_SIZE = 120;
  var rad = function (d) { return (d * Math.PI) / 180; };

  function project(lat, lon) {
    var la = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
    return { x: R * rad(lon), y: R * Math.log(Math.tan(Math.PI / 4 + rad(la) / 2)) };
  }

  function roundHex(qf, rf) {
    var sf = -qf - rf;
    var q = Math.round(qf), r = Math.round(rf), s = Math.round(sf);
    var dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
    if (dq > dr && dq > ds) q = -r - s;
    else if (dr > ds) r = -q - s;
    return { q: q === 0 ? 0 : q, r: r === 0 ? 0 : r };
  }

  function cellIdAt(lat, lon, size) {
    size = size || DEFAULT_SIZE;
    var p = project(lat, lon);
    var qf = ((Math.sqrt(3) / 3) * p.x - (1 / 3) * p.y) / size;
    var rf = ((2 / 3) * p.y) / size;
    var h = roundHex(qf, rf);
    return 'h' + size + ':' + h.q + ':' + h.r;
  }

  function cellCenter(id) {
    var m = /^h(\d+):(-?\d+):(-?\d+)$/.exec(id);
    if (!m) return null;
    var size = Number(m[1]), q = Number(m[2]), r = Number(m[3]);
    var x = size * Math.sqrt(3) * (q + r / 2);
    var y = size * 1.5 * r;
    return {
      latitudeDeg: (Math.atan(Math.exp(y / R)) * 2 - Math.PI / 2) * 180 / Math.PI,
      longitudeDeg: (x / R) * 180 / Math.PI
    };
  }

  /** Six corners of a cell as [lat, lon] pairs, for drawing. */
  function cellCorners(id) {
    var m = /^h(\d+):(-?\d+):(-?\d+)$/.exec(id);
    if (!m) return null;
    var size = Number(m[1]), q = Number(m[2]), r = Number(m[3]);
    var cx = size * Math.sqrt(3) * (q + r / 2), cy = size * 1.5 * r, out = [];
    for (var i = 0; i < 6; i++) {
      var a = ((60 * i - 30) * Math.PI) / 180;
      var x = cx + size * Math.cos(a), y = cy + size * Math.sin(a);
      out.push([(Math.atan(Math.exp(y / R)) * 2 - Math.PI / 2) * 180 / Math.PI, (x / R) * 180 / Math.PI]);
    }
    return out;
  }

  var api = { cellIdAt: cellIdAt, cellCenter: cellCenter, cellCorners: cellCorners, DEFAULT_SIZE: DEFAULT_SIZE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AzimuthHex = api;
})(typeof window !== 'undefined' ? window : globalThis);
