/*
 * Applies the stored theme before the first paint, so the page is never briefly
 * the wrong colour.
 *
 * This is an external file rather than an inline <script> because the
 * production CSP is `script-src 'self'`, which blocks inline scripts — an
 * inline version would silently do nothing in production while working fine in
 * dev, where the _headers file is not applied.
 *
 * It mirrors what @heroui/react's useTheme() does on mount, including reading
 * the same `heroui-theme` key and resolving the "system" intent. React mounts
 * too late to prevent the flash on its own.
 */
(function () {
  try {
    var stored = localStorage.getItem("heroui-theme");
    var theme =
      stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    var root = document.documentElement;
    root.classList.add(theme);
    root.setAttribute("data-theme", theme);
    root.style.colorScheme = theme;
  } catch (error) {
    document.documentElement.classList.add("light");
    document.documentElement.setAttribute("data-theme", "light");
  }
})();
