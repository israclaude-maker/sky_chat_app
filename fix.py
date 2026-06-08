content = open('static/js/chat.js', encoding='utf-8').read()
old = '    CallState.remoteSurfaceType = data.surface_type || "unknown";'
replacement = '    CallState.remoteSurfaceType = data.surface_type || "monitor";'
if old in content:
    content = content.replace(old, replacement, 1)
    open('static/js/chat.js', 'w', encoding='utf-8').write(content)
    print('Fixed')
else:
    print('Not found')
