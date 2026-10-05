// Applied before first paint to avoid a flash of the wrong theme.
(function () {
  var theme = "dark";
  try {
    theme =
      localStorage.getItem("dbrb-theme") ||
      (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  } catch {
    // Storage is blocked (some private modes): keep the default.
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
