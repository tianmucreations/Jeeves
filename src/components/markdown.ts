import { marked, type Token, type Tokens } from 'marked';

// Jeeves's answers arrive in Markdown (**bold**, ## headings, - lists). A terminal
// cannot show the marks as formatting, so they appeared as stray asterisks and
// hashes (reported 19 Sept). As Claude Code does (src/utils/markdown.ts), the
// answer is read with `marked` and drawn with the marks removed: bold as bold,
// headings bold, lists as "- " lines, inline code in its own colour. Here the
// result is plain text plus styled ranges, because Jeeves wraps and selects
// lines itself.

export interface StyleSpan {
  from: number;
  to: number;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export interface StyledText {
  text: string;
  spans: StyleSpan[];
}

type Style = Omit<StyleSpan, 'from' | 'to'>;

let configured = false;
function configure(): void {
  if (configured) return;
  configured = true;
  // As Claude Code: no strikethrough - "~100" means "about 100", not crossed out.
  marked.use({ tokenizer: { del: () => undefined } });
}

class Builder {
  text = '';
  spans: StyleSpan[] = [];

  add(value: string, style?: Style): void {
    if (!value) return;
    if (style && (style.bold || style.italic || style.code)) {
      this.spans.push({ from: this.text.length, to: this.text.length + value.length, ...style });
    }
    this.text += value;
  }

  newline(): void {
    this.text += '\n';
  }

  // One blank line between blocks, never more.
  endBlock(): void {
    if (!this.text) return;
    if (!this.text.endsWith('\n')) this.text += '\n';
    if (!this.text.endsWith('\n\n')) this.text += '\n';
  }
}

function inline(b: Builder, tokens: Token[] | undefined, style: Style = {}): void {
  for (const token of tokens ?? []) {
    switch (token.type) {
      case 'strong':
        inline(b, (token as Tokens.Strong).tokens, { ...style, bold: true });
        break;
      case 'em':
        inline(b, (token as Tokens.Em).tokens, { ...style, italic: true });
        break;
      case 'codespan':
        b.add((token as Tokens.Codespan).text, { ...style, code: true });
        break;
      case 'link': {
        const link = token as Tokens.Link;
        const start = b.text.length;
        inline(b, link.tokens, style);
        const shown = b.text.slice(start);
        // The address is shown too when the words don't already say it.
        if (link.href && shown !== link.href && !link.href.startsWith('mailto:')) b.add(` (${link.href})`, style);
        break;
      }
      case 'br':
        b.newline();
        break;
      case 'image':
        b.add((token as Tokens.Image).href, style);
        break;
      case 'text': {
        const text = token as Tokens.Text;
        if (text.tokens) inline(b, text.tokens, style);
        else b.add(decode(text.text), style);
        break;
      }
      default:
        b.add(decode((token as { text?: string; raw: string }).text ?? token.raw), style);
    }
  }
}

function block(b: Builder, token: Token, indent = ''): void {
  switch (token.type) {
    case 'space':
      break;
    case 'heading':
      b.endBlock();
      b.add(indent);
      inline(b, (token as Tokens.Heading).tokens, { bold: true });
      b.endBlock();
      break;
    case 'paragraph':
      b.add(indent);
      inline(b, (token as Tokens.Paragraph).tokens);
      b.endBlock();
      break;
    case 'list': {
      const list = token as Tokens.List;
      list.items.forEach((item, index) => {
        const marker = list.ordered ? `${Number(list.start || 1) + index}. ` : '- ';
        b.add(indent + marker);
        let first = true;
        for (const part of item.tokens) {
          if (part.type === 'list') {
            if (!b.text.endsWith('\n')) b.newline();
            block(b, part, indent + '  ');
            continue;
          }
          if (!first && !b.text.endsWith('\n')) b.newline();
          if (!first) b.add(indent + '  ');
          if (part.type === 'text' || part.type === 'paragraph') inline(b, (part as Tokens.Text).tokens ?? [part]);
          else inline(b, [part]);
          first = false;
        }
        if (!b.text.endsWith('\n')) b.newline();
      });
      b.endBlock();
      break;
    }
    case 'blockquote': {
      const inner = new Builder();
      for (const part of (token as Tokens.Blockquote).tokens) block(inner, part);
      for (const line of inner.text.replace(/\n+$/, '').split('\n')) {
        b.add(`${indent}│ `);
        b.add(line, { italic: true });
        b.newline();
      }
      b.endBlock();
      break;
    }
    case 'code':
      for (const line of (token as Tokens.Code).text.split('\n')) {
        b.add(indent + line, { code: true });
        b.newline();
      }
      b.endBlock();
      break;
    case 'hr':
      b.add(indent + '---');
      b.endBlock();
      break;
    case 'table': {
      const table = token as Tokens.Table;
      const cell = (c: Tokens.TableCell) => {
        const t = new Builder();
        inline(t, c.tokens);
        return t.text;
      };
      const rows = [table.header.map(cell), ...table.rows.map((row) => row.map(cell))];
      const widths = rows[0].map((_, i) => Math.max(3, ...rows.map((row) => (row[i] ?? '').length)));
      rows.forEach((row, r) => {
        const line = `| ${row.map((c, i) => c.padEnd(widths[i])).join(' | ')} |`;
        b.add(indent + line, r === 0 ? { bold: true } : undefined);
        b.newline();
        if (r === 0) {
          b.add(`${indent}|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`);
          b.newline();
        }
      });
      b.endBlock();
      break;
    }
    default:
      b.add(indent + decode((token as { text?: string; raw: string }).text ?? token.raw));
      b.endBlock();
  }
}

// marked keeps HTML escapes (&amp; &quot; &#39;) in its text; the screen wants the characters.
function decode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[name] ?? _);
}

export function renderMarkdown(source: string): StyledText {
  configure();
  const b = new Builder();
  try {
    for (const token of marked.lexer(source)) block(b, token);
  } catch {
    // Anything the reader can't follow is shown exactly as written.
    return { text: source, spans: [] };
  }
  const text = b.text.replace(/\n+$/, '');
  return { text, spans: b.spans.filter((span) => span.from < text.length).map((span) => ({ ...span, to: Math.min(span.to, text.length) })) };
}
