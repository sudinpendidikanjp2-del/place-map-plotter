try {
  var t = localStorage.getItem("tema");
  if (t === "dark" || t === "light") document.documentElement.dataset.theme = t;
} catch (e) {}
