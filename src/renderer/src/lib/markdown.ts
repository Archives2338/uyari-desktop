// Puente markdown ⇄ HTML para el subset que produce el LLM y edita TipTap:
// headings (#/##/###), bullets (-), negrita (**), itálica (*), párrafos.
// Mantener content Y originalContent en markdown permite compararlos (indicador
// "editado") y Restaurar sin drift de formato. No aspira a un markdown completo:
// cubre exactamente lo que el prompt del resumen genera (ver backend prompts.ts).

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const inlineToHtml = (text: string): string =>
  escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')

/** Markdown (subset) → HTML para sembrar el editor TipTap. */
export function mdToHtml(md: string): string {
  const out: string[] = []
  let inList = false
  const closeList = (): void => {
    if (inList) {
      out.push('</ul>')
      inList = false
    }
  }
  for (const raw of md.split('\n')) {
    const line = raw.trim()
    if (!line) {
      closeList()
      continue
    }
    const head = /^(#{1,3})\s+(.*)$/.exec(line)
    if (head) {
      closeList()
      out.push(`<h${head[1].length}>${inlineToHtml(head[2])}</h${head[1].length}>`)
      continue
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(`<li>${inlineToHtml(bullet[1])}</li>`)
      continue
    }
    closeList()
    out.push(`<p>${inlineToHtml(line)}</p>`)
  }
  closeList()
  return out.join('')
}

/** Serializa el contenido inline de un nodo a markdown (**bold**, *italic*). */
function inlineToMd(node: Node): string {
  let s = ''
  node.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      s += n.textContent ?? ''
    } else if (n instanceof HTMLElement) {
      const t = n.tagName.toLowerCase()
      if (t === 'strong' || t === 'b') s += `**${inlineToMd(n)}**`
      else if (t === 'em' || t === 'i') s += `*${inlineToMd(n)}*`
      else if (t === 'br') s += '\n'
      else s += inlineToMd(n)
    }
  })
  return s
}

/** HTML de TipTap → Markdown (subset) para persistir un content homogéneo. */
export function htmlToMd(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const blocks: string[] = []
  doc.body.childNodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) {
      const txt = node.textContent?.trim()
      if (txt) blocks.push(txt)
      return
    }
    const t = node.tagName.toLowerCase()
    if (t === 'h1') blocks.push(`# ${inlineToMd(node)}`.trim())
    else if (t === 'h2') blocks.push(`## ${inlineToMd(node)}`.trim())
    else if (t === 'h3') blocks.push(`### ${inlineToMd(node)}`.trim())
    else if (t === 'ul' || t === 'ol') {
      const items: string[] = []
      node.querySelectorAll(':scope > li').forEach((li) => {
        const s = inlineToMd(li).trim()
        if (s) items.push(`- ${s}`)
      })
      if (items.length) blocks.push(items.join('\n'))
    } else {
      const s = inlineToMd(node).trim()
      if (s) blocks.push(s)
    }
  })
  return blocks.join('\n\n').trim()
}
