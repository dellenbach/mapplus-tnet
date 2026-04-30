import re

content = open('maps/tnet/api/v1/tree-builder.html', encoding='utf-8').read()
scripts = re.findall(r'<script(?![^>]*src=)[^>]*>(.*?)</script>', content, re.DOTALL)
js = scripts[0]  # Grosser erster Script-Block

def strip_strings_and_comments(code):
    result = []
    i = 0
    QUOTES = ('"', "'", '`')
    while i < len(code):
        c = code[i]
        # Single-line comment
        if c == '/' and i+1 < len(code) and code[i+1] == '/':
            while i < len(code) and code[i] != '\n':
                result.append(' ')
                i += 1
        # Multi-line comment
        elif c == '/' and i+1 < len(code) and code[i+1] == '*':
            result.append(' ')
            result.append(' ')
            i += 2
            while i+1 < len(code) and not (code[i] == '*' and code[i+1] == '/'):
                result.append(' ')
                i += 1
            result.append(' ')
            result.append(' ')
            i += 2
        elif c in QUOTES:
            quote = c
            result.append(' ')
            i += 1
            while i < len(code):
                ch = code[i]
                if ch == '\\':
                    result.append(' ')
                    result.append(' ')
                    i += 2
                    continue
                if ch == quote:
                    result.append(' ')
                    i += 1
                    break
                result.append(' ')
                i += 1
        else:
            result.append(c)
            i += 1
    return ''.join(result)

stripped = strip_strings_and_comments(js)
opens = stripped.count('{')
closes = stripped.count('}')
p_opens = stripped.count('(')
p_closes = stripped.count(')')

print(f'Korrekte Brace-Analyse (ohne Strings):')
print(f'  {{  opens:  {opens}')
print(f'  }}  closes: {closes}')
print(f'  Differenz: {opens - closes}')
print(f'  (  opens:  {p_opens}')
print(f'  )  closes: {p_closes}')
print(f'  Differenz: {p_opens - p_closes}')

# Zeige wo die Unbalance ist
if opens != closes:
    print()
    print('Suche Unbalance-Position...')
    depth = 0
    lines = 0
    first_neg = -1
    first_neg_line = 0
    for i, c in enumerate(stripped):
        if c == '\n': lines += 1
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth < 0 and first_neg < 0:
                first_neg = i
                first_neg_line = lines
    if first_neg >= 0:
        print(f'  ERSTES negative Klammer-Depth bei JS-Zeile ~{first_neg_line}')
        # Zeige den Kontext - 500 Zeichen vor und nach
        ctx_start = max(0, first_neg - 500)
        ctx_end = min(len(js), first_neg + 100)
        ctx = js[ctx_start:ctx_end]
        # Zeige die letzten Funktionen davor
        print('  Kontext (Ende der vorherigen Funktion + Problem-}):') 
        print(repr(ctx[-300:]))
        # Zeige auch die Zeile genau
        js_lines = js.split('\n')
        if first_neg_line < len(js_lines):
            for ln in range(max(0, first_neg_line-5), min(len(js_lines), first_neg_line+3)):
                print(f'  JS-Zeile {ln+1}: {js_lines[ln][:120]}')
    else:
        print('  Mehr oeffnende als schliessende -> fehlendes } am Ende?')
        print('  Ende des JS-Blocks:')
        print(repr(js[-300:]))
