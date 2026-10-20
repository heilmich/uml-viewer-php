/** Non-evaluating EDN reader. Tags, reader evaluation, metadata and executable forms are rejected. */
export function readEdn(source: string): unknown {
  let i = 0;
  const space = () => {
    while (i < source.length) {
      if (/[\s,]/.test(source[i])) i++;
      else if (source[i] === ';') {
        while (i < source.length && source[i] !== '\n') i++;
      } else break;
    }
  };
  function read(): unknown {
    space();
    const c = source[i++];
    if (c === undefined) throw Error('Unexpected end of EDN');
    if (c === '"') {
      let raw = '"';
      let escaped = false;
      while (i < source.length) {
        const ch = source[i++];
        raw += ch;
        if (ch === '"' && !escaped) return JSON.parse(raw);
        escaped = ch === '\\' && !escaped;
      }
      throw Error('Unclosed EDN string');
    }
    if (c === '[' || c === '(' || c === '{') {
      const end = c === '[' ? ']' : c === '(' ? ')' : '}';
      const values: unknown[] = [];
      while (true) {
        space();
        if (source[i] === end) {
          i++;
          break;
        }
        if (i >= source.length) throw Error('Unclosed EDN collection');
        values.push(read());
      }
      if (c !== '{') return values;
      if (values.length % 2) throw Error('EDN map must contain pairs');
      const out: Record<string, unknown> = Object.create(null);
      for (let n = 0; n < values.length; n += 2) {
        const key = Array.isArray(values[n])
          ? (values[n] as unknown[]).join('|')
          : String(values[n]);
        if (Object.hasOwn(out, key)) throw Error('Duplicate EDN key: ' + key);
        out[key] = values[n + 1];
      }
      return out;
    }
    if (c === '#') {
      if (source[i] === '{') {
        i++;
        const v: unknown[] = [];
        while (true) {
          space();
          if (source[i] === '}') {
            i++;
            return v;
          }
          v.push(read());
        }
      }
      throw Error('EDN tagged and executable reader forms are not supported');
    }
    if (']} )'.includes(c) && c !== ' ')
      throw Error('Unexpected EDN delimiter');
    let token = c;
    while (i < source.length && !/[\s,\[\]{}();]/.test(source[i]))
      token += source[i++];
    if (token === 'nil') return null;
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?M?$/.test(token)) {
      const n = Number(token.replace(/M$/, ''));
      if (!Number.isFinite(n)) throw Error('Invalid EDN number');
      return n;
    }
    return token.replace(/^:/, '');
  }
  const value = read();
  space();
  if (i !== source.length) throw Error('Trailing EDN input');
  return value;
}
export function convertDocument(value: unknown) {
  return { schemaVersion: 1, format: 'legacy-edn', data: value };
}
