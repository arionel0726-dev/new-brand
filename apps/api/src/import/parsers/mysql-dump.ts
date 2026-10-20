/**
 * A real mysqldump INSERT-statement tokenizer (Sprint 12 Task 7). This is
 * NOT a generic SQL parser - it understands exactly the subset of syntax
 * mysqldump emits for `INSERT INTO \`table\` (\`col\`, ...) VALUES (...), (...);`
 * statements, nothing more (no SELECT, no expressions, no functions).
 *
 * Deliberately a hand-rolled character scanner, not a regex split on
 * newlines or commas: a single mysqldump INSERT statement routinely spans
 * many lines, batches many row-tuples in one statement, and its string
 * values can themselves contain literal commas, parentheses, semicolons,
 * backslash escapes and raw newlines (TEXT columns). Any line-oriented or
 * naive-regex approach silently corrupts those rows instead of failing
 * loudly, which is exactly what Sprint 12's spec forbids.
 *
 * Whole-file-in-memory tradeoff: this module scans a JS string already
 * held in memory (the caller reads the file once via Bun.file().text()).
 * For the real ~31MB vizaje_catalog_only.sql this is a deliberate,
 * pragmatic choice - true token-level streaming would add real complexity
 * (a statement's end can only be known after scanning through every
 * embedded quote/paren) for no measurable benefit at this file size. This
 * is NOT a streaming parser and does not claim to be one.
 */

export type SqlValue = string | number | null

export type ParsedInsertStatement = {
	columns: string[]
	rows: SqlValue[][]
}

export class MysqlDumpParseError extends Error {
	constructor(
		message: string,
		public readonly position: number
	) {
		super(`${message} (at character offset ${position})`)
	}
}

/**
 * Finds every `INSERT INTO \`tableName\` ...` statement in `sql` and parses
 * each one fully. Statements for other tables are skipped without being
 * parsed (cheap substring search), so calling this once per table of
 * interest on the same big string is fine.
 */
export function parseInsertStatements(sql: string, tableName: string): ParsedInsertStatement[] {
	const statements: ParsedInsertStatement[] = []
	const needle = `INSERT INTO \`${tableName}\``
	let searchFrom = 0

	while (true) {
		const idx = sql.indexOf(needle, searchFrom)
		if (idx === -1) break
		const { statement, endIndex } = parseOneInsertStatement(sql, idx)
		statements.push(statement)
		searchFrom = endIndex
	}

	return statements
}

function parseOneInsertStatement(sql: string, startIdx: number): { statement: ParsedInsertStatement; endIndex: number } {
	let i = sql.indexOf('(', startIdx)
	if (i === -1) throw new MysqlDumpParseError('expected "(" to open the column list', startIdx)

	const colsClose = findMatchingParen(sql, i)
	const columns = sql
		.slice(i + 1, colsClose)
		.split(',')
		.map(col => col.trim().replace(/^`|`$/g, ''))
	i = colsClose + 1

	const valuesIdx = sql.indexOf('VALUES', i)
	if (valuesIdx === -1) throw new MysqlDumpParseError('expected VALUES keyword', i)
	i = valuesIdx + 'VALUES'.length

	const rows: SqlValue[][] = []

	while (true) {
		i = skipWhitespaceAndCommas(sql, i)
		if (sql[i] === ';') {
			i += 1
			break
		}
		if (sql[i] !== '(') {
			throw new MysqlDumpParseError(`expected "(" to start a row tuple or ";" to end the statement, found ${JSON.stringify(sql.slice(i, i + 20))}`, i)
		}
		const { row, endIndex } = parseRowTuple(sql, i)
		rows.push(row)
		i = endIndex
	}

	return { statement: { columns, rows }, endIndex: i }
}

function findMatchingParen(sql: string, openIdx: number): number {
	let depth = 0
	for (let i = openIdx; i < sql.length; i++) {
		if (sql[i] === '(') depth++
		else if (sql[i] === ')') {
			depth--
			if (depth === 0) return i
		}
	}
	throw new MysqlDumpParseError('unterminated parenthesis', openIdx)
}

