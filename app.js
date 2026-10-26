/* PDF Merge — pdf-lib (Andrew Dillon, MIT) copies pages between documents, all in this browser tab. */
(function () {
  "use strict";
  var $ = S3.$, h = S3.h, PDFDocument = PDFLib.PDFDocument;
  var items = [], uid = 0, busy = false;

  // "1-3, 5, 8-" -> [0,1,2,4,7,…]; empty -> all pages. Descending ranges ("5-3") are kept in that order.
  function parseRange(str, n) {
    var s = String(str || "").trim(), out = [];
    if (!s) { for (var i = 0; i < n; i++) out.push(i); return out; }
    s.split(/[,;]+/).forEach(function (part) {
      part = part.trim(); if (!part) return;
      var m = /^(\d*)\s*[-–]\s*(\d*)$/.exec(part), a, b;
      if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : n; }
      else if (/^\d+$/.test(part)) a = b = +part;
      else throw new Error("“" + part + "” isn't a page or range");
      if (a < 1 || b < 1 || a > n || b > n) throw new Error("Page " + (a > n || a < 1 ? a : b) + " doesn't exist (this file has " + n + ")");
      for (var p = a; a <= b ? p <= b : p >= b; p += a <= b ? 1 : -1) out.push(p - 1);
    });
    if (!out.length) throw new Error("No pages selected");
    return out;
  }

  function loadPdf(bytes) {
    return PDFDocument.load(bytes, { updateMetadata: false }).catch(function (e) {
      throw new Error(/encrypted/i.test(e && e.message) ? "This PDF is password-protected or encrypted. Remove the protection first, then add it again." : "This file couldn't be read as a PDF.");
    });
  }

  function mergeDocs(list) { // list: [{doc, pages: [0-based]}]
    return PDFDocument.create().then(function (out) {
      return list.reduce(function (p, it) {
        return p.then(function () { return out.copyPages(it.doc, it.pages).then(function (pages) { pages.forEach(function (pg) { out.addPage(pg); }); }); });
      }, Promise.resolve()).then(function () {
        out.setProducer("S3eidat Tools PDF Merge"); out.setCreator("S3eidat Tools");
        return out.save();
      });
    });
  }

  // ---------- UI ----------
  function addFiles(files) {
    files.forEach(function (f) {
      var it = { id: ++uid, name: f.name, size: f.size, range: "", doc: null, pages: 0, error: "", loading: true };
      items.push(it);
      S3.readFile(f).then(loadPdf).then(function (doc) { it.doc = doc; it.pages = doc.getPageCount(); })
        .catch(function (e) { it.error = e.message; })
        .then(function () { it.loading = false; draw(); });
    });
    draw();
  }
  S3.drop($("#drop"), addFiles, { accept: ".pdf,application/pdf", multiple: true });

  function rangeInfo(it) {
    if (!it.doc) return { ok: false };
    try { var p = parseRange(it.range, it.pages); return { ok: true, n: p.length }; } catch (e) { return { ok: false, msg: e.message }; }
  }
  function move(from, to) { if (to < 0 || to >= items.length) return; items.splice(to, 0, items.splice(from, 1)[0]); draw(); }

  function draw() {
    var list = $("#list"); list.innerHTML = "";
    $("#listWrap").hidden = !items.length;
    $("#drop").classList.toggle("compact", !!items.length);
    $("#count").textContent = items.length ? items.length + " file" + (items.length > 1 ? "s" : "") : "";
    var total = 0, okFiles = 0;
    items.forEach(function (it, i) {
      var r = rangeInfo(it);
      if (r.ok) { total += r.n; okFiles++; }
      var meta = it.loading ? "Reading…" : it.error ? it.error : it.pages + " page" + (it.pages > 1 ? "s" : "") + " · " + S3.fmtBytes(it.size);
      var input = h("input", { "class": "input pm-range" + (it.doc && !r.ok ? " bad" : ""), placeholder: it.doc ? "All " + it.pages : "—", value: it.range, "aria-label": "Pages to include from " + it.name, disabled: !it.doc, spellcheck: "false", inputmode: "numeric" });
      input.addEventListener("input", function () { it.range = input.value; var rr = rangeInfo(it); input.classList.toggle("bad", !rr.ok); input.title = rr.msg || ""; li.querySelector(".pm-sel").textContent = rr.ok ? rr.n + " selected" : rr.msg || ""; updateTotal(); });
      var li = h("li", { "class": "pm-item" + (it.error ? " err" : ""), draggable: "true", "data-i": i }, [
        h("span", { "class": "pm-grip", "aria-hidden": "true", text: "⋮⋮" }),
        h("span", { "class": "pm-num", text: String(i + 1) }),
        h("div", { "class": "pm-info" }, [h("b", { "class": "pm-name-t", title: it.name, text: it.name }), h("span", { "class": it.error ? "pm-err" : "faint", text: meta })]),
        h("label", { "class": "field pm-pages" }, ["Pages", input, h("span", { "class": "faint pm-sel", text: it.doc ? (r.ok ? r.n + " selected" : r.msg) : "" })]),
        h("div", { "class": "pm-act" }, [
          h("button", { "class": "btn ghost icon small", "aria-label": "Move up", title: "Move up", disabled: i === 0, onclick: function () { move(i, i - 1); } }, ["↑"]),
          h("button", { "class": "btn ghost icon small", "aria-label": "Move down", title: "Move down", disabled: i === items.length - 1, onclick: function () { move(i, i + 1); } }, ["↓"]),
          h("button", { "class": "btn ghost icon small danger", "aria-label": "Remove " + it.name, title: "Remove", onclick: function () { items.splice(i, 1); draw(); } }, ["✕"])
        ])
      ]);
      list.appendChild(li);
    });
    updateTotal();
  }
  function updateTotal() {
    var total = 0, files = 0, bad = 0;
    items.forEach(function (it) { var r = rangeInfo(it); if (r.ok) { total += r.n; files++; } else if (it.doc) bad++; });
    $("#total").textContent = total + " page" + (total === 1 ? "" : "s") + " from " + files + " file" + (files === 1 ? "" : "s");
    $("#merge").disabled = busy || !total || bad > 0 || items.some(function (it) { return it.loading; });
  }

  // drag to reorder
  var dragFrom = -1;
  $("#list").addEventListener("dragstart", function (e) {
    var li = e.target.closest && e.target.closest(".pm-item"); if (!li) return;
    dragFrom = +li.dataset.i; li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", String(dragFrom)); } catch (x) { /* old browsers */ }
  });
  $("#list").addEventListener("dragover", function (e) {
    if (dragFrom < 0) return;
    e.preventDefault();
    var li = e.target.closest(".pm-item"); S3.$$(".pm-item", this).forEach(function (x) { x.classList.remove("over-top", "over-bot"); });
    if (!li) return;
    var r = li.getBoundingClientRect(); li.classList.add(e.clientY < r.top + r.height / 2 ? "over-top" : "over-bot");
  });
  $("#list").addEventListener("drop", function (e) {
    if (dragFrom < 0) return;
    e.preventDefault(); e.stopPropagation();
    var li = e.target.closest(".pm-item"); if (!li) return;
    var to = +li.dataset.i, r = li.getBoundingClientRect(), after = e.clientY >= r.top + r.height / 2;
    var dest = to + (after ? 1 : 0); if (dest > dragFrom) dest--;
    var from = dragFrom; dragFrom = -1; move(from, dest);
  });
  $("#list").addEventListener("dragend", function () { dragFrom = -1; S3.$$(".pm-item", this).forEach(function (x) { x.classList.remove("dragging", "over-top", "over-bot"); }); });

  $("#clear").addEventListener("click", function () { items = []; $("#result").textContent = ""; draw(); });
  $("#sortName").addEventListener("click", function () { items.sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); }); draw(); });

  $("#merge").addEventListener("click", function () {
    var list = [];
    try { items.forEach(function (it) { if (it.doc) list.push({ doc: it.doc, pages: parseRange(it.range, it.pages) }); }); }
    catch (e) { S3.toast(e.message, "error"); return; }
    if (!list.length) return;
    busy = true; var btn = $("#merge"), label = btn.innerHTML; btn.disabled = true; btn.textContent = "Merging…";
    var t0 = performance.now();
    mergeDocs(list).then(function (bytes) {
      var name = ($("#outName").value.trim() || "merged.pdf").replace(/[\\/:*?"<>|]+/g, "_");
      if (!/\.pdf$/i.test(name)) name += ".pdf";
      S3.download(new Blob([bytes], { type: "application/pdf" }), name);
      var pages = list.reduce(function (s, x) { return s + x.pages.length; }, 0);
      $("#result").textContent = "Done: " + pages + " pages, " + S3.fmtBytes(bytes.length) + ", in " + Math.max(0.1, (performance.now() - t0) / 1000).toFixed(1) + " s.";
      S3.done();
    }).catch(function (e) { S3.toast("Merge failed: " + (e && e.message ? e.message : e), "error"); })
      .then(function () { busy = false; btn.innerHTML = label; updateTotal(); });
  });

  // ---------- sample PDFs, generated here (no downloads) ----------
  function samplePdf(title, color, pages, size) {
    return PDFDocument.create().then(function (d) {
      return d.embedFont(PDFLib.StandardFonts.HelveticaBold).then(function (font) {
        for (var i = 1; i <= pages; i++) {
          var p = d.addPage(size || [595.28, 841.89]), W = p.getWidth(), H = p.getHeight();
          p.drawRectangle({ x: 0, y: H - 120, width: W, height: 120, color: color });
          p.drawText(title, { x: 40, y: H - 78, size: 34, font: font, color: PDFLib.rgb(1, 1, 1) });
          p.drawText("Page " + i + " of " + pages, { x: 40, y: H - 170, size: 18, font: font, color: PDFLib.rgb(0.2, 0.2, 0.25) });
        }
        return d.save();
      });
    });
  }
  window.S3_DEMO = function () {
    return Promise.all([
      samplePdf("Quarterly report", PDFLib.rgb(0.05, 0.62, 0.6), 4),
      samplePdf("Invoice #1042", PDFLib.rgb(0.4, 0.31, 0.78), 1),
      samplePdf("Site photos", PDFLib.rgb(0.89, 0.38, 0.29), 6, [841.89, 595.28])
    ]).then(function (bufs) {
      addFiles([new File([bufs[0]], "Quarterly report.pdf"), new File([bufs[1]], "Invoice 1042.pdf"), new File([bufs[2]], "Site photos.pdf")]);
      items[2].range = "1-3, 6";
      return new Promise(function (r) { setTimeout(r, 300); }).then(draw);
    });
  };

  // Self-test: two in-memory PDFs whose page widths mark each page, merged with ranges; plus an encrypted file.
  window.S3_SELFTEST = function () {
    function make(widths) { return PDFDocument.create().then(function (d) { widths.forEach(function (w) { d.addPage([w, 300]); }); return d.save({ useObjectStreams: false }); }); }
    var r1 = parseRange("1-3, 5, 8-", 9).join(), r2 = parseRange("", 3).join(), r3 = parseRange("3-1", 3).join(), badRange = false;
    try { parseRange("2-7", 5); } catch (e) { badRange = /7/.test(e.message); }
    return Promise.all([make([100, 200, 300]), make([400, 500])]).then(function (b) {
      var enc = Array.prototype.map.call(b[1], function (x) { return String.fromCharCode(x); }).join("").replace("trailer\n<<", "trailer\n<<\n/Encrypt << /Filter /Standard /V 1 /R 2 >>");
      var encBytes = Uint8Array.from(enc, function (c) { return c.charCodeAt(0); });
      return Promise.all([loadPdf(b[0]), loadPdf(b[1]), loadPdf(encBytes).then(function () { return "loaded"; }, function (e) { return e.message; })]);
    }).then(function (r) {
      return mergeDocs([{ doc: r[0], pages: parseRange("3,1", 3) }, { doc: r[1], pages: parseRange("", 2) }]).then(PDFDocument.load).then(function (out) {
        var w = out.getPages().map(function (p) { return Math.round(p.getWidth()); }).join();
        return w === "300,100,400,500" && /password-protected/.test(r[2]) && r1 === "0,1,2,4,7,8" && r2 === "0,1,2" && r3 === "2,1,0" && badRange;
      });
    });
  };
})();
