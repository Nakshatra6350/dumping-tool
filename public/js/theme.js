// Applied before first paint to avoid a flash of the wrong theme.
(function () {
  var theme = "dark";
  try {
    theme = localStorage.getItem("dt-theme") || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  } catch (e) {}
  document.documentElement.setAttribute("data-theme", theme);
})();
