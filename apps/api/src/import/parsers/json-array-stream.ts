/**
 * Bounded-memory streaming parser for a top-level JSON array file
 * (Sprint 12A.4 Task 3).
 *
 * The real 1C export files (`products.json` etc.) are a single top-level
 * JSON array of flat objects. `JSON.parse(await file.text())` would hold
 * two large structures in memory at once for the whole run: the raw file
 * text, and the fully-built parse tree. For a file potentially larger than
 * the 18k-row sample this project's aggregate audit observed
 * (`docs/legacy-audit/vizaje-1c-audit.json`), that is an avoidable
 * liability.
 *
 * This module reads the file in fixed-size chunks (`Bun.file().stream()`),
 * decodes incrementally, and emits one *complete top-level array element*
 * at a time as soon as its closing bracket/brace is found - tracking
 * object/array nesting depth and JSON string state (quotes + backslash
 * escapes, including `\"`, `\\`, and `\uXXXX`) so a comma or brace inside a
 * quoted string is never mistaken for a structural delimiter. Only the
 * current unconsumed buffer tail (never more than a few chunks) and the
 * substring of the element currently being scanned are held in memory at
 * once - not the whole file text and not a running array of every row
 * already parsed.
 *
 * Honesty note (same standard as `./mysql-dump.ts`'s own disclaimer): this
 * bounds *parsing* memory, not the caller's memory. The existing Sprint
 * 12A.3 matching logic (`../reconcile/sql-1c-reconciliation.ts`) needs
 * random access across the whole 1C record set to build its GUID/barcode/
 * group indices, so a caller that needs to match against every record
 * will still end up holding the full array of parsed records at once -
 * that is inherent to the matching algorithm, not something this parser
 * can avoid on its own. What this module actually buys: no second
 * full-file-text string allocation held alongside the parsed structure,
 * and the ability to process a file whose raw text would not comfortably
 * fit as one contiguous JS string, one element at a time.
 */

const CHUNK_READABLE_HINT = 1024 * 1024 // 1 MiB chunks from the underlying stream reader

export class JsonArrayStreamError extends Error {
	constructor(
		message: string,
		public readonly filePath: string
	) {
		super(`${message} (file: ${filePath})`)
	}
}

type ScanState = {
	// Nesting depth *inside* the current top-level element. 0 means "not
	// currently inside an element" (between elements, or before the first
	// '[' / after the final ']').
	depth: number
	inString: boolean
	escapeNext: boolean
	elementStart: number | null
	sawOpeningBracket: boolean
	sawArrayEnd: boolean
}

function newState(): ScanState {
	return { depth: 0, inString: false, escapeNext: false, elementStart: null, sawOpeningBracket: false, sawArrayEnd: false }
}

/**
 * Scans `buffer` from `fromIndex`, mutating `state` and yielding complete
 * top-level element substrings as they close. Returns the index up to
 * which `buffer` has been fully consumed, so the caller can safely drop
 * that prefix (`buffer.slice(consumedUpTo)`) before appending the next
 * chunk - this is what keeps the live buffer bounded rather than growing
 * for the whole file.
 */
function scanChunk(buffer: string, fromIndex: number, state: ScanState, onElement: (raw: string) => void): number {
	let i = fromIndex
	let consumedUpTo = fromIndex

	while (i < buffer.length) {
		const ch = buffer[i]

		if (!state.sawOpeningBracket) {
			if (ch === '[') {
				state.sawOpeningBracket = true
				consumedUpTo = i + 1
			} else if (/\s/.test(ch)) {
				consumedUpTo = i + 1
			} else {
				throw new Error(`expected top-level JSON array ('['), found "${ch}" at offset ${i}`)
			}
			i++
			continue
		}

		if (state.sawArrayEnd) {
			i++
			continue
		}

		if (state.depth === 0) {
			// Between elements: skip whitespace/commas, detect the closing ']'.
			if (ch === ']') {
				state.sawArrayEnd = true
				consumedUpTo = i + 1
				i++
				continue
			}
			if (ch === ',' || /\s/.test(ch)) {
				consumedUpTo = i + 1
				i++
				continue
			}
			// Start of a new element.
			state.elementStart = i
			state.depth = ch === '{' || ch === '[' ? 1 : 0
			if (state.depth === 0) {
				// A scalar top-level array element (string/number/bool/null) -
				// uncommon for this feed shape but handled for robustness. We
				// still need to find its end, which for a bare scalar is the
				// next unescaped ',' or ']' at depth 0 outside a string.
				if (ch === '"') state.inString = true
			}
			i++
			continue
		}

		// Inside an element (depth >= 1 for objects/arrays, or scanning a
		// bare scalar at depth 0-equivalent tracked via elementStart).
		if (state.inString) {
			if (state.escapeNext) {
				state.escapeNext = false
			} else if (ch === '\\') {
				state.escapeNext = true
			} else if (ch === '"') {
				state.inString = false
			}
			i++
			continue
		}

		if (ch === '"') {
			state.inString = true
			i++
			continue
		}
		if (ch === '{' || ch === '[') {
			state.depth++
			i++
			continue
		}
		if (ch === '}' || ch === ']') {
			state.depth--
			i++
			if (state.depth === 0) {
				const raw = buffer.slice(state.elementStart as number, i)
				onElement(raw)
				state.elementStart = null
				consumedUpTo = i
			}
			continue
		}
		if ((ch === ',' || ch === ']') && state.depth === 0 && state.elementStart !== null) {
			// End of a bare scalar top-level element.
			const raw = buffer.slice(state.elementStart, i)
			onElement(raw)
			state.elementStart = null
			consumedUpTo = i
			// Do not consume the delimiter itself yet - let the depth===0
			// branch above handle it on the next loop iteration.
			continue
		}
		i++
	}

	return consumedUpTo
}

