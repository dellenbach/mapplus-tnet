import re

content = open('maps/tnet/api/v1/tree-builder.html', encoding='utf-8').read()
scripts = re.findall(r'<script(?![^>]*src=)[^>]*>(.*?)</script>', content, re.DOTALL)
js = scripts[0]

# HTML-Startzeile des Script-Blocks bestimmen
script_start = content.find(scripts[0][:100])
html_line_of_script_start = content[:script_start].count('\n') + 1
print('Script beginnt bei HTML-Zeile:', html_line_of_script_start)

DQUOTE = chr(34)
SQUOTE = chr(39)
BTICK  = chr(96)

def strip_line(code):
    result = []
    i = 0
    while i < len(code):
        c = code[i]
        if c in (DQUOTE, SQUOTE, BTICK):
            q = c
            result.append(' ')
            i += 1
            while i < len(code):
                ch = code[i]
                if ch == chr(92):  # backslash
                    i += 2
                    result.append('  ')
                    continue
                if ch == q:
                    result.append(' ')
                    i += 1
                    break
                result.append(' ')
                i += 1
        else:
            result.append(c)
            i += 1
    return ''.join(result)

depth = 0
js_lines = js.split('\n')
for ln_idx, line in enumerate(js_lines):
    stripped = strip_line(line)
    # Remove single-line comments
    ci = stripped.find('//')
    if ci >= 0:
        stripped = stripped[:ci]
    for c in stripped:
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1

    if depth < 0:
        html_ln = html_line_of_script_start + ln_idx
        print(f'Erste negative Depth bei HTML-Zeile {html_ln} (JS-Zeile {ln_idx+1}): depth={depth}')
        print('  Content:', js_lines[ln_idx][:120])
        print('  Vorherige 15 Zeilen:')
        for i in range(max(0, ln_idx-15), ln_idx+1):
            print(f'    HTML {html_line_of_script_start + i}: {js_lines[i][:120]}')
        break
