/**
 * MySQL to PostgreSQL SQL Converter
 * Handles the conversion of MySQL-specific SQL syntax to PostgreSQL-compatible format.
 * Designed for phpMyAdmin dump files targeting Supabase import.
 */

class MySQLToPostgresConverter {
    constructor(options = {}) {
        this.options = {
            dropIfExists: true,
            createSequences: true,
            convertCharset: true,
            convertEngine: true,
            convertBackticks: true,
            convertComments: true,
            ...options,
        };
        this.log = [];
        this.stats = {
            tablesConverted: 0,
            insertsConverted: 0,
            dataTypesChanged: 0,
            linesProcessed: 0,
        };
        // Track tables with AUTO_INCREMENT for sequence creation
        this.autoIncrementTables = [];
    }

    addLog(type, message) {
        this.log.push({ type, message });
    }

    /**
     * Main conversion entry point
     */
    convert(mysqlSql) {
        this.log = [];
        this.stats = { tablesConverted: 0, insertsConverted: 0, dataTypesChanged: 0, linesProcessed: 0 };
        this.autoIncrementTables = [];

        if (!mysqlSql || !mysqlSql.trim()) {
            this.addLog('warn', 'Input SQL is empty.');
            return '';
        }

        this.addLog('info', 'Starting MySQL to PostgreSQL conversion...');

        let sql = mysqlSql;

        // Step 1: Remove MySQL-specific comments and preamble
        if (this.options.convertComments) {
            sql = this.removeMySQLComments(sql);
        }

        // Step 2: Convert backticks to proper identifiers
        if (this.options.convertBackticks) {
            sql = this.convertBackticks(sql);
        }

        // Step 3: Process statements one by one
        sql = this.processStatements(sql);

        // Step 4: Clean up
        sql = this.cleanUp(sql);

        this.stats.linesProcessed = sql.split('\n').length;
        this.addLog('success', `Conversion complete! ${this.stats.tablesConverted} tables, ${this.stats.insertsConverted} inserts converted.`);

        return sql;
    }

    /**
     * Remove MySQL-specific comment blocks and SET statements
     */
    removeMySQLComments(sql) {
        const before = sql.length;

        // Remove /*!...*/ conditional comments (single and multi-line)
        sql = sql.replace(/\/\*!\d+[\s\S]*?\*\/\s*;?\s*/g, '');

        // Remove SET statements commonly found in MySQL dumps
        sql = sql.replace(/^\s*SET\s+(SQL_MODE|@|NAMES|CHARACTER|FOREIGN_KEY_CHECKS|UNIQUE_CHECKS|AUTOCOMMIT|TIME_ZONE|SESSION|GLOBAL)\b.*?;\s*$/gim, '');

        // Remove LOCK TABLES / UNLOCK TABLES
        sql = sql.replace(/^\s*(LOCK\s+TABLES|UNLOCK\s+TABLES).*?;\s*$/gim, '');

        if (sql.length !== before) {
            this.addLog('change', 'Removed MySQL-specific comments and SET statements');
        }

        return sql;
    }