function skipWhitespaceAndCommas(sql: string, i: number): number {
	while (i < sql.length && (sql[i] === ' ' || sql[i] === '\t' || sql[i] === '\n' || sql[i] === '\r' || sql[i] === ',')) {
		i++
	}
	return i
}

function parseRowTuple(sql: string, openParenIdx: number): { row: SqlValue[]; endIndex: number } {
	let i = openParenIdx + 1
	const row: SqlValue[] = []

	while (true) {
		i = skipInnerWhitespace(sql, i)
		if (sql[i] === ')') {
			return { row, endIndex: i + 1 }
		}
		const { value, endIndex } = parseFieldValue(sql, i)
		row.push(value)
		i = skipInnerWhitespace(sql, endIndex)
		if (sql[i] === ',') {
			i += 1
			continue
		}
		if (sql[i] === ')') {
			return { row, endIndex: i + 1 }
		}
		throw new MysqlDumpParseError(`expected "," or ")" inside a row tuple, found ${JSON.stringify(sql.slice(i, i + 20))}`, i)
	}
}

function skipInnerWhitespace(sql: string, i: number): number {
	while (i < sql.length && (sql[i] === ' ' || sql[i] === '\t' || sql[i] === '\n' || sql[i] === '\r')) i++
	return i
}

const BACKSLASH_ESCAPES: Record<string, string> = {
	'0': '\0',
	n: '\n',
	r: '\r',
	t: '\t',
	Z: '\x1a',
	"'": "'",
	'"': '"',
	'\\': '\\',
	b: '\b'
}

function parseFieldValue(sql: string, i: number): { value: SqlValue; endIndex: number } {
	const ch = sql[i]

	if (ch === "'") {
		return parseQuotedString(sql, i)
	}

	// Bare token: NULL, a number, or (unexpectedly) an unquoted identifier.
	// mysqldump never emits function calls or expressions in INSERT value
	// lists, so scanning to the next top-level "," or ")" is safe here.
	let start = i
	while (i < sql.length && sql[i] !== ',' && sql[i] !== ')') i++
	const raw = sql.slice(start, i).trim()

	if (raw === 'NULL') return { value: null, endIndex: i }
	if (/^-?\d+$/.test(raw)) return { value: Number.parseInt(raw, 10), endIndex: i }
	if (/^-?\d+\.\d+([eE][+-]?\d+)?$/.test(raw)) return { value: Number.parseFloat(raw), endIndex: i }
	if (raw.length === 0) throw new MysqlDumpParseError('expected a value, found nothing', start)
	// Unrecognized bare token (e.g. a hex literal like 0x1A, or something this
	// parser doesn't know about yet) - surfaced as the raw text rather than
	// silently coerced, so a caller can see it happened.
	return { value: raw, endIndex: i }
}

function parseQuotedString(sql: string, openQuoteIdx: number): { value: string; endIndex: number } {
	let i = openQuoteIdx + 1
	let result = ''

	while (true) {
		if (i >= sql.length) {
			throw new MysqlDumpParseError('unterminated string literal', openQuoteIdx)
		}
		const ch = sql[i]

		if (ch === '\\') {
			const next = sql[i + 1]
			if (next === undefined) {
				throw new MysqlDumpParseError('unterminated escape sequence at end of string', i)
			}
			result += next in BACKSLASH_ESCAPES ? BACKSLASH_ESCAPES[next] : next
			i += 2
			continue
		}

		if (ch === "'") {
			// mysqldump's default (non-NO_BACKSLASH_ESCAPES) mode never doubles
			// quotes, but handling '' defensively costs nothing and protects
			// against a differently-configured dump.
			if (sql[i + 1] === "'") {
				result += "'"
				i += 2
				continue
			}
			return { value: result, endIndex: i + 1 }
		}

		result += ch
		i += 1
	}
}
