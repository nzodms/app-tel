import { z } from 'zod';
import { deviceTools } from './tools/devices';
import { fileTools } from './tools/files';
import { journeyTools } from './tools/journeys';
import { previewTools } from './tools/preview';
import { projectTools } from './tools/projects';
import { sharingTools } from './tools/sharing';
import { versionTools } from './tools/versions';
import type { ToolDefinition } from './types';

/**
 * The PhoneLab tool surface.
 *
 * `tools/list` is generated from these definitions — including the JSON Schema,
 * which is derived from each tool's Zod schema so the advertised contract and the
 * enforced contract cannot drift.
 */

export const ALL_TOOLS: readonly ToolDefinition[] = [
  ...projectTools,
  ...fileTools,
  ...previewTools,
  ...deviceTools,
  ...versionTools,
  ...journeyTools,
  ...sharingTools,
];

const BY_NAME = new Map(ALL_TOOLS.map((tool) => [tool.name, tool]));

export function findTool(name: string): ToolDefinition | undefined {
  return BY_NAME.get(name);
}

export interface McpToolListing {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, boolean>;
}

/**
 * MCP tool descriptors.
 *
 * `inputSchema` is JSON Schema 2020-12 (the MCP default). Destructive tools
 * document their `confirm` requirement in the description *and* enforce it in the
 * runner, so a client that ignores annotations still cannot delete by accident.
 */
export function toolListing(): McpToolListing[] {
  return ALL_TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: describe(tool),
    inputSchema: z.toJSONSchema(tool.input, { io: 'input' }) as Record<string, unknown>,
    annotations: {
      readOnlyHint: tool.annotations.readOnlyHint ?? false,
      destructiveHint: tool.annotations.destructiveHint ?? false,
      idempotentHint: tool.annotations.idempotentHint ?? false,
      openWorldHint: tool.annotations.openWorldHint ?? false,
    },
  }));
}

function describe(tool: ToolDefinition): string {
  const scopeNote = `Requires the "${tool.capability}" capability.`;
  const confirmNote = tool.destructive
    ? ' This tool changes or removes data and will refuse to act unless confirm=true.'
    : '';
  return `${tool.description} ${scopeNote}${confirmNote}`;
}

/** Grouped view, used by the in-app documentation page. */
export function toolsByGroup(): { group: string; tools: ToolDefinition[] }[] {
  const groups = new Map<string, ToolDefinition[]>();
  for (const tool of ALL_TOOLS) {
    const list = groups.get(tool.group) ?? [];
    list.push(tool);
    groups.set(tool.group, list);
  }
  const order = ['projects', 'files', 'preview', 'devices', 'versions', 'journeys', 'sharing'];
  return order
    .filter((group) => groups.has(group))
    .map((group) => ({ group, tools: groups.get(group) ?? [] }));
}
