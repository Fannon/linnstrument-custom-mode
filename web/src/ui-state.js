export function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.value = String(value ?? "");
  }
}

export function getValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

export function setText(id, text) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
  }
}

export function fillSelect(selectEl, names, selected, options = {}) {
  if (!selectEl) {
    return;
  }

  const { includeEmpty = true, emptyLabel = "(none)" } = options;
  const normalizedSelected = typeof selected === "string" ? selected : "";
  const uniqueNames = Array.from(
    new Set(
      (Array.isArray(names) ? names : []).map((name) => String(name || "").trim()).filter((name) => name.length > 0),
    ),
  );
  selectEl.innerHTML = "";

  if (includeEmpty) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = emptyLabel;
    selectEl.appendChild(empty);
  }

  let hasSelected = false;
  uniqueNames.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    if (normalizedSelected === name) {
      option.selected = true;
      hasSelected = true;
    }
    selectEl.appendChild(option);
  });

  if (normalizedSelected && !hasSelected) {
    const unavailable = document.createElement("option");
    unavailable.value = normalizedSelected;
    unavailable.textContent = `${normalizedSelected} (unavailable)`;
    unavailable.selected = true;
    unavailable.dataset.unavailable = "true";
    selectEl.appendChild(unavailable);
  }
}