    /**
     * Convert backtick-quoted identifiers
     */
    convertBackticks(sql) {
        let count = 0;
        sql = sql.replace(/`([^`]+)`/g, (match, name) => {
            count++;
            if (/^[a-z_][a-z0-9_]*$/i.test(name) && !this.isPostgresReserved(name)) {
                return name;
            }
            return `"${name}"`;
        });

        if (count > 0) {
            this.addLog('change', `Converted ${count} backtick-quoted identifiers`);
        }

        return sql;
    }

    /**
     * Check if a word is a PostgreSQL reserved keyword
     */
    isPostgresReserved(word) {
        const reserved = new Set([
            'user', 'order', 'group', 'table', 'column', 'index', 'key', 'select',
            'insert', 'update', 'delete', 'from', 'where', 'join', 'left', 'right',
            'inner', 'outer', 'on', 'as', 'and', 'or', 'not', 'null', 'true', 'false',
            'in', 'between', 'like', 'is', 'exists', 'case', 'when', 'then', 'else',
            'end', 'create', 'alter', 'drop', 'grant', 'revoke', 'limit', 'offset',
            'check', 'constraint', 'primary', 'foreign', 'references', 'default',
            'unique', 'all', 'any', 'some', 'having', 'union', 'except', 'intersect',
            'returning', 'with', 'recursive', 'do', 'for', 'to', 'analyze', 'desc',
            'asc', 'begin', 'by', 'cascade', 'comment', 'commit', 'current',
            'database', 'domain', 'enable', 'escape', 'execute', 'function',
            'grant', 'if', 'level', 'lock', 'name', 'no', 'nothing',
            'notify', 'of', 'off', 'option', 'over', 'owner', 'position',
            'privileges', 'procedure', 'read', 'release', 'replace', 'restrict',
            'returns', 'role', 'rollback', 'row', 'rows', 'rule', 'schema',
            'sequence', 'session', 'set', 'share', 'start', 'statement',
            'system', 'temp', 'temporary', 'text', 'transaction', 'trigger',
            'truncate', 'type', 'until', 'value', 'values', 'view', 'work', 'zone',
        ]);
        return reserved.has(word.toLowerCase());
    }

    /**
     * Strip leading SQL comments (-- lines) from a statement to get the actual SQL.
     * Returns { comments, body } where comments is the leading comment text and body
     * is the rest.
     */
    stripLeadingComments(stmt) {
        const lines = stmt.split('\n');
        const commentLines = [];
        let bodyStartIndex = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line === '' || line.startsWith('--')) {
                commentLines.push(lines[i]);
                bodyStartIndex = i + 1;
            } else {
                break;
            }
        }

        const comments = commentLines.join('\n');
        const body = lines.slice(bodyStartIndex).join('\n');
        return { comments, body };
    }

    /**
     * Process SQL statements intelligently
     */
    processStatements(sql) {
        // Split into individual statements by semicolons (handling multi-line ones)
        const statements = this.splitStatements(sql);
        const result = [];

        for (const stmt of statements) {
            const trimmed = stmt.trim();
            if (!trimmed || trimmed === '') continue;

            // Strip leading comments to identify the actual statement type
            const { comments, body } = this.stripLeadingComments(trimmed);
            const bodyTrimmed = body.trim();

            // Pure comment block — no SQL body
            if (!bodyTrimmed) {
                if (comments.trim()) result.push(comments);
                continue;
            }

            // Prefix to prepend: leading comments
            const prefix = comments.trim() ? comments + '\n' : '';

            // Identify and process each statement type
            if (/^CREATE\s+TABLE/i.test(bodyTrimmed)) {
                result.push(prefix + this.processCreateTable(bodyTrimmed));
            } else if (/^INSERT\s+INTO/i.test(bodyTrimmed)) {
                result.push(prefix + this.processInsert(bodyTrimmed));
            } else if (/^ALTER\s+TABLE/i.test(bodyTrimmed)) {
                const processed = this.processAlterTable(bodyTrimmed);
                if (processed) result.push(prefix + processed);
            } else if (/^START\s+TRANSACTION/i.test(bodyTrimmed)) {
                result.push(prefix + 'BEGIN');
            } else if (/^COMMIT/i.test(bodyTrimmed)) {
                result.push('COMMIT');
            } else {
                // Keep other statements as-is
                result.push(prefix + bodyTrimmed);
            }
        }

        return result.join(';\n\n');
    }

    /**
     * Split SQL into individual statements, preserving comments between them.
     * Handles multi-line statements and string literals containing semicolons.
     */
    splitStatements(sql) {
        const statements = [];
        let current = '';
        let inString = false;
        let stringChar = '';
        let i = 0;

        while (i < sql.length) {
            const ch = sql[i];

            // Handle string literals
            if (inString) {
                current += ch;
                if (ch === '\\' && i + 1 < sql.length) {
                    // Escaped character inside string
                    current += sql[i + 1];
                    i += 2;
                    continue;
                }
                if (ch === stringChar) {
                    // Check for doubled quote (e.g., '')
                    if (i + 1 < sql.length && sql[i + 1] === stringChar) {
                        current += sql[i + 1];
                        i += 2;
                        continue;
                    }
                    inString = false;
                }
                i++;
                continue;
            }

            // Start of string
            if (ch === '\'' || ch === '"') {
                inString = true;
                stringChar = ch;
                current += ch;
                i++;
                continue;
            }

            // Handle -- comments
            if (ch === '-' && i + 1 < sql.length && sql[i + 1] === '-') {
                const endOfLine = sql.indexOf('\n', i);
                if (endOfLine === -1) {
                    current += sql.substring(i);
                    i = sql.length;
                } else {
                    current += sql.substring(i, endOfLine + 1);
                    i = endOfLine + 1;
                }
                continue;
            }

            // Handle /* */ comments
            if (ch === '/' && i + 1 < sql.length && sql[i + 1] === '*') {
                const endComment = sql.indexOf('*/', i + 2);
                if (endComment === -1) {
                    current += sql.substring(i);
                    i = sql.length;
                } else {
                    current += sql.substring(i, endComment + 2);
                    i = endComment + 2;
                }
                continue;
            }

            // Semicolon — end of statement
            if (ch === ';') {
                if (current.trim()) {
                    statements.push(current.trim());
                }
                current = '';
                i++;
                continue;
            }

            current += ch;
            i++;
        }

        // Remaining content
        if (current.trim()) {
            statements.push(current.trim());
        }

        return statements;
    }

    /**
     * Process CREATE TABLE statement
     */
    processCreateTable(stmt) {
        this.stats.tablesConverted++;

        // Extract table name for DROP IF EXISTS
        const tableNameMatch = stmt.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w"]+)/i);
        const tableName = tableNameMatch ? tableNameMatch[1] : '';

        let result = stmt;

        // Convert data types within CREATE TABLE column definitions
        result = this.convertDataTypes(result);

        // Remove ENGINE= clause
        if (this.options.convertEngine) {
            result = result.replace(/\)\s*ENGINE\s*=\s*\w+/gi, ')');
        }

        // Remove DEFAULT CHARSET / CHARACTER SET / COLLATE
        if (this.options.convertCharset) {
            result = result.replace(/\s+DEFAULT\s+CHARSET\s*=\s*[\w]+/gi, '');
            result = result.replace(/\s+CHARACTER\s+SET\s+\w+/gi, '');
            result = result.replace(/\s+COLLATE\s*=?\s*[\w]+/gi, '');
            result = result.replace(/\s+CHARSET\s*=\s*\w+/gi, '');
        }

        // Remove AUTO_INCREMENT=N table option
        result = result.replace(/\s+AUTO_INCREMENT\s*=\s*\d+/gi, '');

        // Remove ROW_FORMAT
        result = result.replace(/\s+ROW_FORMAT\s*=\s*\w+/gi, '');

        // Remove table COMMENT='...'
        result = result.replace(/\s+COMMENT\s*=\s*'(?:[^'\\]|\\.)*'/gi, '');

        // Remove column COMMENT '...'
        result = result.replace(/\s+COMMENT\s+'(?:[^'\\]|\\.)*'/gi, '');

        // Convert UNIQUE KEY inside CREATE TABLE to UNIQUE
        result = result.replace(/UNIQUE\s+KEY\s+[\w"]+\s*/gi, 'UNIQUE ');

        // Remove plain KEY (index) inside CREATE TABLE
        result = result.replace(/,?\s*\bKEY\s+[\w"]+\s*\([^)]+\)/gi, (match, offset) => {
            const before = result.substring(Math.max(0, offset - 20), offset);
            if (/(?:PRIMARY|UNIQUE|FOREIGN)\s*$/i.test(before)) {
                return match;
            }
            return '';
        });

        // Remove USING BTREE / USING HASH
        result = result.replace(/\s+USING\s+(BTREE|HASH)/gi, '');

        // Convert ON UPDATE CURRENT_TIMESTAMP
        result = result.replace(
            /\s+ON\s+UPDATE\s+CURRENT_TIMESTAMP(\(\))?/gi,
            ' /* ON UPDATE CURRENT_TIMESTAMP — use a trigger in PostgreSQL */'
        );

        // Remove trailing commas before closing parenthesis
        result = result.replace(/,(\s*)\)/g, '$1)');

        // Prepend DROP TABLE IF EXISTS
        if (this.options.dropIfExists && tableName) {
            result = `DROP TABLE IF EXISTS ${tableName} CASCADE;\n${result}`;
        }

        return result;
    }

    /**
     * Convert MySQL data types to PostgreSQL equivalents
     */
    convertDataTypes(sql) {
        const changes = new Set();

        // TINYINT(1) → BOOLEAN (must come before general TINYINT)
        sql = sql.replace(/\bTINYINT\s*\(\s*1\s*\)/gi, () => {
            changes.add('TINYINT(1) → BOOLEAN');
            return 'BOOLEAN';
        });

        // TINYINT(n) → SMALLINT
        sql = sql.replace(/\bTINYINT\b(\s*\(\s*\d+\s*\))?(\s+UNSIGNED)?/gi, () => {
            changes.add('TINYINT → SMALLINT');
            return 'SMALLINT';
        });

        // MEDIUMINT → INTEGER
        sql = sql.replace(/\bMEDIUMINT\b(\s*\(\s*\d+\s*\))?(\s+UNSIGNED)?/gi, () => {
            changes.add('MEDIUMINT → INTEGER');
            return 'INTEGER';
        });

        // INT(n) → INTEGER (remove display width)
        // Must match INT but not INTEGER (to avoid double processing)
        sql = sql.replace(/\bINT\b(\s*\(\s*\d+\s*\))?(\s+UNSIGNED)?(?!\s*E)/gi, (match) => {
            // Don't match if it's already "INTEGER"
            if (/^INTEGER/i.test(match)) return match;
            changes.add('INT → INTEGER');
            return 'INTEGER';
        });

        // BIGINT(n) → BIGINT
        sql = sql.replace(/\bBIGINT\b(\s*\(\s*\d+\s*\))?(\s+UNSIGNED)?/gi, () => {
            changes.add('BIGINT (removed display width)');
            return 'BIGINT';
        });

        // FLOAT → REAL
        sql = sql.replace(/\bFLOAT\b(\s*\(\s*\d+\s*(,\s*\d+\s*)?\))?/gi, () => {
            changes.add('FLOAT → REAL');
            return 'REAL';
        });

        // DOUBLE → DOUBLE PRECISION
        sql = sql.replace(/\bDOUBLE\s+PRECISION\b/gi, 'DOUBLE PRECISION');
        sql = sql.replace(/\bDOUBLE\b(\s*\(\s*\d+\s*,\s*\d+\s*\))?/gi, () => {
            changes.add('DOUBLE → DOUBLE PRECISION');
            return 'DOUBLE PRECISION';
        });

        // Text types
        sql = sql.replace(/\bTINYTEXT\b/gi, () => { changes.add('TINYTEXT → TEXT'); return 'TEXT'; });
        sql = sql.replace(/\bMEDIUMTEXT\b/gi, () => { changes.add('MEDIUMTEXT → TEXT'); return 'TEXT'; });
        sql = sql.replace(/\bLONGTEXT\b/gi, () => { changes.add('LONGTEXT → TEXT'); return 'TEXT'; });

        // Binary/Blob types
        sql = sql.replace(/\bTINYBLOB\b/gi, () => { changes.add('TINYBLOB → BYTEA'); return 'BYTEA'; });
        sql = sql.replace(/\bMEDIUMBLOB\b/gi, () => { changes.add('MEDIUMBLOB → BYTEA'); return 'BYTEA'; });
        sql = sql.replace(/\bLONGBLOB\b/gi, () => { changes.add('LONGBLOB → BYTEA'); return 'BYTEA'; });
        sql = sql.replace(/\bBLOB\b/gi, () => { changes.add('BLOB → BYTEA'); return 'BYTEA'; });
        sql = sql.replace(/\bVARBINARY\b(\s*\(\s*\d+\s*\))?/gi, () => { changes.add('VARBINARY → BYTEA'); return 'BYTEA'; });
        sql = sql.replace(/\bBINARY\b(\s*\(\s*\d+\s*\))?/gi, () => { changes.add('BINARY → BYTEA'); return 'BYTEA'; });

        // DATETIME → TIMESTAMP
        sql = sql.replace(/\bDATETIME\b(\s*\(\s*\d+\s*\))?/gi, () => {
            changes.add('DATETIME → TIMESTAMP');
            return 'TIMESTAMP';
        });

        // ENUM → TEXT with comment
        sql = sql.replace(/\bENUM\s*\(([^)]+)\)/gi, (match, values) => {
            changes.add('ENUM → TEXT');
            return `TEXT /* was ENUM(${values}) */`;
        });

        // SET → TEXT
        sql = sql.replace(/\bSET\s*\(([^)]+)\)/gi, () => {
            changes.add('SET → TEXT');
            return 'TEXT';
        });

        this.stats.dataTypesChanged += changes.size;
        if (changes.size > 0) {
            changes.forEach(c => this.addLog('info', `  ↳ ${c}`));
        }

        return sql;
    }

    /**
     * Process INSERT statement
     */
    processInsert(stmt) {
        this.stats.insertsConverted++;

        let result = stmt;

        // MySQL escape: \' → '' (PostgreSQL standard)
        result = result.replace(/\\'/g, "''");

        // Convert \" → " inside strings
        result = result.replace(/\\"/g, '"');

        return result;
    }

    /**
     * Process ALTER TABLE statement — the most complex part.
     * phpMyAdmin generates multi-line ALTER TABLE with ADD/MODIFY clauses.
     */
    processAlterTable(stmt) {
        // Extract table name
        const tableMatch = stmt.match(/ALTER\s+TABLE\s+([\w"]+)/i);
        if (!tableMatch) return stmt;
        const tableName = tableMatch[1];

        // Check if this is a MODIFY AUTO_INCREMENT statement
        if (/\bMODIFY\b/i.test(stmt) && /\bAUTO_INCREMENT\b/i.test(stmt)) {
            // This is the pattern: ALTER TABLE x MODIFY id int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=N;
            // In PostgreSQL, we need to create a sequence instead.
            // Extract column name
            const modifyMatch = stmt.match(/MODIFY\s+([\w"]+)\s+.*?AUTO_INCREMENT/i);
            if (modifyMatch && this.options.createSequences) {
                const colName = modifyMatch[1];
                this.autoIncrementTables.push({ table: tableName, column: colName });
                this.addLog('change', `Converted AUTO_INCREMENT on ${tableName}.${colName} to SERIAL sequence`);

                // Create sequence and set default
                const seqName = `${tableName.replace(/"/g, '')}_${colName.replace(/"/g, '')}_seq`;
                const lines = [];
                lines.push(`CREATE SEQUENCE IF NOT EXISTS ${seqName}`);
                lines.push(`;\nALTER TABLE ${tableName} ALTER COLUMN ${colName} SET DEFAULT nextval('${seqName}')`);
                lines.push(`;\nALTER TABLE ${tableName} ALTER COLUMN ${colName} SET NOT NULL`);

                // Extract AUTO_INCREMENT start value
                const startMatch = stmt.match(/AUTO_INCREMENT\s*=\s*(\d+)/i);
                if (startMatch) {
                    const startVal = startMatch[1];
                    lines.push(`;\nSELECT setval('${seqName}', ${startVal}, false)`);
                }

                return lines.join('');
            }
            // If not creating sequences, just skip this statement
            return null;
        }

        // For other ALTER TABLE statements, process each clause
        // Split into individual ADD/MODIFY clauses
        const body = stmt.replace(/ALTER\s+TABLE\s+[\w"]+\s*/i, '').trim();
        const clauses = this.splitAlterClauses(body);
        const keepClauses = [];

        for (const clause of clauses) {
            const trimmedClause = clause.trim();

            if (/^ADD\s+PRIMARY\s+KEY\b/i.test(trimmedClause)) {
                // ADD PRIMARY KEY — keep as-is
                keepClauses.push(trimmedClause);
            } else if (/^ADD\s+UNIQUE\s+KEY\b/i.test(trimmedClause)) {
                // ADD UNIQUE KEY name (cols) → ADD UNIQUE (cols)
                const converted = trimmedClause.replace(
                    /^ADD\s+UNIQUE\s+KEY\s+[\w"]+\s*/i,
                    'ADD UNIQUE '
                );
                keepClauses.push(converted);
            } else if (/^ADD\s+UNIQUE\b/i.test(trimmedClause)) {
                // ADD UNIQUE (cols) — keep as-is
                keepClauses.push(trimmedClause);
            } else if (/^ADD\s+KEY\b/i.test(trimmedClause)) {
                // ADD KEY name (cols) — skip (index, not constraint)
                // Could convert to CREATE INDEX but usually not needed
                this.addLog('info', `  ↳ Removed index: ${trimmedClause.substring(0, 60)}...`);
            } else if (/^ADD\s+CONSTRAINT\b/i.test(trimmedClause)) {
                // ADD CONSTRAINT — keep as-is (FOREIGN KEY etc.)
                // But convert ON UPDATE CASCADE to just ON DELETE CASCADE
                // Actually ON UPDATE CASCADE is valid in PostgreSQL too
                keepClauses.push(trimmedClause);
            } else if (/^MODIFY\b/i.test(trimmedClause)) {
                // MODIFY without AUTO_INCREMENT — skip (MySQL-specific)
                this.addLog('info', `  ↳ Skipped MODIFY clause for ${tableName}`);
            } else {
                // Unknown — keep
                keepClauses.push(trimmedClause);
            }
        }

        if (keepClauses.length === 0) {
            return null; // Skip entirely
        }

        return `ALTER TABLE ${tableName}\n  ${keepClauses.join(',\n  ')}`;
    }

    /**
     * Split ALTER TABLE clauses by top-level commas (not inside parentheses)
     */
    splitAlterClauses(body) {
        const clauses = [];
        let current = '';
        let depth = 0;
        let inString = false;
        let stringChar = '';

        for (let i = 0; i < body.length; i++) {
            const ch = body[i];

            if (inString) {
                current += ch;
                if (ch === '\\' && i + 1 < body.length) {
                    current += body[i + 1];
                    i++;
                    continue;
                }
                if (ch === stringChar) {
                    inString = false;
                }
                continue;
            }

            if (ch === '\'' || ch === '"') {
                inString = true;
                stringChar = ch;
                current += ch;
                continue;
            }

            if (ch === '(') {
                depth++;
                current += ch;
                continue;
            }

            if (ch === ')') {
                depth--;
                current += ch;
                continue;
            }

            if (ch === ',' && depth === 0) {
                if (current.trim()) {
                    clauses.push(current.trim());
                }
                current = '';
                continue;
            }

            current += ch;
        }

        if (current.trim()) {
            clauses.push(current.trim());
        }

        return clauses;
    }

    /**
     * Clean up and finalize the SQL
     */
    cleanUp(sql) {
        // Remove excessive blank lines
        sql = sql.replace(/\n{4,}/g, '\n\n\n');

        // Remove trailing whitespace on lines
        sql = sql.replace(/[ \t]+$/gm, '');

        // Remove remaining backticks
        if (this.options.convertBackticks) {
            sql = sql.replace(/`/g, '"');
        }

        // Convert IFNULL → COALESCE
        sql = sql.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');

        // Convert LIMIT x, y → LIMIT y OFFSET x
        sql = sql.replace(/\bLIMIT\s+(\d+)\s*,\s*(\d+)/gi, (match, offset, limit) => {
            return `LIMIT ${limit} OFFSET ${offset}`;
        });

        // Convert INSERT IGNORE INTO → INSERT INTO ... ON CONFLICT DO NOTHING
        sql = sql.replace(/INSERT\s+IGNORE\s+INTO/gi, 'INSERT INTO /* was INSERT IGNORE — add ON CONFLICT DO NOTHING */');

        // Convert REPLACE INTO → INSERT INTO with note
        sql = sql.replace(/REPLACE\s+INTO/gi, 'INSERT INTO /* was REPLACE INTO — add ON CONFLICT clause */');

        // Remove any remaining MySQL conditional comments
        sql = sql.replace(/\/\*!\d+\s*/g, '');

        // Add header
        const header = `-- ============================================================
-- Converted from MySQL to PostgreSQL
-- Generated by SQL Migrator
-- Date: ${new Date().toISOString().split('T')[0]}
-- ============================================================
-- Ready for Supabase import.
-- ============================================================

`;
        sql = header + sql.trim() + ';\n';

        return sql;
    }
}

// Export for use in app.js
window.MySQLToPostgresConverter = MySQLToPostgresConverter;
