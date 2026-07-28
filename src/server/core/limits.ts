/**
 * Hard limits. These are enforced in the services (so they apply to REST *and*
 * MCP) rather than at the edge, and they are the numbers documented in
 * docs/MCP.md.
 */
export const LIMITS = {
  /** Single file, in bytes. Comfortably above any hand-written screen. */
  maxFileBytes: 512 * 1024,
  /** Whole project working tree, in bytes. */
  maxProjectBytes: 8 * 1024 * 1024,
  maxFilesPerProject: 400,
  maxPathLength: 240,
  maxDevicesPerProject: 12,
  maxVersionsPerProject: 200,
  maxJourneySteps: 200,
  /** Events kept per project before the oldest are trimmed. */
  maxEventsPerProject: 2000,
  maxShareLinksPerProject: 25,
  /** MCP tool calls per connection per rolling minute. */
  mcpCallsPerMinute: 120,
  /** Bytes of file content a single MCP read may return. */
  maxMcpReadBytes: 200 * 1024,
  maxCommentBodyChars: 4000,
} as const;

export function byteLength(input: string): number {
  return Buffer.byteLength(input, 'utf8');
}
