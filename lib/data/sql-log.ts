function formatSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL"
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
  if (value instanceof Date) return `'${value.toISOString().replace(/'/g, "''")}'`
  if (Buffer.isBuffer(value)) return `'<buffer:${value.length}>'`
  if (Array.isArray(value)) return `ARRAY[${value.map(item => formatSqlLiteral(item)).join(", ")}]`
  return `'${JSON.stringify(value).replace(/'/g, "''")}'`
}

export function formatSqlForLog(query: string): string {
  return query.replace(/\s+/g, " ").trim()
}

export function interpolateSqlForLog(query: string, values: unknown[]): string {
  return query.replace(/\$(\d+)\b/g, (token, rawIndex: string) => {
    const index = Number.parseInt(rawIndex, 10) - 1
    return index >= 0 && index < values.length ? formatSqlLiteral(values[index]) : token
  })
}

export function formatQueryValuesForLog(values: unknown[]): string {
  return JSON.stringify(values, (_key, value) => {
    if (typeof value === "bigint") return value.toString()
    if (value instanceof Date) return value.toISOString()
    if (value === undefined) return null
    return value
  })
}
