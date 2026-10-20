import { describe, expect, test } from 'bun:test'
import { MysqlDumpParseError, parseInsertStatements } from '../src/import/parsers/mysql-dump'

describe('parseInsertStatements (Sprint 12 Task 9: synthetic mysqldump fixtures)', () => {
	test('parses a single-row INSERT with numbers, NULL, and a plain string', () => {
		const sql = "INSERT INTO `products` (`id`, `title`, `price`, `note`) VALUES (1, 'Test Product', 19.99, NULL);"
		const [stmt] = parseInsertStatements(sql, 'products')
		expect(stmt.columns).toEqual(['id', 'title', 'price', 'note'])
		expect(stmt.rows).toEqual([[1, 'Test Product', 19.99, null]])
	})

	test('parses a multi-row INSERT with many tuples in one statement', () => {
		const sql = "INSERT INTO `brands` (`id`, `title`) VALUES (1, 'Anny'), (2, 'Dior'), (3, 'Biotherm');"
		const [stmt] = parseInsertStatements(sql, 'brands')
		expect(stmt.rows).toHaveLength(3)
		expect(stmt.rows.map(r => r[1])).toEqual(['Anny', 'Dior', 'Biotherm'])
	})

	test('parses a multiline INSERT statement (real mysqldump formatting) spanning many physical lines', () => {
		const sql = [
			'INSERT INTO `categories` (`id`, `title`) VALUES',
			"(1, 'Perfume'),",
			"(2, 'Makeup'),",
			"(3, 'Skincare');"
		].join('\n')
		const [stmt] = parseInsertStatements(sql, 'categories')
		expect(stmt.rows).toHaveLength(3)
		expect(stmt.rows[2]).toEqual([3, 'Skincare'])
	})

	test('correctly unescapes backslash-escaped quotes inside a string value', () => {
		const sql = "INSERT INTO `products` (`id`, `text`) VALUES (1, 'He said \\'hello\\' to me');"
		const [stmt] = parseInsertStatements(sql, 'products')
		expect(stmt.rows[0][1]).toBe("He said 'hello' to me")
	})

	test('a literal comma and literal parentheses inside a quoted string never split or truncate the row', () => {
		const sql = "INSERT INTO `products` (`id`, `text`) VALUES (1, 'Volume: 50ml (new), with notes, and more');"
		const [stmt] = parseInsertStatements(sql, 'products')
		expect(stmt.rows[0]).toEqual([1, 'Volume: 50ml (new), with notes, and more'])
	})

	test('a literal semicolon inside a quoted string never ends the statement early', () => {
		const sql = "INSERT INTO `products` (`id`, `text`) VALUES (1, 'Use before 12;2026');"
		const [stmt] = parseInsertStatements(sql, 'products')
		expect(stmt.rows[0]).toEqual([1, 'Use before 12;2026'])
	})

	test('preserves raw newlines embedded inside a TEXT field value', () => {
		const sql = "INSERT INTO `products` (`id`, `textRU`) VALUES (1, 'Line one\\nLine two\\nLine three');"
		const [stmt] = parseInsertStatements(sql, 'products')
		expect(stmt.rows[0][1]).toBe('Line one\nLine two\nLine three')
	})

	test('decodes multi-byte Unicode (Cyrillic) content exactly', () => {
		const sql = "INSERT INTO `products` (`id`, `titleRU`) VALUES (1, 'Крем для кожи вокруг глаз');"
		const [stmt] = parseInsertStatements(sql, 'products')
		expect(stmt.rows[0][1]).toBe('Крем для кожи вокруг глаз')
	})

	test('parses negative and decimal numeric literals without quotes', () => {
		const sql = 'INSERT INTO `products_variable` (`id`, `price`, `qty`) VALUES (1, 19.5, -3);'
		const [stmt] = parseInsertStatements(sql, 'products_variable')
		expect(stmt.rows[0]).toEqual([1, 19.5, -3])
	})

	test('finds and parses several separate INSERT statements for the same table', () => {
		const sql = [
			"INSERT INTO `products` (`id`) VALUES (1);",
			"-- a comment line in between, as real mysqldump output has",
			"INSERT INTO `products` (`id`) VALUES (2), (3);"
		].join('\n')
		const statements = parseInsertStatements(sql, 'products')
		expect(statements).toHaveLength(2)
		expect(statements.flatMap(s => s.rows)).toEqual([[1], [2], [3]])
	})

	test('ignores INSERT statements for a different table entirely', () => {
		const sql = "INSERT INTO `brands` (`id`) VALUES (1);\nINSERT INTO `products` (`id`) VALUES (2);"
		const statements = parseInsertStatements(sql, 'categories')
		expect(statements).toHaveLength(0)
	})

	test('throws MysqlDumpParseError (not a silent wrong answer) on a genuinely malformed statement', () => {
		const sql = "INSERT INTO `products` (`id`, `title`) VALUES (1, 'unterminated"
		expect(() => parseInsertStatements(sql, 'products')).toThrow(MysqlDumpParseError)
	})

	test('handles an empty-string value distinctly from NULL', () => {
		const sql = "INSERT INTO `products` (`id`, `note`, `other`) VALUES (1, '', NULL);"
		const [stmt] = parseInsertStatements(sql, 'products')
		expect(stmt.rows[0]).toEqual([1, '', null])
	})

	test('a string value that itself contains an escaped backslash is preserved correctly', () => {
		const sql = "INSERT INTO `products` (`id`, `path`) VALUES (1, 'C:\\\\images\\\\a.jpg');"
		const [stmt] = parseInsertStatements(sql, 'products')
		expect(stmt.rows[0][1]).toBe('C:\\images\\a.jpg')
	})
})
