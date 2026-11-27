const fs = require('fs');
const path = require('path');

const migrationSql = (name) => fs.readFileSync(path.join(__dirname, '../sql/migrations', name), 'utf8');

// Keep string literal contents intact. PostgreSQL adds harmless casts to string
// literals when deparsing catalog expressions, so only those casts are elided.
function normalizeSqlDefinition(value) {
  let source = String(value ?? '').replace(/"([^"]+)"/g, '$1')
    .replace(/\b([a-z_][a-z0-9_.]*)\s+IN\s+\(\s*(SELECT\b)/gi, '$1 = ANY ($2')
    .replace(/\b([a-z_][a-z0-9_.]*)\s+IN\s*\(([^()]*)\)/gi, '$1 = ANY (ARRAY[$2])');
  let output = '';
  let inString = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === "'") {
      output += char;
      if (inString && source[i + 1] === "'") {
        output += source[i + 1];
        i += 1;
      } else inString = !inString;
      continue;
    }
    output += inString ? char : char.toLowerCase();
  }
  output = output.replace(/('(?:''|[^'])*')\s*::\s*(?:pg_catalog\.)?(?:text|character varying)\b/gi, '$1');
  output = output.replace(/\bpublic\./gi, '');
  output = output.replace(/trim\s*\(\s*both\s+from\s+/gi, 'trim(');
  output = output.replace(/\s+/g, ' ').trim();
  output = output.replace(/\b(trim|current_setting|nullif|array)\s+\(/gi, '$1(');
  output = output.replace(/\(\s+/g, '(');
  output = output.replace(/\s+\)/g, ')');
  output = output.replace(/\s*,\s*/g, ',');
  output = output.replace(/\s*(<>|<=|>=|=|<|>)\s*/g, '$1');
  output = output.replace(/\s*::\s*/g, '::');
  // pg_get_expr wraps individual comparison predicates in parentheses. Those
  // wrappers are semantically redundant; grouping around AND/OR is retained.
  let changed = true;
  while (changed) {
    changed = false;
    let inLiteral = false;
    for (let open = 0; open < output.length; open += 1) {
      if (output[open] === "'") {
        if (inLiteral && output[open + 1] === "'") { open += 1; continue; }
        inLiteral = !inLiteral;
        continue;
      }
      if (inLiteral || output[open] !== '(') continue;
      const found = extractParenthesized(output, open);
      const inner = found.value;
      const wrapsWholeDefinition = open === 0 && found.end === output.length;
      if (wrapsWholeDefinition) {
        output = inner;
        changed = true;
        break;
      }
      if (/\bor\b/i.test(inner) || /^\s*select\b/i.test(inner)) {
        continue;
      }
      if (/\band\b/i.test(inner) && /\bor\b/i.test(output)) continue;
      if (/\band\b/i.test(inner)) {
        output = output.slice(0, open) + inner + output.slice(found.end);
        changed = true;
        break;
      }
      if (/^\s*exists\s*\(/i.test(inner)) {
        output = output.slice(0, open) + inner + output.slice(found.end);
        changed = true;
        break;
      }
      const prior = output[open - 1] || '';
      if (!/[a-z0-9_.]/i.test(prior)
          && /^\s*[a-z_][a-z0-9_.]*\s*\(/i.test(inner)
          && /^\s*::/.test(output.slice(found.end))) {
        output = output.slice(0, open) + inner + output.slice(found.end);
        changed = true;
        break;
      }
      if (/(?:=|<>|<=|>=|\bis\b|\bin\b|\blike\b|\bbetween\b|\bany\s*\()/i.test(inner)) {
        output = output.slice(0, open) + inner + output.slice(found.end);
        changed = true;
        break;
      }
    }
  }
  return output;
}

function extractParenthesized(source, openIndex) {
  let depth = 0;
  let inString = false;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (char === "'") {
      if (inString && source[i + 1] === "'") { i += 1; continue; }
      inString = !inString;
    } else if (!inString && char === '(') depth += 1;
    else if (!inString && char === ')') {
      depth -= 1;
      if (depth === 0) return { value: source.slice(openIndex + 1, i), end: i + 1 };
    }
  }
  throw new Error(`Unable to parse a balanced SQL expression at character ${openIndex} of ${source.length}.`);
}

function extractPolicies(sql) {
  const policies = [];
  const statementPattern = /CREATE\s+POLICY\s+([a-z_][a-z0-9_]*)\s+ON\s+([a-z0-9_.]+)([\s\S]*?);/gi;
  for (const match of sql.matchAll(statementPattern)) {
    const [, policyname, qualifiedTable, rest] = match;
    const body = rest.replace(/\s+/g, ' ');
    const command = body.match(/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i)?.[1]?.toUpperCase();
    if (!command) throw new Error(`Unable to read command for policy ${policyname}.`);
    const permissive = body.match(/\bAS\s+(PERMISSIVE|RESTRICTIVE)\b/i)?.[1]?.toUpperCase() || 'PERMISSIVE';
    const roleText = body.match(/\bTO\s+([\w, ]+?)(?=\s+USING\b|\s+WITH\s+CHECK\b|$)/i)?.[1];
    const roles = roleText ? roleText.split(',').map((role) => role.trim().toLowerCase()).sort() : ['public'];
    const extractClause = (clause) => {
      const start = body.search(new RegExp(`\\b${clause}\\s*\\(`, 'i'));
      if (start < 0) return null;
      const open = body.indexOf('(', start);
      return extractParenthesized(body, open).value;
    };
    policies.push({
      tablename: qualifiedTable.split('.').at(-1),
      policyname,
      permissive,
      cmd: command,
      roles,
      qual: extractClause('USING'),
      with_check: extractClause('WITH CHECK'),
    });
  }
  return policies;
}

const authorizationPolicies = extractPolicies(migrationSql('20261127_assignment_database_authorization.sql'));
const learningMaterialsPolicies = extractPolicies(migrationSql('20261127_learning_materials.sql'));
const assignmentRecursionFixPolicies = extractPolicies(migrationSql('20261127_assignment_rls_recursion_fix.sql'));
const authorizationPoliciesWithRecursionFix = authorizationPolicies.map((policy) =>
  policy.policyname === assignmentRecursionFixPolicies[0]?.policyname
    ? assignmentRecursionFixPolicies[0]
    : policy);
const authorizationSql = migrationSql('20261127_assignment_database_authorization.sql');
const staffScopeFunctionBody = authorizationSql.match(/AS\s+\$\$([\s\S]*?)\$\$/i)?.[1];
if (!staffScopeFunctionBody) throw new Error('Could not extract the intended assignment staff-scope function body.');
const recursionFixSql = migrationSql('20261127_assignment_rls_recursion_fix.sql');
const assignmentRecipientStaffScopeFunctionBody = recursionFixSql.match(
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.assignment_recipient_staff_scope[\s\S]*?AS\s+\$\$([\s\S]*?)\$\$/i
)?.[1];
if (!assignmentRecipientStaffScopeFunctionBody) {
  throw new Error('Could not extract the intended assignment-recipient scope function body.');
}

const MATERIAL_CONSTRAINTS = Object.freeze({
  learning_materials_pkey: 'PRIMARY KEY (id)',
  learning_materials_title_check: 'CHECK (length(trim(title)) >= 1 AND length(trim(title)) <= 200)',
  learning_materials_description_check: 'CHECK (length(description) <= 5000)',
  learning_materials_status_check: "CHECK (status IN ('PUBLISHED','CLOSED'))",
  learning_materials_school_id_fkey: 'FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE',
  learning_materials_school_id_teacher_id_fkey: 'FOREIGN KEY (school_id, teacher_id) REFERENCES users(school_id, id) ON DELETE RESTRICT',
  learning_materials_school_id_class_id_fkey: 'FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id) ON DELETE RESTRICT',
  learning_materials_school_id_subject_id_fkey: 'FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT',
  learning_materials_school_id_academic_year_term_term_id_fkey: 'FOREIGN KEY (school_id, academic_year, term, term_id) REFERENCES timetable_terms(school_id, academic_year, term, id) ON DELETE RESTRICT',
  learning_materials_school_id_id_key: 'UNIQUE (school_id, id)',
  learning_material_files_pkey: 'PRIMARY KEY (id)',
  learning_material_files_file_size_check: 'CHECK (file_size > 0)',
  learning_material_files_school_id_material_id_fkey: 'FOREIGN KEY (school_id, material_id) REFERENCES learning_materials(school_id, id) ON DELETE RESTRICT',
  learning_material_files_school_id_uploaded_by_fkey: 'FOREIGN KEY (school_id, uploaded_by) REFERENCES users(school_id, id) ON DELETE RESTRICT',
  learning_material_files_storage_key_key: 'UNIQUE (storage_key)',
  assignment_mark_private_notes_pkey: 'PRIMARY KEY (mark_id)',
  assignment_mark_private_notes_mark_id_fkey: 'FOREIGN KEY (mark_id) REFERENCES assignment_marks(id) ON DELETE RESTRICT',
});

const MATERIAL_INDEXES = Object.freeze({
  learning_materials_pkey: 'CREATE UNIQUE INDEX learning_materials_pkey ON public.learning_materials USING btree (id)',
  learning_materials_school_id_id_key: 'CREATE UNIQUE INDEX learning_materials_school_id_id_key ON public.learning_materials USING btree (school_id, id)',
  learning_materials_class_term_idx: 'CREATE INDEX learning_materials_class_term_idx ON public.learning_materials USING btree (school_id, class_id, term_id, status, created_at DESC)',
  learning_material_files_pkey: 'CREATE UNIQUE INDEX learning_material_files_pkey ON public.learning_material_files USING btree (id)',
  learning_material_files_storage_key_key: 'CREATE UNIQUE INDEX learning_material_files_storage_key_key ON public.learning_material_files USING btree (storage_key)',
  learning_material_files_lookup_idx: 'CREATE INDEX learning_material_files_lookup_idx ON public.learning_material_files USING btree (school_id, material_id, created_at, id)',
});

module.exports = {
  normalizeSqlDefinition,
  extractPolicies,
  authorizationPolicies,
  authorizationPoliciesWithRecursionFix,
  learningMaterialsPolicies,
  assignmentRecursionFixPolicies,
  staffScopeFunctionBody,
  assignmentRecipientStaffScopeFunctionBody,
  MATERIAL_CONSTRAINTS,
  MATERIAL_INDEXES,
};
