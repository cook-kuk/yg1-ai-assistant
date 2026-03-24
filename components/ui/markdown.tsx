"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

interface MarkdownProps {
  children: string
  className?: string
  stripDoubleTilde?: boolean
  disableStrikethrough?: boolean
}

export function Markdown({
  children,
  className = "",
  stripDoubleTilde = false,
  disableStrikethrough = false,
}: MarkdownProps) {
  const content = stripDoubleTilde ? children.replace(/~~/g, "") : children

  return (
    <div className={`markdown-content ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="min-w-full text-xs border-collapse border border-gray-300 rounded-lg overflow-hidden">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-gray-100 font-semibold">{children}</thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-gray-200">{children}</tbody>
          ),
          tr: ({ children }) => (
            <tr className="hover:bg-gray-50 transition-colors">{children}</tr>
          ),
          th: ({ children }) => (
            <th className="px-3 py-1.5 text-left border border-gray-300 bg-gray-100 font-semibold text-gray-700">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-1.5 border border-gray-300 text-gray-800">
              {children}
            </td>
          ),
          strong: ({ children }) => (
            <strong className="font-bold text-gray-900">{children}</strong>
          ),
          del: ({ children }) => (
            disableStrikethrough ? <>{children}</> : <del>{children}</del>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-bold mt-3 mb-1">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>
          ),
          ul: ({ children }) => (
            <ul className="list-disc list-inside space-y-0.5 my-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside space-y-0.5 my-1">{children}</ol>
          ),
          p: ({ children }) => (
            <p className="my-1">{children}</p>
          ),
          hr: () => (
            <hr className="my-2 border-gray-300" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
