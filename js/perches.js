/*
 * Turn a front-to-back list of window rectangles into "perches": the visible
 * parts of each window's top edge, which GRIT can stand on.
 * Shared by the Electron main process (real macOS windows) and the browser demo.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GritPerches = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function subtract(segs, a, b) {
    const out = [];
    for (const [s, e] of segs) {
      if (b <= s || a >= e) { out.push([s, e]); continue; }
      if (a > s) out.push([s, a]);
      if (b < e) out.push([b, e]);
    }
    return out;
  }

  /**
   * @param {Array<{id:any,pid?:number,x:number,y:number,w:number,h:number,alpha?:number}>} wins
   *        windows in global coordinates, ordered front (index 0) to back
   * @param {{ox:number,oy:number,width:number,height:number,minLen?:number,minY?:number,
   *          minWinW?:number,minWinH?:number,ignorePid?:number}} o  overlay rectangle + limits
   * @returns {Array<{wid:any,x1:number,x2:number,y:number,ox:number,oy:number}>} overlay-local perches
   */
  function computePerches(wins, o) {
    const minLen = o.minLen != null ? o.minLen : 70;
    const minY = o.minY != null ? o.minY : 0;
    const minW = o.minWinW != null ? o.minWinW : 120;
    const minH = o.minWinH != null ? o.minWinH : 60;
    const list = (wins || []).filter((w) => w && w.w > 0 && w.h > 0 &&
      (w.alpha == null || w.alpha > 0.05) && (o.ignorePid == null || w.pid !== o.ignorePid));
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      if (w.w < minW || w.h < minH) continue;            // tiny windows still occlude, but are not perches
      const y = w.y - o.oy;
      if (y < minY || y > o.height - 4) continue;
      const x1 = Math.max(0, w.x - o.ox), x2 = Math.min(o.width, w.x - o.ox + w.w);
      if (x2 - x1 < minLen) continue;
      let segs = [[x1, x2]];
      for (let j = 0; j < i && segs.length; j++) {
        const f = list[j], fy = f.y - o.oy;
        if (y < fy - 0.5 || y >= fy + f.h) continue;      // edge is outside this front window's vertical span
        segs = subtract(segs, f.x - o.ox, f.x - o.ox + f.w);
      }
      for (const [a, b] of segs) {
        if (b - a >= minLen) out.push({ wid: w.id, x1: a, x2: b, y, ox: w.x - o.ox, oy: w.y - o.oy });
      }
    }
    return out;
  }

  return { computePerches, subtract };
});
