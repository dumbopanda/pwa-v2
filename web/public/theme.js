// Runs before first paint (blocking, same-origin: the CSP allows no inline script). Sets <html data-theme>.
(function () {
  var mq = matchMedia("(prefers-color-scheme: dark)");
  function pref() { try { var v = localStorage.getItem("sr-theme"); if (v === "light" || v === "dark") return v; } catch (e) {} return "system"; }
  function apply() {
    var t = pref(), d = t === "dark" || (t === "system" && mq.matches);
    document.documentElement.dataset.theme = d ? "dark" : "light";
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", d ? "#070B09" : "#F4F1EA");
  }
  apply();
  mq.addEventListener("change", apply);
  window.applyTheme = apply;
})();