/**
 * Streams a top-level JSON array file, yielding one parsed element at a
 * time. Throws `JsonArrayStreamError` if the file does not start with
 * `[` (after whitespace) - this module intentionally does not support the
 * `{"products": [...]}` wrapper shape some anonymized sample fixtures use;
 * see the CLI's own fallback for that shape.
 */
export async function* streamJsonArrayFile(filePath: string): AsyncGenerator<unknown> {
	const file = Bun.file(filePath)
	if (!(await file.exists())) {
		throw new JsonArrayStreamError('file not found', filePath)
	}

	const stream = file.stream()
	const reader = stream.getReader()
	const decoder = new TextDecoder('utf-8')
	const state = newState()

	let buffer = ''
	// How far into `buffer` the character-by-character FSM has already run.
	// Re-scanning from 0 on every chunk would re-apply already-applied state
	// transitions (depth increments, inString toggles, escape handling) a
	// second time for the still-unconsumed tail of the buffer and corrupt
	// `state` - so every scan resumes exactly where the previous one left
	// off, never earlier.
	let resumeFrom = 0
	const pending: string[] = []

	const runScan = (): void => {
		let consumedUpTo: number
		try {
			consumedUpTo = scanChunk(buffer, resumeFrom, state, raw => pending.push(raw))
		} catch (error) {
			throw new JsonArrayStreamError(error instanceof Error ? error.message : String(error), filePath)
		}
		buffer = buffer.slice(consumedUpTo)
		resumeFrom = buffer.length
		// `state.elementStart` (when an element is still in progress) is an
		// absolute index into the buffer we just shrank - it must be
		// rebased by the same offset, or the eventual `buffer.slice(
		// elementStart, i)` for this element reads from the wrong
		// (now too-large) position in the new, shorter buffer.
		if (state.elementStart !== null) state.elementStart -= consumedUpTo
	}

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			buffer += decoder.decode(value, { stream: true })
			runScan()
			for (const raw of pending.splice(0, pending.length)) {
				yield JSON.parse(raw)
			}
			// Bound the live buffer: if a single element's raw text is
			// genuinely enormous this will still grow, but that only happens
			// for a pathologically large single row, never for the file as a
			// whole - the array-level bookkeeping above drops everything
			// before the current in-progress element on every chunk.
		}

		const tail = decoder.decode()
		if (tail.length > 0) {
			buffer += tail
			runScan()
			for (const raw of pending.splice(0, pending.length)) {
				yield JSON.parse(raw)
			}
		}

		if (!state.sawOpeningBracket) {
			throw new JsonArrayStreamError('file was empty or did not contain a top-level JSON array', filePath)
		}
		if (!state.sawArrayEnd) {
			throw new JsonArrayStreamError('file ended before the top-level JSON array was closed', filePath)
		}
	} finally {
		reader.releaseLock()
	}
}

/** Convenience: collects the full streamed array into memory. Callers that need random-access indexing (the matching algorithms in this project) use this - the streaming benefit is in the parse step, not in avoiding the final in-memory array, which the matching design inherently requires (see module doc above). */
export async function readJsonArrayFileBounded(filePath: string): Promise<unknown[]> {
	const out: unknown[] = []
	for await (const element of streamJsonArrayFile(filePath)) {
		out.push(element)
	}
	return out
}
