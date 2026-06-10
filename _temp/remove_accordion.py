"""
Entfernt Accordion-Funktion aus der Tags-Liste im Editor-Tab
"""

with open(r"C:\_Daten\mapplus-exp\maps-dev\tnet\api\v1\slm.html", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Pfeil entfernen (Zeile 5620)
content = content.replace(
    "    html += '<span class=\"src-arrow\">▼</span>';",
    "    // html += '<span class=\"src-arrow\">▼</span>'; // Entfernt: Accordion macht keinen Sinn"
)

# 2. collapsed-Klasse entfernen (Zeile 5616)
content = content.replace(
    "    var collapsed = (q || groupHasActive) ? '' : ' collapsed';",
    "    // var collapsed = (q || groupHasActive) ? '' : ' collapsed'; // Entfernt: kein Accordion"
)

# 3. collapsed-Variable in HTML nicht mehr nutzen (Zeile 5619)
content = content.replace(
    "    html += '<div class=\"editor-tag-head' + collapsed + '\">';",
    "    html += '<div class=\"editor-tag-head\">'; // collapsed entfernt"
)

# 4. Klick-Event entfernen (Zeilen 5656-5659)
old_event = """  // Tag-Gruppen auf-/zuklappen
  listEl.querySelectorAll('.editor-tag-head').forEach(function(head) {
    head.addEventListener('click', function() { head.classList.toggle('collapsed'); });
  });"""

new_event = """  // Tag-Gruppen auf-/zuklappen — ENTFERNT: Accordion macht keinen Sinn
  // listEl.querySelectorAll('.editor-tag-head').forEach(function(head) {
  //   head.addEventListener('click', function() { head.classList.toggle('collapsed'); });
  // });"""

content = content.replace(old_event, new_event)

with open(r"C:\_Daten\mapplus-exp\maps-dev\tnet\api\v1\slm.html", "w", encoding="utf-8") as f:
    f.write(content)

print("✓ Accordion aus Tags-Liste entfernt")
